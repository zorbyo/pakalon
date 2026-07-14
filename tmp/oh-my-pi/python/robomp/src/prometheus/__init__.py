"""Prometheus metrics for the Pakalon bridge.

Exposes a `/metrics` endpoint that Prometheus scrapes on a 15s
schedule. See `exporter.py` for the metric definitions and the
`prometheus_router()` factory for the FastAPI route.

This subpackage is a thin adapter around `prometheus_client`. The
single source of truth is `exporter.py`; the router is split out
to make the route file leaner.
"""
from __future__ import annotations

from robomp.prometheus.exporter import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    format_metrics_summary,
    inc_auth_failure,
    inc_dunning_reminder,
    inc_polar_event,
    inc_request,
    inc_usage_event,
    observe_request,
    prometheus_router,
    set_active_jobs,
    set_telegram_mirrors,
)

__all__ = [
    "CONTENT_TYPE_LATEST",
    "REGISTRY",
    "format_metrics_summary",
    "inc_auth_failure",
    "inc_dunning_reminder",
    "inc_polar_event",
    "inc_request",
    "inc_usage_event",
    "observe_request",
    "prometheus_router",
    "set_active_jobs",
    "set_telegram_mirrors",
]
