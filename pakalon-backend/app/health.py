"""Provider health check system for Pakalon backend.

Monitors health and latency of local and cloud providers.
"""

import logging
import time
from datetime import datetime
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from app.config import get_settings
from app.features import get_feature_flags

logger = logging.getLogger(__name__)


class ProviderHealth(BaseModel):
    """Health status of a provider."""

    provider_id: str
    provider_type: Literal["local", "cloud"]
    status: Literal["healthy", "degraded", "down"]
    latency_ms: float
    last_checked: datetime
    error: str | None = None
    model_count: int = 0


class ProviderHealthChecker:
    """Checks health of all configured providers."""

    def __init__(self):
        self._health_cache: dict[str, ProviderHealth] = {}
        self._last_check: dict[str, float] = {}

    async def check_provider(
        self, provider_id: str, base_url: str, provider_type: Literal["local", "cloud"]
    ) -> ProviderHealth:
        """Check health of a single provider."""
        start_time = time.time()

        try:
            if provider_type == "local":
                await self._check_local_provider(base_url)
            else:
                await self._check_cloud_provider(base_url)

            latency = (time.time() - start_time) * 1000  # Convert to ms

            health = ProviderHealth(
                provider_id=provider_id,
                provider_type=provider_type,
                status="healthy" if latency < 1000 else "degraded",
                latency_ms=latency,
                last_checked=datetime.now(),
            )
        except Exception as e:
            latency = (time.time() - start_time) * 1000
            health = ProviderHealth(
                provider_id=provider_id,
                provider_type=provider_type,
                status="down",
                latency_ms=latency,
                last_checked=datetime.now(),
                error=str(e),
            )

        self._health_cache[provider_id] = health
        self._last_check[provider_id] = time.time()
        return health

    async def _check_local_provider(self, base_url: str) -> None:
        """Check local provider (Ollama or LM Studio)."""
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Try Ollama endpoint first
            try:
                response = await client.get(f"{base_url.rstrip('/')}/api/tags")
                if response.status_code == 200:
                    return
            except httpx.RequestError:
                pass

            # Try LM Studio endpoint
            try:
                response = await client.get(f"{base_url.rstrip('/')}/v1/models")
                if response.status_code == 200:
                    return
            except httpx.RequestError:
                pass

            raise ConnectionError(f"Cannot connect to provider at {base_url}")

    async def _check_cloud_provider(self, base_url: str) -> None:
        """Check cloud provider (OpenRouter)."""
        settings = get_settings()

        if not settings.openrouter_master_key:
            raise ValueError("OpenRouter API key not configured")

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {settings.openrouter_master_key}"},
            )
            if response.status_code != 200:
                raise ConnectionError(f"OpenRouter returned status {response.status_code}")

    def get_health(self, provider_id: str) -> ProviderHealth | None:
        """Get cached health status for a provider."""
        return self._health_cache.get(provider_id)

    def get_all_health(self) -> list[ProviderHealth]:
        """Get health status for all providers."""
        return list(self._health_cache.values())

    async def check_all_providers(self) -> list[ProviderHealth]:
        """Check health of all configured providers."""
        settings = get_settings()
        flags = get_feature_flags()
        results = []

        # Check local providers
        if flags.local_models:
            if settings.local_ollama_enabled:
                health = await self.check_provider(
                    "ollama", settings.local_ollama_url, "local"
                )
                results.append(health)

            if settings.local_lmstudio_enabled:
                health = await self.check_provider(
                    "lmstudio", settings.local_lmstudio_url, "local"
                )
                results.append(health)

        # Check cloud providers
        if flags.cloud_providers and settings.openrouter_master_key:
            health = await self.check_provider(
                "openrouter", "https://openrouter.ai/api/v1", "cloud"
            )
            results.append(health)

        return results

    def is_provider_healthy(self, provider_id: str) -> bool:
        """Check if a provider is healthy based on cached status."""
        health = self._health_cache.get(provider_id)
        return health is not None and health.status != "down"

    def get_healthy_providers(self) -> list[str]:
        """Get list of healthy provider IDs."""
        return [
            pid
            for pid, health in self._health_cache.items()
            if health.status != "down"
        ]


# Global instance
health_checker = ProviderHealthChecker()
