"""FastAPI router mounting for the Pakalon bridge.

Exposes a single `mount_bridge_routes(app, ...)` function that the main
`create_app()` in `server.py` calls. This keeps the bridge self-contained:
its router is wired in, but it doesn't leak into the robomp webhook flow.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import FastAPI

from robomp.bridge.auth import JwtConfig, auth_router
from robomp.bridge.auditor import auditor_router
from robomp.bridge.billing import billing_router
from robomp.bridge.models_api import models_router
from robomp.bridge.store import BridgeStore

log = logging.getLogger(__name__)


def mount_bridge_routes(
	app: FastAPI,
	*,
	store: BridgeStore,
	jwt_secret: bytes,
	verification_uri: str = "https://pakalon.dev/auth",
	polar_api_key: str | None = None,
	polar_product_id: str | None = None,
	polar_webhook_secret: str | None = None,
) -> None:
	"""Mount all bridge routers onto `app`. Idempotent — safe to call twice."""
	if getattr(app.state, "_bridge_mounted", False):
		return
	jwt_cfg = JwtConfig(secret=jwt_secret)

	app.include_router(auth_router(store, jwt_cfg, verification_uri))
	app.include_router(
		billing_router(
			store,
			jwt_cfg,
			polar_api_key=polar_api_key,
			polar_product_id=polar_product_id,
			polar_webhook_secret=polar_webhook_secret,
		)
	)
	app.include_router(auditor_router(store, jwt_cfg))
	app.include_router(models_router(store, jwt_cfg))

	app.state._bridge_mounted = True
	log.info("pakalon bridge routes mounted")


def bridge_store_from_env() -> BridgeStore:
	"""Helper for tests + local dev: build a BridgeStore from env or default."""
	path = os.environ.get("PAKALON_BRIDGE_DB", "./data/pakalon-bridge.sqlite")
	return BridgeStore(sqlite_path=__import__("pathlib").Path(path))


def jwt_secret_from_env() -> bytes:
	raw = os.environ.get("PAKALON_JWT_SECRET", "")
	if not raw:
		# Deterministic dev secret so multiple CLI processes in the same
		# environment can validate each other's tokens. Production
		# deployments must set the env var.
		raw = "pakalon-dev-secret-do-not-use-in-prod"
	return raw.encode()


__all__ = ["bridge_store_from_env", "jwt_secret_from_env", "mount_bridge_routes"]
