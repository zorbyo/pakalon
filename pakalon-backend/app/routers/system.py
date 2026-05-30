"""Health check, features, and system info router for Pakalon backend."""

import logging
from typing import Any

from fastapi import APIRouter

from app.config import get_settings
from app.features import get_feature_flags, get_available_providers
from app.health import health_checker
from app.providers import get_registry
from app.metrics import metrics_collector
from app.cache import response_cache
from app.connection_pool import connection_pool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health")
async def system_health() -> dict[str, Any]:
    """
    Get system health status including provider health.

    Returns comprehensive health information about the system including:
    - Current deployment mode (cloud/selfhosted)
    - Feature flags status
    - Provider health status with latency
    """
    settings = get_settings()
    flags = get_feature_flags()

    # Check provider health
    provider_health = await health_checker.check_all_providers()

    return {
        "status": "ok",
        "mode": settings.pakalon_mode,
        "features": flags.model_dump(),
        "providers": [h.model_dump() for h in provider_health],
    }


@router.get("/features")
async def get_features() -> dict[str, Any]:
    """
    Get available features based on deployment mode.

    Returns:
    - features: Feature flags for the current mode
    - providers: List of available provider IDs
    """
    flags = get_feature_flags()
    providers = get_available_providers()

    return {
        "features": flags.model_dump(),
        "providers": providers,
    }


@router.get("/providers")
async def list_providers() -> dict[str, Any]:
    """
    List all registered providers and their status.

    Returns provider information including:
    - Provider ID and name
    - Provider type (local/cloud)
    - Enabled status
    - Capabilities
    """
    registry = get_registry()
    providers = registry.get_enabled_providers()

    return {
        "providers": [
            {
                "id": p.id,
                "name": p.name,
                "type": p.provider_type,
                "enabled": p.enabled,
                "capabilities": p.capabilities,
            }
            for p in providers
        ],
        "total": len(providers),
    }


@router.get("/providers/health")
async def providers_health() -> dict[str, Any]:
    """
    Get health status of all providers.

    Returns:
    - providers: List of provider health statuses
    - healthy_count: Number of healthy providers
    - total_count: Total number of providers checked
    """
    provider_health = await health_checker.check_all_providers()

    return {
        "providers": [h.model_dump() for h in provider_health],
        "healthy_count": len([h for h in provider_health if h.status == "healthy"]),
        "total_count": len(provider_health),
    }


@router.get("/providers/{provider_id}/health")
async def provider_health(provider_id: str) -> dict[str, Any]:
    """
    Get health status of a specific provider.

    Returns provider health including:
    - Status (healthy/degraded/down)
    - Latency in milliseconds
    - Last checked timestamp
    - Error message if unhealthy
    """
    health = health_checker.get_health(provider_id)

    if not health:
        return {
            "provider_id": provider_id,
            "status": "unknown",
            "error": "Provider not checked yet",
        }

    return health.model_dump()


@router.get("/metrics")
async def get_metrics() -> dict[str, Any]:
    """
    Get system metrics.

    Returns:
    - metrics_collector: Metrics collector statistics
    - connection_pool: Connection pool statistics
    - response_cache: Cache statistics
    """
    return {
        "metrics": metrics_collector.get_stats(),
        "connection_pool": connection_pool.get_stats(),
        "response_cache": response_cache.get_stats(),
    }


@router.get("/config")
async def get_config() -> dict[str, Any]:
    """
    Get current configuration (safe for client consumption).

    Returns non-sensitive configuration information.
    """
    settings = get_settings()
    flags = get_feature_flags()

    return {
        "mode": settings.pakalon_mode,
        "environment": settings.environment,
        "features": flags.model_dump(),
        "providers": {
            "ollama": {
                "enabled": settings.local_ollama_enabled,
                "url": settings.local_ollama_url,
            },
            "lmstudio": {
                "enabled": settings.local_lmstudio_enabled,
                "url": settings.local_lmstudio_url,
            },
        },
    }
