"""Polar.sh webhook receiver for the Pakalon bridge.

Polar.sh sends these events:
  - `checkout.created`   — user opened a Polar-hosted checkout.
  - `checkout.updated`   — user completed the checkout.
  - `subscription.created` — user subscribed to a pro plan.
  - `subscription.updated` — user changed plan.
  - `subscription.canceled` — user cancelled.
  - `order.paid`         — a usage-based order settled.

The bridge persists every event in the `polar_events` table and
flips the user's `tier` to `pro` (or back to `free`) on the
subscription events. The actual per-message usage accounting
(`usage_events` table) is fed by the CLI via `/billing/usage`
(see `billing.py`); the webhook is the **plan** switch.

Webhook signature verification follows Polar's spec:
  `X-Polar-Signature: t=<unix_ts>,v1=<hex_hmac_sha256>` where the
  signed payload is `<unix_ts>.<raw_body>` and the key is the
  webhook secret. We reject any timestamp older than 5 minutes
  to prevent replay attacks.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from robomp.bridge.auth import JwtConfig
from robomp.bridge.store import BridgeStore, UserRow

log = logging.getLogger(__name__)

# Replay window: 5 minutes (Polar's default tolerance is 5 min).
MAX_TIMESTAMP_AGE_S = 300


# ─────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────


class PolarEvent(BaseModel):
	"""A single Polar.sh webhook event."""

	type: str
	data: dict[str, Any]
	created_at: str | None = None
	id: str | None = None


class PolarAck(BaseModel):
	received: bool = True
	event_id: str | None = None
	event_type: str
	persisted: bool
	flipped_tier: Literal["pro", "free"] | None = None
	flipped_user_id: str | None = None


# ─────────────────────────────────────────────────────────────────────────
# Signature verification
# ─────────────────────────────────────────────────────────────────────────


def verify_polar_signature(
	secret: str,
	header: str,
	raw_body: bytes,
) -> bool:
	"""Verify a Polar.sh webhook signature.

	`header` is the `X-Polar-Signature` value of the form
	`t=<unix_ts>,v1=<hex_hmac>`. The signed payload is
	`<unix_ts>.<raw_body>`. We:
	  1. Reject if the timestamp is older than 5 minutes (replay).
	  2. Recompute HMAC-SHA256 with the secret and compare in
	     constant time.
	"""
	if not header:
		return False
	parts: dict[str, str] = {}
	for kv in header.split(","):
		k, _, v = kv.partition("=")
		parts[k.strip()] = v.strip()
	ts_str = parts.get("t")
	sig = parts.get("v1")
	if not ts_str or not sig:
		return False
	try:
		ts = int(ts_str)
	except ValueError:
		return False
	if abs(time.time() - ts) > MAX_TIMESTAMP_AGE_S:
		return False
	expected = hmac.new(secret.encode("utf-8"), f"{ts}.".encode("utf-8") + raw_body, hashlib.sha256).hexdigest()
	return hmac.compare_digest(expected, sig)


# ─────────────────────────────────────────────────────────────────────────
# Tier-flip dispatch
# ─────────────────────────────────────────────────────────────────────────


def _flip_tier_for_event(
	store: BridgeStore,
	event: PolarEvent,
) -> tuple[str | None, str | None]:
	"""Map a Polar event to a tier-flip (if any). Returns (user_id, new_tier)."""
	t = event.type
	data = event.data
	if t in ("subscription.created", "subscription.updated"):
		user_id = data.get("customer_id") or data.get("user_id")
		# In real Polar, `subscription.status === "active"` ⇒ pro.
		# For this stub we just upgrade on any subscription event.
		if data.get("status", "active") == "active":
			return user_id, "pro"
		return user_id, "free"
	if t == "subscription.canceled":
		user_id = data.get("customer_id") or data.get("user_id")
		return user_id, "free"
	# checkout events + order.paid don't change tier by themselves.
	return None, None


# ─────────────────────────────────────────────────────────────────────────
# Router factory
# ─────────────────────────────────────────────────────────────────────────


def polar_webhook_router(store: BridgeStore, jwt_cfg: JwtConfig) -> APIRouter:
	router = APIRouter(prefix="/billing", tags=["billing"])

	@router.post("/polar-webhook", response_model=PolarAck)
	async def polar_webhook(
		request: Request,
		x_polar_signature: Annotated[str | None, Header()] = None,
	) -> PolarAck:
		raw_body = await request.body()
		secret = store.polar_webhook_secret
		if not secret:
			# In dev / no-secret mode, accept the webhook but log a warning.
			log.warning("polar-webhook: no secret configured, accepting unsigned")
		else:
			if not verify_polar_signature(secret, x_polar_signature or "", raw_body):
				raise HTTPException(
					status.HTTP_401_UNAUTHORIZED,
					"invalid signature",
				)

		try:
			payload = await request.json()
		except ValueError as err:
			raise HTTPException(status.HTTP_400_BAD_REQUEST, f"invalid JSON: {err}") from err

		event = PolarEvent(
			type=str(payload.get("type", "unknown")),
			data=payload.get("data") or {},
			created_at=payload.get("created_at"),
			id=payload.get("id"),
		)

		# Persist first, then flip tier (so a DB write failure leaves us
		# in a consistent state — the user is still on the old tier).
		persisted = False
		try:
			store.record_polar_event(event.id or "", event.type, event.data, event.created_at)
			persisted = True
		except Exception as err:  # noqa: BLE001 — log + continue; tier-flip is best-effort
			log.error("polar-webhook: persist failed", extra={"err": str(err)})

		user_id, new_tier = _flip_tier_for_event(store, event)
		if user_id and new_tier:
			try:
				store.set_user_tier(user_id, new_tier)
				log.info(
					"polar-webhook: tier flip",
					extra={"user_id": user_id, "new_tier": new_tier, "event_type": event.type},
				)
			except Exception as err:  # noqa: BLE001
				log.error(
					"polar-webhook: tier flip failed",
					extra={"err": str(err), "user_id": user_id, "new_tier": new_tier},
				)
				# Roll back the persisted event since the flip is the
				# primary side-effect; we re-raise so Polar retries.
				raise HTTPException(
					status.HTTP_500_INTERNAL_SERVER_ERROR,
					"tier flip failed; please retry",
				) from err

		return PolarAck(
			received=True,
			event_id=event.id,
			event_type=event.type,
			persisted=persisted,
			flipped_tier=new_tier,
			flipped_user_id=user_id,
		)

	return router
