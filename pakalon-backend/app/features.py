"""Feature flags system for Pakalon backend.

Provides granular control over features based on deployment mode (cloud vs selfhosted).
"""

from functools import lru_cache
from typing import Literal

from pydantic import BaseModel

from app.config import get_settings


class FeatureFlags(BaseModel):
    """Feature flags for controlling application behavior."""

    # Core features
    openrouter: bool = False
    auth: bool = False
    session_limits: bool = False
    pro_models: bool = False
    analytics: bool = False

    # Provider features
    local_models: bool = True
    cloud_providers: bool = False

    # Billing features
    billing: bool = False
    subscriptions: bool = False

    # Security features
    audit_logging: bool = False
    rate_limiting: bool = False

    # UI features
    ui_openrouter: bool = False
    ui_pro_models: bool = False


# Feature configurations for different modes
OSS_FEATURES = FeatureFlags(
    openrouter=False,
    auth=False,
    session_limits=False,
    pro_models=False,
    analytics=False,
    local_models=True,
    cloud_providers=False,
    billing=False,
    subscriptions=False,
    audit_logging=False,
    rate_limiting=False,
    ui_openrouter=False,
    ui_pro_models=False,
)

CLOUD_FEATURES = FeatureFlags(
    openrouter=True,
    auth=True,
    session_limits=True,
    pro_models=True,
    analytics=True,
    local_models=True,
    cloud_providers=True,
    billing=True,
    subscriptions=True,
    audit_logging=True,
    rate_limiting=True,
    ui_openrouter=True,
    ui_pro_models=True,
)

SELFHOSTED_FEATURES = FeatureFlags(
    openrouter=False,
    auth=False,
    session_limits=False,
    pro_models=False,
    analytics=False,
    local_models=True,
    cloud_providers=False,
    billing=False,
    subscriptions=False,
    audit_logging=False,
    rate_limiting=False,
    ui_openrouter=False,
    ui_pro_models=False,
)


def get_feature_flags() -> FeatureFlags:
    """Get feature flags based on current deployment mode."""
    settings = get_settings()

    if settings.is_selfhosted:
        return SELFHOSTED_FEATURES
    else:
        return CLOUD_FEATURES


@lru_cache
def get_cached_feature_flags() -> FeatureFlags:
    """Get cached feature flags (singleton)."""
    return get_feature_flags()


def is_feature_enabled(feature: str) -> bool:
    """Check if a specific feature is enabled."""
    flags = get_cached_feature_flags()
    return getattr(flags, feature, False)


def get_available_providers() -> list[str]:
    """Get list of available providers based on feature flags."""
    flags = get_cached_feature_flags()
    providers = []

    if flags.local_models:
        providers.extend(["ollama", "lmstudio"])

    if flags.cloud_providers:
        providers.append("openrouter")

    return providers


def get_available_models() -> dict[str, list[str]]:
    """Get available models grouped by provider."""
    flags = get_cached_feature_flags()
    models = {}

    if flags.local_models:
        models["ollama"] = []  # Will be populated dynamically
        models["lmstudio"] = []  # Will be populated dynamically

    if flags.cloud_providers:
        models["openrouter"] = []  # Will be populated dynamically

    return models
