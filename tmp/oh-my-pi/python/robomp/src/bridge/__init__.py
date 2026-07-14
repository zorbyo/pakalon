"""Pakalon bridge endpoints for auth, billing, usage, and auditor.

Hosts the four endpoint groups that the Pakalon CLI talks to:

  - /auth/device-code   — start a 6-digit pairing flow.
  - /auth/token         — poll for completion.
  - /auth/logout        — invalidate a JWT.
  - /billing/me         — read tier + current-period usage.
  - /billing/upgrade    — create a Polar checkout session.
  - /billing/webhook    — receive Polar events.
  - /billing/usage      — batched usage event ingestion.
  - /agent/auditor      — run the phase-3 auditor over a project.
  - /agent/phase        — dispatch a single phase task.
  - /models             — list the latest OpenRouter catalog.
  - /models/refresh     — force-refresh the OpenRouter catalog.

The bridge is a thin FastAPI router; the heavy work (model refresh cron,
Polar checkout creation, auditor LLM calls) lives in dedicated modules.
State is persisted in a separate `bridge` SQLite file under
`./data/pakalon-bridge.sqlite` so it stays separate from the robomp
event queue.
"""
from __future__ import annotations

from robomp.bridge.auth import (
    DeviceCodeRequest,
    DeviceCodeResponse,
    TokenRequest,
    TokenResponse,
    auth_router,
)
from robomp.bridge.billing import (
    BillingSummary,
    PolarCheckoutRequest,
    PolarCheckoutResponse,
    UsageEvent,
    billing_router,
)
from robomp.bridge.auditor import (
    AuditorIteration,
    AuditorRequest,
    AuditorResponse,
    auditor_router,
)
from robomp.bridge.models_api import (
    ModelSummary,
    ModelsResponse,
    models_router,
)
from robomp.bridge.store import BridgeStore
from robomp.bridge.routes import mount_bridge_routes

__all__ = [
    "AuditorIteration",
    "AuditorRequest",
    "AuditorResponse",
    "BillingSummary",
    "BridgeStore",
    "DeviceCodeRequest",
    "DeviceCodeResponse",
    "ModelSummary",
    "ModelsResponse",
    "PolarCheckoutRequest",
    "PolarCheckoutResponse",
    "TokenRequest",
    "TokenResponse",
    "UsageEvent",
    "auth_router",
    "auditor_router",
    "billing_router",
    "models_router",
    "mount_bridge_routes",
]
