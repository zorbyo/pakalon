"""Models bridge — OpenRouter catalog proxy + refresh.

The CLI normally talks directly to `https://openrouter.ai/api/v1/models`.
This module exists so the cloud Pakalon backend can:
  - cache the catalog in SQLite (bypassing OpenRouter rate limits),
  - tag each model with `tier=free|pro` based on `:free` suffix,
  - force-refresh via the nightly cron (or on demand),
  - expose the catalog through the same `/v1/models` shape the
    Tanstack adapter expects.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from robomp.bridge.auth import JwtConfig, require_user
from robomp.bridge.store import BridgeStore, ModelCacheRow, UserRow

log = logging.getLogger(__name__)

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
CACHE_TTL_SECONDS = 24 * 60 * 60


# ────────────────────────── Schemas ──────────────────────────

class ModelSummary(BaseModel):
	id: str
	name: str
	provider: str
	context_length: int
	pricing: dict[str, float]
	tier: str


class ModelsResponse(BaseModel):
	data: list[ModelSummary]
	fetched_at: str
	source: str  # "cache" | "live"


# ────────────────────────── Router factory ──────────────────────────

def models_router(store: BridgeStore, jwt_cfg: JwtConfig) -> APIRouter:
	router = APIRouter(prefix="/models", tags=["models"])

	@router.get("", response_model=ModelsResponse)
	async def list_models(
	    tier: str | None = None,
	    user: UserRow | None = Depends(_opt_user(store, jwt_cfg)),
	) -> ModelsResponse:
		# Free-tier users can only see free models.
		effective_tier: str | None = tier
		if user is not None and user.tier == "free":
			effective_tier = "free"
		rows = store.list_model_cache(effective_tier)
		fetched_at = store.last_model_fetch() or ""
		return ModelsResponse(
			data=[_row_to_summary(r) for r in rows],
			fetched_at=fetched_at,
			source="cache" if rows else "empty",
		)

	@router.post("/refresh", response_model=ModelsResponse)
	async def refresh(
	    user: UserRow = Depends(_req_user(store, jwt_cfg)),
	) -> ModelsResponse:
		if user.tier != "pro":
			raise HTTPException(
				status.HTTP_403_FORBIDDEN,
				"model refresh is a pro feature",
			)
		rows = await _fetch_openrouter_models()
		store.replace_model_cache(rows)
		return ModelsResponse(
			data=[_row_to_summary(r) for r in rows],
			fetched_at=store.last_model_fetch() or "",
			source="live",
		)

	return router


# ────────────────────────── Live fetch ──────────────────────────

async def _fetch_openrouter_models() -> list[ModelCacheRow]:
	"""Fetch the full OpenRouter catalog and tag each model with tier."""
	api_key = os.environ.get("OPENROUTER_API_KEY")
	headers: dict[str, str] = {}
	if api_key:
		headers["Authorization"] = f"Bearer {api_key}"
	req = urllib.request.Request(OPENROUTER_MODELS_URL, headers=headers)
	with urllib.request.urlopen(req, timeout=30) as resp:
		payload = json.loads(resp.read().decode())
	fetched_at = datetime.now(tz=UTC).isoformat()
	out: list[ModelCacheRow] = []
	for entry in payload.get("data", []):
		entry_id = str(entry.get("id", "")).strip()
		if not entry_id:
			continue
		tier = "free" if entry_id.endswith(":free") else "pro"
		pricing = entry.get("pricing") or {}
		out.append(ModelCacheRow(
			id=entry_id,
			name=str(entry.get("name", entry_id)),
			provider=str(entry.get("id", "").split("/", 1)[0] or "unknown"),
			context_length=int(entry.get("context_length") or 0),
			prompt_price=float(pricing.get("prompt", 0) or 0),
			completion_price=float(pricing.get("completion", 0) or 0),
			tier=tier,
			fetched_at=fetched_at,
		))
	# Sort newest-first by id (proxy for "released recently" — OpenRouter
	# returns models in creation order; reverse to get newest first).
	out.sort(key=lambda r: r.id, reverse=True)
	log.info("openrouter models fetched", extra={"count": len(out)})
	return out


# ────────────────────────── helpers ──────────────────────────

def _row_to_summary(r: ModelCacheRow) -> ModelSummary:
	return ModelSummary(
		id=r.id,
		name=r.name,
		provider=r.provider,
		context_length=r.context_length,
		pricing={
			"prompt": r.prompt_price,
			"completion": r.completion_price,
		},
		tier=r.tier,
	)


def _req_user(store: BridgeStore, jwt_cfg: JwtConfig):
	def _resolve(
	    authorization: Annotated[str | None, Header()] = None,
	) -> UserRow:
		return require_user(authorization=authorization, store=store, jwt_cfg=jwt_cfg)
	return _resolve


def _opt_user(store: BridgeStore, jwt_cfg: JwtConfig):
	"""Same as _req_user but the endpoint is callable without a token."""
	def _resolve(
	    authorization: Annotated[str | None, Header()] = None,
	) -> UserRow | None:
		if not authorization or not authorization.lower().startswith("bearer "):
			return None
		try:
			return require_user(
				authorization=authorization, store=store, jwt_cfg=jwt_cfg
			)
		except HTTPException:
			return None
	return _resolve
