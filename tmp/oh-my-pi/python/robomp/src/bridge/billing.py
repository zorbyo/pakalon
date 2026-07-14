"""Billing bridge — Polar integration + usage event ingestion.

Endpoints:
  - GET  /billing/me          — read tier + current-period usage.
  - POST /billing/upgrade     — create a Polar checkout session.
  - POST /billing/webhook     — receive Polar events (HMAC-verified).
  - POST /billing/usage       — batched usage event ingestion.

Pricing math is the same one the CLI implements in TypeScript
(`packages/coding-agent/src/auth/billing.ts`): 10% platform fee,
$2 pro deposit, per-model breakdown. The CLI is the source of usage
events; this service is the source of truth for invoices.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, NonNegativeFloat, NonNegativeInt

from robomp.bridge.auth import JwtConfig, require_user
from robomp.bridge.store import BridgeStore, InvoiceRow, UsageRow, UserRow

log = logging.getLogger(__name__)

PLATFORM_FEE_PERCENT = 0.1
PRO_DEPOSIT_CENTS = 200  # $2
PLATFORM_FEE_PRECISION_DIGITS = 6

POLAR_API_BASE = "https://api.polar.sh/v1"


# ────────────────────────── Schemas ──────────────────────────

class UsageEvent(BaseModel):
	model_id: str = Field(..., min_length=1, max_length=256)
	input_tokens: NonNegativeInt
	output_tokens: NonNegativeInt
	cost_usd: NonNegativeFloat
	session_id: str | None = None
	project_hash: str | None = None
	ts: str | None = None  # ISO 8601; default to server now


class UsageBatch(BaseModel):
	events: list[UsageEvent] = Field(..., min_length=1, max_length=2000)


class UsageResponse(BaseModel):
	accepted: int
	period: str
	total_cost: float


class BillingSummary(BaseModel):
	user_id: str
	email: str | None
	tier: str
	deposit_cents: int
	current_period: str
	total_cost: float
	platform_fee: float
	breakdown: list[dict]


class PolarCheckoutRequest(BaseModel):
	success_url: str | None = None
	cancel_url: str | None = None


class PolarCheckoutResponse(BaseModel):
	checkout_id: str
	checkout_url: str
	status: str = "pending"


# ────────────────────────── Router factory ──────────────────────────

def billing_router(
	store: BridgeStore,
	jwt_cfg: JwtConfig,
	polar_api_key: str | None = None,
	polar_product_id: str | None = None,
	polar_webhook_secret: str | None = None,
) -> APIRouter:
	router = APIRouter(prefix="/billing", tags=["billing"])

	@router.get("/me", response_model=BillingSummary)
	async def me(user: UserRow = Depends(_dep(store, jwt_cfg))) -> BillingSummary:
		period = current_period()
		summary = store.usage_summary(user.user_id, period)
		return BillingSummary(
			user_id=user.user_id,
			email=user.email,
			tier=user.tier,
			deposit_cents=user.deposit_cents,
			current_period=period,
			total_cost=summary["total_cost"],
			platform_fee=summary["platform_fee"],
			breakdown=summary["breakdown"],
		)

	@router.post("/usage", response_model=UsageResponse)
	async def ingest(
	    batch: UsageBatch,
	    user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> UsageResponse:
		period = current_period()
		accepted = 0
		for ev in batch.events:
			store.record_usage(UsageRow(
				user_id=user.user_id,
				project_hash=ev.project_hash or "default",
				session_id=ev.session_id,
				model_id=ev.model_id,
				input_tokens=ev.input_tokens,
				output_tokens=ev.output_tokens,
				cost_usd=ev.cost_usd,
				period=period,
				ts=ev.ts or datetime.now(tz=UTC).isoformat(),
			))
			accepted += 1
		summary = store.usage_summary(user.user_id, period)
		return UsageResponse(
			accepted=accepted,
			period=period,
			total_cost=summary["total_cost"],
		)

	@router.post("/upgrade", response_model=PolarCheckoutResponse)
	async def upgrade(
	    req: PolarCheckoutRequest,
	    user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> PolarCheckoutResponse:
		if user.tier == "pro":
			raise HTTPException(status.HTTP_409_CONFLICT, "already on pro tier")
		if not polar_api_key or not polar_product_id:
			# Local / self-hosted mode: return a deterministic mock.
			return PolarCheckoutResponse(
				checkout_id=f"mock-{user.user_id}-{int(datetime.now(tz=UTC).timestamp())}",
				checkout_url=(
					f"https://polar.sh/checkout/mock"
					f"?user_id={user.user_id}&deposit_cents={PRO_DEPOSIT_CENTS}"
				),
			)
		# Real Polar API call. Lazy import so the module loads without httpx
		# being available in offline mode.
		import urllib.request
		import json as _json

		body = _json.dumps({
			"product_id": polar_product_id,
			"customer_email": user.email or "",
			"success_url": req.success_url or "https://pakalon.dev/billing/success",
			"cancel_url": req.cancel_url or "https://pakalon.dev/billing/cancel",
		}).encode()
		req_obj = urllib.request.Request(
			f"{POLAR_API_BASE}/checkouts/custom",
			data=body,
			method="POST",
			headers={
				"Authorization": f"Bearer {polar_api_key}",
				"Content-Type": "application/json",
			},
		)
		with urllib.request.urlopen(req_obj, timeout=15) as resp:
			payload = _json.loads(resp.read().decode())
		return PolarCheckoutResponse(
			checkout_id=str(payload["id"]),
			checkout_url=str(payload["url"]),
			status="pending",
		)

	@router.post("/webhook")
	async def webhook(request: Request) -> dict[str, str]:
		body = await request.body()
		signature = request.headers.get("x-polar-signature", "")
		if polar_webhook_secret and not verify_polar_signature(
			polar_webhook_secret.encode(), body, signature
		):
			raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid signature")

		import json as _json
		try:
			event = _json.loads(body.decode())
		except Exception as exc:
			raise HTTPException(
				status.HTTP_400_BAD_REQUEST, f"invalid json: {exc}"
			) from exc

		event_type = str(event.get("type", ""))
		data = event.get("data", {}) or {}
		external_id = str(data.get("external_id", ""))
		user_id = str(data.get("metadata", {}).get("user_id", ""))
		if not user_id:
			# Polar can also deliver the user_id via custom_data.
			user_id = str(data.get("custom_data", {}).get("user_id", ""))

		if event_type == "checkout.created":
			log.info("polar checkout.created", extra={"external_id": external_id})
		elif event_type == "subscription.created":
			if user_id:
				store.set_user_tier(user_id, "pro")
				store.upsert_user(
					user_id=user_id, email=None, tier="pro",
					deposit_cents=PRO_DEPOSIT_CENTS,
				)
				log.info("user upgraded to pro", extra={"user_id": user_id})
		elif event_type == "subscription.canceled":
			if user_id:
				store.set_user_tier(user_id, "free")
				log.info("user downgraded to free", extra={"user_id": user_id})
		elif event_type == "invoice.created":
			due = data.get("due_date")
			amount = int(data.get("amount_due", 0))
			if user_id and due and external_id:
				store.record_invoice(InvoiceRow(
					invoice_id=external_id,
					user_id=user_id,
					amount_cents=amount,
					status="pending",
					due_date=str(due),
					created_at=datetime.now(tz=UTC).isoformat(),
				))
		elif event_type == "invoice.paid":
			store.record_invoice(InvoiceRow(
				invoice_id=external_id or "unknown",
				user_id=user_id or "unknown",
				amount_cents=int(data.get("amount_due", 0)),
				status="paid",
				due_date=str(data.get("due_date", "")),
				created_at=datetime.now(tz=UTC).isoformat(),
			))
		else:
			log.info("polar event ignored", extra={"type": event_type})

		return {"status": "ok"}

	return router


# ────────────────────────── helpers ──────────────────────────

def current_period(now: datetime | None = None) -> str:
	return (now or datetime.now(tz=UTC)).strftime("%Y-%m")


def verify_polar_signature(secret: bytes, body: bytes, signature: str) -> bool:
	if not signature:
		return False
	expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
	return hmac.compare_digest(expected, signature)


def _dep(store: BridgeStore, jwt_cfg: JwtConfig):
	"""Build a FastAPI dependency that yields a UserRow from the bearer token."""
	def _resolve(
	    authorization: Annotated[str | None, Header()] = None,
	) -> UserRow:
		return require_user(authorization=authorization, store=store, jwt_cfg=jwt_cfg)
	return _resolve
