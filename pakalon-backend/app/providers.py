"""Provider registry system for Pakalon backend.

Manages provider registration and availability based on feature flags.
"""

import logging
from typing import Any, Literal

from pydantic import BaseModel

from app.config import get_settings
from app.features import get_feature_flags

logger = logging.getLogger(__name__)


class ProviderConfig(BaseModel):
    """Configuration for a provider."""

    base_url: str
    timeout: int = 30000
    api_key: str | None = None
    headers: dict[str, str] | None = None


class ModelProvider(BaseModel):
    """A registered model provider."""

    id: str
    name: str
    provider_type: Literal["local", "cloud"]
    enabled: bool
    config: ProviderConfig
    capabilities: list[str] = []


class ProviderRegistry:
    """Registry for managing model providers."""

    def __init__(self):
        self._providers: dict[str, ModelProvider] = {}
        self._features = get_feature_flags()

    def register_provider(self, provider: ModelProvider) -> None:
        """Register a provider if feature flags allow it."""
        # Check if cloud provider is allowed
        if provider.provider_type == "cloud" and not self._features.cloud_providers:
            logger.warning(f"Cloud provider {provider.id} disabled in self-hosted mode")
            return

        # Check if local provider is allowed
        if provider.provider_type == "local" and not self._features.local_models:
            logger.warning(f"Local provider {provider.id} disabled")
            return

        self._providers[provider.id] = provider
        logger.info(f"Registered provider: {provider.id} ({provider.provider_type})")

    def get_provider(self, provider_id: str) -> ModelProvider | None:
        """Get a registered provider."""
        return self._providers.get(provider_id)

    def get_enabled_providers(self) -> list[ModelProvider]:
        """Get all enabled providers."""
        return [p for p in self._providers.values() if p.enabled]

    def get_providers_by_type(self, provider_type: Literal["local", "cloud"]) -> list[ModelProvider]:
        """Get providers by type."""
        return [p for p in self._providers.values() if p.provider_type == provider_type]

    def is_provider_available(self, provider_id: str) -> bool:
        """Check if a provider is available."""
        provider = self._providers.get(provider_id)
        return provider is not None and provider.enabled

    def get_available_provider_ids(self) -> list[str]:
        """Get list of available provider IDs."""
        return [p.id for p in self.get_enabled_providers()]


# Global instance
registry = ProviderRegistry()


def register_default_providers() -> None:
    """Register default providers based on feature flags."""
    settings = get_settings()
    flags = get_feature_flags()

    # Register local providers
    if flags.local_models:
        # Register Ollama
        ollama_provider = ModelProvider(
            id="ollama",
            name="Ollama",
            provider_type="local",
            enabled=settings.local_ollama_enabled,
            config=ProviderConfig(
                base_url=settings.local_ollama_url,
                timeout=30000,
            ),
            capabilities=["chat", "embeddings"],
        )
        registry.register_provider(ollama_provider)

        # Register LM Studio
        lmstudio_provider = ModelProvider(
            id="lmstudio",
            name="LM Studio",
            provider_type="local",
            enabled=settings.local_lmstudio_enabled,
            config=ProviderConfig(
                base_url=settings.local_lmstudio_url,
                timeout=30000,
            ),
            capabilities=["chat", "embeddings"],
        )
        registry.register_provider(lmstudio_provider)

    # Register cloud providers
    if flags.cloud_providers and settings.openrouter_master_key:
        openrouter_provider = ModelProvider(
            id="openrouter",
            name="OpenRouter",
            provider_type="cloud",
            enabled=True,
            config=ProviderConfig(
                base_url="https://openrouter.ai/api/v1",
                timeout=60000,
                api_key=settings.openrouter_master_key,
            ),
            capabilities=["chat", "embeddings", "completions"],
        )
        registry.register_provider(openrouter_provider)


def get_registry() -> ProviderRegistry:
    """Get the global provider registry."""
    return registry


def get_available_providers() -> list[ModelProvider]:
    """Get all available providers."""
    return registry.get_enabled_providers()


def is_provider_available(provider_id: str) -> bool:
    """Check if a provider is available."""
    return registry.is_provider_available(provider_id)
