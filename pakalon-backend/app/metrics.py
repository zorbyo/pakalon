"""Metrics collection for Pakalon backend.

Tracks usage metrics for monitoring and analytics.
"""

import logging
import time
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.config import get_settings
from app.features import get_feature_flags

logger = logging.getLogger(__name__)


class Metric(BaseModel):
    """A single metric data point."""

    name: str
    value: float
    labels: dict[str, str] = {}
    timestamp: datetime


class ProviderMetric(BaseModel):
    """Provider-specific metric."""

    provider_id: str
    latency_ms: float
    success: bool
    tokens: int | None = None
    model: str | None = None


class TokenMetric(BaseModel):
    """Token usage metric."""

    provider_id: str
    model_id: str
    input_tokens: int
    output_tokens: int


class MetricsCollector:
    """Collects and stores metrics for monitoring."""

    def __init__(self, max_buffer_size: int = 100):
        self._metrics: list[Metric] = []
        self._provider_metrics: list[ProviderMetric] = []
        self._token_metrics: list[TokenMetric] = []
        self._max_buffer_size = max_buffer_size

    def record_metric(self, name: str, value: float, labels: dict[str, str] | None = None) -> None:
        """Record a metric."""
        metric = Metric(
            name=name,
            value=value,
            labels=labels or {},
            timestamp=datetime.now(),
        )
        self._metrics.append(metric)

        if len(self._metrics) >= self._max_buffer_size:
            self._flush_metrics()

    def record_provider_latency(self, provider_id: str, latency_ms: float, success: bool) -> None:
        """Record provider latency."""
        metric = ProviderMetric(
            provider_id=provider_id,
            latency_ms=latency_ms,
            success=success,
        )
        self._provider_metrics.append(metric)

        # Also record as generic metric
        self.record_metric(
            "provider_latency_ms",
            latency_ms,
            {"provider": provider_id, "success": str(success)},
        )

    def record_token_usage(self, provider_id: str, model_id: str, input_tokens: int, output_tokens: int) -> None:
        """Record token usage."""
        metric = TokenMetric(
            provider_id=provider_id,
            model_id=model_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        self._token_metrics.append(metric)

        total = input_tokens + output_tokens
        self.record_metric(
            "token_usage",
            total,
            {"provider": provider_id, "model": model_id},
        )

    def record_provider_health(self, provider_id: str, healthy: bool, latency_ms: float) -> None:
        """Record provider health status."""
        self.record_metric(
            "provider_health",
            1.0 if healthy else 0.0,
            {"provider": provider_id},
        )

    def record_error(self, provider_id: str, error_type: str, error_message: str) -> None:
        """Record an error."""
        self.record_metric(
            "error_count",
            1.0,
            {"provider": provider_id, "error_type": error_type},
        )

    def _flush_metrics(self) -> None:
        """Flush metrics buffer (log or send to external service)."""
        if not self._metrics:
            return

        settings = get_settings()

        # In development, just log metrics
        if settings.is_development:
            for metric in self._metrics[-5:]:  # Log last 5 metrics
                logger.debug(f"Metric: {metric.name}={metric.value} {metric.labels}")

        # Clear buffer
        self._metrics.clear()

    def get_stats(self) -> dict[str, Any]:
        """Get collector statistics."""
        return {
            "buffered_metrics": len(self._metrics),
            "total_provider_metrics": len(self._provider_metrics),
            "total_token_metrics": len(self._token_metrics),
        }


# Global instance
metrics_collector = MetricsCollector()
