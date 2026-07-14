"""Auth bridge — 6-digit device-code pairing flow.

CLI calls `POST /auth/device-code` to start a flow. The terminal shows
the 6-digit code immediately. The user opens the web companion (or
clerk-hosted auth page) in a browser, signs in, and pastes the code.
When the code matches, the bridge mints a JWT and the CLI polls
`POST /auth/token` to receive it.

All long-form state lives in `BridgeStore`; this module is stateless
beyond the store handle.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from robomp.bridge.store import BridgeStore, DeviceCodeRow, UserRow

log = logging.getLogger(__name__)

# Code TTL — 10 minutes per spec §585
DEVICE_CODE_TTL_MS = 10 * 60 * 1000
# JWT expiry — 24h
JWT_TTL_SECONDS = 24 * 60 * 60


# ────────────────────────── Schemas ──────────────────────────

class DeviceCodeRequest(BaseModel):
	client_id: str = Field(..., min_length=1, max_length=128)


class DeviceCodeResponse(BaseModel):
	user_code: str = Field(..., pattern=r"^\d{6}$")
	device_code: str
	verification_uri: str
	expires_in: int
	interval: int = 5  # spec §5.1: client polls every 5s


class TokenRequest(BaseModel):
	device_code: str
	user_code: str = Field(..., pattern=r"^\d{6}$")


class TokenResponse(BaseModel):
	access_token: str
	refresh_token: str | None = None
	token_type: str = "Bearer"
	expires_in: int
	user: "UserPublic"


class UserPublic(BaseModel):
	user_id: str
	email: str | None
	tier: str
	credits_remaining: float


# ────────────────────────── In-memory JWT ──────────────────────────
# We use HMAC-SHA256 instead of pulling in PyJWT — keeps the dependency
# surface tiny and the verify path is just `hmac.compare_digest`.

@dataclass(slots=True, frozen=True)
class JwtConfig:
	secret: bytes
	issuer: str = "pakalon"
	ttl_seconds: int = JWT_TTL_SECONDS


def _mint_jwt(user_id: str, cfg: JwtConfig) -> str:
	header = _b64url(b'{"alg":"HS256","typ":"JWT"}')
	payload_dict = {
		"iss": cfg.issuer,
		"sub": user_id,
		"iat": int(time.time()),
		"exp": int(time.time()) + cfg.ttl_seconds,
	}
	import json as _json
	payload = _b64url(_json.dumps(payload_dict, separators=(",", ":")).encode())
	signing_input = f"{header}.{payload}".encode()
	sig = _b64url(hmac.new(cfg.secret, signing_input, hashlib.sha256).digest())
	return f"{header}.{payload}.{sig}"


def _verify_jwt(token: str, cfg: JwtConfig) -> str | None:
	parts = token.split(".")
	if len(parts) != 3:
		return None
	header, payload, sig = parts
	signing_input = f"{header}.{payload}".encode()
	expected = _b64url(hmac.new(cfg.secret, signing_input, hashlib.sha256).digest())
	if not hmac.compare_digest(expected, sig):
		return None
	import base64 as _b64
	import json as _json
	try:
		# urlsafe b64 → bytes → json
		padded = payload + "=" * (-len(payload) % 4)
		body = _json.loads(_b64.urlsafe_b64decode(padded.encode()).decode())
	except Exception:
		return None
	if int(body.get("exp", 0)) < int(time.time()):
		return None
	return str(body.get("sub", "")) or None


def _b64url(data: bytes) -> str:
	import base64 as _b64
	return _b64.urlsafe_b64encode(data).rstrip(b"=").decode()


# ────────────────────────── Router factory ──────────────────────────

def auth_router(
    store: BridgeStore,
    jwt_cfg: JwtConfig,
    verification_uri: str,
) -> APIRouter:
	router = APIRouter(prefix="/auth", tags=["auth"])

	@router.post("/device-code", response_model=DeviceCodeResponse)
	async def start_device_code(req: DeviceCodeRequest) -> DeviceCodeResponse:
		# Cleanup expired codes opportunistically. Cheap and bounded.
		store.cleanup_expired_codes()

		# 6-digit numeric code, leading zeros preserved.
		code = f"{secrets.randbelow(1_000_000):06d}"
		device_id = secrets.token_urlsafe(24)
		expires_at = int(time.time() * 1000) + DEVICE_CODE_TTL_MS
		store.store_device_code(code=code, device_id=device_id, expires_at=expires_at)
		log.info(
			"device code issued",
			extra={"client_id": req.client_id, "code_prefix": code[:2] + "****"},
		)
		return DeviceCodeResponse(
			user_code=code,
			device_code=device_id,
			verification_uri=verification_uri,
			expires_in=DEVICE_CODE_TTL_MS // 1000,
			interval=5,
		)

	@router.post("/token", response_model=TokenResponse)
	async def exchange_code(req: TokenRequest) -> TokenResponse:
		row = store.get_device_code(req.user_code)
		if row is None:
			raise HTTPException(
				status.HTTP_400_BAD_REQUEST, "invalid or expired code"
			)
		if row.expires_at < int(time.time() * 1000):
			raise HTTPException(
				status.HTTP_400_BAD_REQUEST, "code expired"
			)
		if row.device_id != req.device_code:
			raise HTTPException(
				status.HTTP_400_BAD_REQUEST, "device mismatch"
			)
		if row.user_id is None:
			# The web side has not yet linked the code to a user. Per
			# spec, the CLI keeps polling; we return 202-ish (we use
			# 400 with a clear message so the CLI can retry).
			raise HTTPException(
				status.HTTP_425_TOO_EARLY,
				"code not yet linked to a user — continue polling",
			)

		user = store.get_user(row.user_id)
		if user is None:
			raise HTTPException(
				status.HTTP_500_INTERNAL_SERVER_ERROR,
				"user vanished mid-flow",
			)

		token = _mint_jwt(user.user_id, jwt_cfg)
		store.store_jwt_hash(user.user_id, hashlib.sha256(token.encode()).hexdigest())

		# Burn the code so it can't be replayed.
		with store._connect() as conn:  # noqa: SLF001 — internal but stable
			conn.execute("DELETE FROM bridge_device_codes WHERE code = ?", (req.user_code,))

		return TokenResponse(
			access_token=token,
			token_type="Bearer",
			expires_in=jwt_cfg.ttl_seconds,
			user=_user_to_public(user),
		)

	@router.post("/web-link", response_model=TokenResponse)
	async def web_link(
	    user_code: str = Header(..., alias="X-Pakalon-User-Code", min_length=6, max_length=6),
	    authorization: str | None = Header(None),
	) -> TokenResponse:
		"""Called by the web companion after the user pastes the 6-digit
		code on the auth page. The Authorization header carries the
		clerk/Supabase JWT; the bridge binds the code to the user_id it
		resolves from the auth store."""
		if not authorization or not authorization.lower().startswith("bearer "):
			raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
		bearer = authorization.split(" ", 1)[1].strip()
		user_id = _resolve_web_user(bearer)
		if user_id is None:
			raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid bearer token")
		row = store.consume_device_code(user_code, user_id)
		if row is None:
			raise HTTPException(status.HTTP_400_BAD_REQUEST, "code expired or already used")
		user = store.get_user(user_id)
		if user is None:
			# Auto-provision the user record on first sign-in.
			user = store.upsert_user(
				user_id=user_id, email=None, tier="free"
			)
		token = _mint_jwt(user.user_id, jwt_cfg)
		store.store_jwt_hash(user.user_id, hashlib.sha256(token.encode()).hexdigest())
		return TokenResponse(
			access_token=token,
			token_type="Bearer",
			expires_in=jwt_cfg.ttl_seconds,
			user=_user_to_public(user),
		)

	@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
	async def logout(authorization: str | None = Header(None)) -> None:
		if not authorization or not authorization.lower().startswith("bearer "):
			raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
		bearer = authorization.split(" ", 1)[1].strip()
		hash_ = hashlib.sha256(bearer.encode()).hexdigest()
		user = store.lookup_user_by_jwt(hash_)
		if user is not None:
			# Invalidate by rotating the JWT secret would force-revoke
			# all users; we just clear the stored hash. Future polls
			# will fail-verify and the CLI will re-initiate the flow.
			store.store_jwt_hash(user.user_id, "")
		return None

	return router


# ────────────────────────── helpers ──────────────────────────

def _user_to_public(user: UserRow) -> UserPublic:
	return UserPublic(
		user_id=user.user_id,
		email=user.email,
		tier=user.tier,
		credits_remaining=float(user.deposit_cents) / 100.0,
	)


def _resolve_web_user(bearer: str) -> str | None:
	"""Hook point: validate the web-companion JWT and return the user id.

	Real implementation calls out to Clerk/Supabase. The test double
	just decodes a `dev:<user_id>` token shape. This keeps the auth
	module hermetic and easy to unit-test.
	"""
	if bearer.startswith("dev:"):
		return bearer[4:] or None
	return None


def require_user(
    authorization: str | None = Header(None),
    store: BridgeStore | None = None,
    jwt_cfg: JwtConfig | None = None,
) -> UserRow:
	"""FastAPI dependency: extract + verify the bearer token, return user."""
	if not authorization or not authorization.lower().startswith("bearer "):
		raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
	bearer = authorization.split(" ", 1)[1].strip()
	assert store is not None and jwt_cfg is not None
	user_id = _verify_jwt(bearer, jwt_cfg)
	if user_id is None:
		raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
	user = store.get_user(user_id)
	if user is None:
		raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown user")
	return user
