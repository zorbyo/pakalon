"""Configuration obfuscation for Pakalon backend.

Provides secure configuration handling and API key management.
"""

import logging
import os
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)


class ConfigObfuscator:
    """Obfuscates sensitive configuration values."""

    SENSITIVE_KEYS = [
        "api_key",
        "api_secret",
        "access_token",
        "secret_key",
        "password",
        "jwt_secret",
        "webhook_secret",
    ]

    @classmethod
    def obfuscate_dict(cls, data: dict[str, Any]) -> dict[str, Any]:
        """Obfuscate sensitive values in a dictionary."""
        obfuscated = {}
        for key, value in data.items():
            if any(sensitive in key.lower() for sensitive in cls.SENSITIVE_KEYS):
                obfuscated[key] = cls.redact_value(value)
            else:
                obfuscated[key] = value
        return obfuscated

    @classmethod
    def redact_value(cls, value: Any) -> str:
        """Redact a sensitive value."""
        if isinstance(value, str):
            if len(value) < 8:
                return "***"
            return f"{value[:4]}...{value[-4:]}"
        return "***"

    @classmethod
    def sanitize_for_logging(cls, config: dict[str, Any]) -> dict[str, Any]:
        """Sanitize configuration for safe logging."""
        return cls.obfuscate_dict(config)


class ApiKeyManager:
    """Manages API keys securely."""

    def __init__(self):
        self._keys: dict[str, str] = {}

    def get_key(self, provider: str) -> str | None:
        """Get API key for a provider."""
        # First check environment variables
        env_key = os.environ.get(f"{provider.upper()}_API_KEY")
        if env_key:
            return env_key

        # Then check in-memory cache
        return self._keys.get(provider)

    def set_key(self, provider: str, key: str) -> None:
        """Set API key for a provider."""
        self._keys[provider] = key

    def has_key(self, provider: str) -> bool:
        """Check if API key exists for a provider."""
        return self.get_key(provider) is not None

    def get_redacted_key(self, provider: str) -> str:
        """Get redacted API key for safe logging."""
        key = self.get_key(provider)
        if key:
            return ConfigObfuscator.redact_value(key)
        return "***"

    def clear_keys(self) -> None:
        """Clear all cached keys."""
        self._keys.clear()


# Global instances
_api_key_manager: ApiKeyManager | None = None


def get_api_key_manager() -> ApiKeyManager:
    """Get the global API key manager."""
    global _api_key_manager
    if _api_key_manager is None:
        _api_key_manager = ApiKeyManager()
    return _api_key_manager


def get_secure_config() -> dict[str, Any]:
    """Get configuration with sensitive values obfuscated."""
    settings = get_settings()
    config = {
        "mode": settings.pakalon_mode,
        "environment": settings.environment,
        "local_ollama_url": settings.local_ollama_url,
        "local_lmstudio_url": settings.local_lmstudio_url,
        "local_ollama_enabled": settings.local_ollama_enabled,
        "local_lmstudio_enabled": settings.local_lmstudio_enabled,
    }

    # Add cloud-specific config only if not self-hosted
    if not settings.is_selfhosted:
        config.update({
            "openrouter_key_set": bool(settings.openrouter_master_key),
            "supabase_url_set": bool(settings.supabase_url),
        })

    return ConfigObfuscator.sanitize_for_logging(config)
