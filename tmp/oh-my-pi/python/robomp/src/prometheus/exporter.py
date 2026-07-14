"""Prometheus metrics for the Pakalon bridge.

Exposes a `/metrics` endpoint that Prometheus scrapes on a 15s
schedule. The metrics cover:

  - Bridge throughput (`pakalon_bridge_requests_total{path, status}`)
  - Active phase jobs (`pakalon_active_phase_jobs{phase, state}`)
  - Auth failures (`pakalon_auth_failures_total{reason}`)
  - Usage events (`pakalon_usage_events_total{model, tier}`)
  - Polar events (`pakalon_polar_events_total{type, flipped}`)
  - Telegram mirrors (`pakalon_telegram_mirrors`)

The exporter is a thin wrapper around the prometheus_client
`CollectorRegistry` + `generate_latest()` pattern. The bridge's
existing routes call `inc_counter()` to bump the relevant
counters, so the metrics are always live.

Wired into the FastAPI app via `mount_prometheus_routes(app,
store)` in `bridge/routes.py`.
"""
from __future__ import annotations

import logging
from typing import Iterable

from fastapi import APIRouter, Response

log = logging.getLogger(__name__)

# Import prometheus_client lazily — the bridge still works if it's
# not installed (the /metrics endpoint just returns a stub).
try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        Counter,
        Gauge,
        Histogram,
        generate_latest,
    )
    _PROMETHEUS_AVAILABLE = True
except ImportError:  # pragma: no cover — optional dep
    _PROMETHEUS_AVAILABLE = False
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4"
    CollectorRegistry = None  # type: ignore[assignment]
    Counter = Gauge = Histogram = None  # type: ignore[assignment]
    generate_latest = None  # type: ignore[assignment]


# ─────────────────────────────────────────────────────────────────────────
# Metric registry
# ─────────────────────────────────────────────────────────────────────────


if _PROMETHEUS_AVAILABLE:
    REGISTRY = CollectorRegistry()

    REQUESTS = Counter(
        "pakalon_bridge_requests_total",
        "Total HTTP requests served by the Pakalon bridge",
        ["path", "method", "status"],
        registry=REGISTRY,
    )
    REQUEST_DURATION = Histogram(
        "pakalon_bridge_request_duration_seconds",
        "Bridge request duration in seconds",
        ["path", "method"],
        registry=REGISTRY,
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
    )
    ACTIVE_PHASE_JOBS = Gauge(
        "pakalon_active_phase_jobs",
        "Active phase jobs by phase + state",
        ["phase", "state"],
        registry=REGISTRY,
    )
    AUTH_FAILURES = Counter(
        "pakalon_auth_failures_total",
        "Failed auth attempts by reason",
        ["reason"],
        registry=REGISTRY,
    )
    USAGE_EVENTS = Counter(
        "pakalon_usage_events_total",
        "Usage events processed, by model + tier",
        ["model", "tier"],
        registry=REGISTRY,
    )
    POLAR_EVENTS = Counter(
        "pakalon_polar_events_total",
        "Polar.sh events processed, by type + flip outcome",
        ["type", "flipped"],
        registry=REGISTRY,
    )
    TELEGRAM_MIRRORS = Gauge(
        "pakalon_telegram_mirrors",
        "Number of users with a Telegram bot token mirrored",
        registry=REGISTRY,
    )
    DUNNING_REMINDERS = Counter(
        "pakalon_dunning_reminders_total",
        "Dunning reminders sent, by tier",
        ["tier"],
        registry=REGISTRY,
    )
else:
    # Stubs that no-op. Useful in tests + dev environments without
    # prometheus_client installed.
    class _Stub:
        def labels(self, **_kwargs: str) -> "_Stub":
            return self

        def inc(self, _amount: float = 1) -> None:
            return None

        def dec(self, _amount: float = 1) -> None:
            return None

        def set(self, _value: float) -> None:
            return None

        def observe(self, _value: float) -> None:
            return None

    REGISTRY = None  # type: ignore[assignment]
    REQUESTS = REQUEST_DURATION = ACTIVE_PHASE_JOBS = AUTH_FAILURES = (  # type: ignore[assignment]
        USAGE_EVENTS
    ) = POLAR_EVENTS = TELEGRAM_MIRRORS = DUNNING_REMINDERS = _Stub()


# ─────────────────────────────────────────────────────────────────────────
# Convenience functions for bridge code to call
# ─────────────────────────────────────────────────────────────────────────


def inc_request(path: str, method: str, status: int) -> None:
    REQUESTS.labels(path=path, method=method, status=str(status)).inc()


def observe_request(path: str, method: str, duration_s: float) -> None:
    REQUEST_DURATION.labels(path=path, method=method).observe(duration_s)


def set_active_jobs(phase: str, state: str, count: int) -> None:
    ACTIVE_PHASE_JOBS.labels(phase=phase, state=state).set(count)


def inc_auth_failure(reason: str) -> None:
    AUTH_FAILURES.labels(reason=reason).inc()


def inc_usage_event(model: str, tier: str) -> None:
    USAGE_EVENTS.labels(model=model, tier=tier).inc()


def inc_polar_event(event_type: str, flipped: str) -> None:
    POLAR_EVENTS.labels(type=event_type, flipped=flipped).inc()


def set_telegram_mirrors(count: int) -> None:
    TELEGRAM_MIRRORS.set(count)


def inc_dunning_reminder(tier: str) -> None:
    DUNNING_REMINDERS.labels(tier=tier).inc()


# ─────────────────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────────────────


def prometheus_router() -> APIRouter:
    router = APIRouter(tags=["metrics"])

    @router.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        if not _PROMETHEUS_AVAILABLE:
            return Response(
                content=b"# prometheus_client not installed; metrics disabled\n",
                media_type="text/plain",
            )
        return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)

    @router.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "prometheus": "available" if _PROMETHEUS_AVAILABLE else "stub"}

    return router


def format_metrics_summary(metrics: Iterable[str]) -> str:
    """Render a human-readable summary of the currently-registered
    metrics. Used by the `/` debug page."""
    lines = ["# Active metrics", ""]
    for m in sorted(metrics):
        lines.append(f"- `{m}`")
    return "\n".join(lines)
