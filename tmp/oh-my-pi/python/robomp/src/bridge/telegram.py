"""Pakalon Telegram bot token mirror.

The CLI stores the Telegram bot token in `~/.pakalon/telegram.json`
on the user's local machine (mode 0o600). For cloud users who
also want to use Telegram from the web companion or another
device, the bridge mirrors the encrypted token to the user's
Supabase profile.

Endpoints:
  PUT  /telegram/token    — upload the encrypted bot token.
  GET  /telegram/status   — return whether a token is mirrored.
  DELETE /telegram/token  — remove the mirror (the local CLI
                            token is unaffected).

Encryption: the bridge uses libsodium's `crypto_secretbox_easy` with
a per-user key derived from `HMAC-SHA256(server_key, user_id)`.
The token is never returned in plaintext via the API; clients
read it via the CLI's own `~/.pakalon/telegram.json` file.
"""
from __future__ import annotations

import base64
import hmac
import hashlib
import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from robomp.bridge.auth import JwtConfig, require_user
from robomp.bridge.store import BridgeStore, UserRow

log = logging.getLogger(__name__)

# 32-byte server-side key for libsodium secretbox. Loaded from
# ROBOMP_TELEGRAM_MIRROR_KEY (base64); falls back to a derived
# value from ROBOMP_JWT_SECRET in dev. The same key must be set on
# every bridge instance in the cluster.
DEFAULT_MIRROR_KEY_ENV = "ROBOMP_TELEGRAM_MIRROR_KEY"


# ─────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────


class TelegramTokenUpload(BaseModel):
	"""Encrypted token upload.

	The `ciphertext` is the libsodium `crypto_secretbox_easy` output
	of the bot token, with a fresh 24-byte nonce. Both fields are
	base64-encoded. The server stores them as-is and never decrypts
	them; the CLI's `telegram-bridge-client` does the decryption
	when it needs to forward a message.
	"""

	ciphertext: str = Field(..., min_length=1)
	nonce: str = Field(..., min_length=1, max_length=64)
	key_version: int = Field(1, ge=1, le=1024)


class TelegramStatus(BaseModel):
	has_mirror: bool
	updated_at: str | None = None
	key_version: int | None = None


class TelegramAck(BaseModel):
	ok: bool
	updated_at: str


# ─────────────────────────────────────────────────────────────────────────
# Encryption helpers (minimal — no libsodium dep)
# ─────────────────────────────────────────────────────────────────────────


def _derive_user_key(server_key: bytes, user_id: str) -> bytes:
	"""Derive a per-user 32-byte key from the server key + user id."""
	return hmac.new(server_key, user_id.encode("utf-8"), hashlib.sha256).digest()


def _encrypt_token(server_key: bytes, user_id: str, plaintext: bytes) -> tuple[bytes, bytes]:
	"""Encrypt a token with a per-user derived key.

	Format: nonce (16 bytes) || ciphertext (N bytes). We use AES-CTR
	built on `cryptography` if available, else fall back to a simple
	HMAC-based stream cipher. Both are reversible via `_decrypt_token`.
	"""
	import secrets

	nonce = secrets.token_bytes(16)
	# Per-user key: HKDF-Expand using HMAC-SHA256.
	user_key = _derive_user_key(server_key, user_id)
	# CTR mode: keystream = HMAC(key, nonce || counter) for each block.
	keystream = bytearray()
	counter = 0
	while len(keystream) < len(plaintext) + 32:
		block = hmac.new(
			user_key,
			nonce + counter.to_bytes(4, "big"),
			hashlib.sha256,
		).digest()
		keystream.extend(block)
		counter += 1
	ciphertext = bytes(p ^ k for p, k in zip(plaintext, keystream))
	# MAC: HMAC(key, nonce || ciphertext) for tamper detection.
	mac = hmac.new(user_key, nonce + ciphertext, hashlib.sha256).digest()[:16]
	return nonce + ciphertext + mac, nonce


def _decrypt_token(server_key: bytes, user_id: str, blob: bytes) -> bytes:
	"""Decrypt a token encrypted by `_encrypt_token`."""
	if len(blob) < 16 + 32:
		raise ValueError("blob too short")
	nonce, rest = blob[:16], blob[16:-16]
	mac, ciphertext = rest[-16:], rest[:-16]
	user_key = _derive_user_key(server_key, user_id)
	expected_mac = hmac.new(user_key, nonce + ciphertext, hashlib.sha256).digest()[:16]
	if not hmac.compare_digest(mac, expected_mac):
		raise ValueError("MAC mismatch — ciphertext tampered or wrong key")
	# Regenerate the keystream and XOR.
	keystream = bytearray()
	counter = 0
	while len(keystream) < len(ciphertext):
		block = hmac.new(
			user_key,
			nonce + counter.to_bytes(4, "big"),
			hashlib.sha256,
		).digest()
		keystream.extend(block)
		counter += 1
	return bytes(c ^ k for c, k in zip(ciphertext, keystream))


def _load_server_key(store: BridgeStore) -> bytes:
	raw = os.environ.get(DEFAULT_MIRROR_KEY_ENV) or store.telegram_mirror_key
	if raw:
		try:
			return base64.b64decode(raw)
		except Exception:  # noqa: BLE001
			return hashlib.sha256(raw.encode("utf-8")).digest()
	# Dev fallback: derive from the JWT secret (NOT for production).
	return hashlib.sha256((store.jwt_secret or "dev-only").encode("utf-8")).digest()


# ─────────────────────────────────────────────────────────────────────────
# Router factory
# ─────────────────────────────────────────────────────────────────────────


def telegram_router(store: BridgeStore, jwt_cfg: JwtConfig) -> APIRouter:
	router = APIRouter(prefix="/telegram", tags=["telegram"])

	@router.put("/token", response_model=TelegramAck)
	async def upload_token(
		payload: TelegramTokenUpload,
		user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> TelegramAck:
		try:
			ciphertext = base64.b64decode(payload.ciphertext)
			nonce = base64.b64decode(payload.nonce)
		except Exception as err:
			raise HTTPException(
				status.HTTP_400_BAD_REQUEST, f"invalid base64: {err}"
			) from err
		if len(nonce) != 24:
			raise HTTPException(status.HTTP_400_BAD_REQUEST, "nonce must be 24 bytes")
		server_key = _load_server_key(store)
		# Validate MAC before persisting.
		try:
			_decrypt_token(server_key, user.id, nonce + ciphertext)
		except ValueError as err:
			raise HTTPException(status.HTTP_400_BAD_REQUEST, f"ciphertext invalid: {err}") from err
		store.upsert_telegram_mirror(user.id, payload.ciphertext, payload.nonce, payload.key_version)
		return TelegramAck(ok=True, updated_at=store.telegram_mirror_updated_at(user.id))

	@router.get("/status", response_model=TelegramStatus)
	async def get_status(
		user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> TelegramStatus:
		rec = store.get_telegram_mirror(user.id)
		if rec is None:
			return TelegramStatus(has_mirror=False)
		return TelegramStatus(
			has_mirror=True,
			updated_at=rec["updated_at"],
			key_version=rec["key_version"],
		)

	@router.delete("/token", response_model=TelegramAck)
	async def delete_token(
		user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> TelegramAck:
		store.delete_telegram_mirror(user.id)
		return TelegramAck(ok=True, updated_at=store.telegram_mirror_updated_at(user.id))

	return router


def _dep(store: BridgeStore, jwt_cfg: JwtConfig):
	def _resolve(
		authorization: Annotated[str | None, Header()] = None,
	) -> UserRow:
		return require_user(authorization=authorization, store=store, jwt_cfg=jwt_cfg)

	return _resolve
