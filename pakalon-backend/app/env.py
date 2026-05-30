"""Environment variable isolation for Pakalon backend.

Controls which environment variables are loaded based on deployment mode.
"""

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


# Environment variables allowed in self-hosted mode
OSS_ENV_KEYS = [
    "OLLAMA_BASE_URL",
    "OLLAMA_PORT",
    "LMSTUDIO_BASE_URL",
    "LMSTUDIO_PORT",
    "APP_PORT",
    "APP_DEBUG",
    "PAKALON_MODE",
    "PAKALON_OLLAMA_URL",
    "PAKALON_LMSTUDIO_URL",
]

# Additional environment variables allowed in cloud mode
CLOUD_ENV_KEYS = [
    *OSS_ENV_KEYS,
    "OPENROUTER_API_KEY",
    "OPENROUTER_MASTER_KEY",
    "AUTH_SECRET",
    "SESSION_SECRET",
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "POLAR_ACCESS_TOKEN",
    "POLAR_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "JWT_SECRET",
    "FEATURE_OPENROUTER",
    "FEATURE_AUTH",
]


class EnvironmentIsolator:
    """Isolates environment variables based on deployment mode."""

    def __init__(self, is_cloud: bool = False):
        self.is_cloud = is_cloud
        self.allowed_keys = CLOUD_ENV_KEYS if is_cloud else OSS_ENV_KEYS
        self._original_values: dict[str, str | None] = {}

    def load_environment(self) -> None:
        """Load environment variables based on mode."""
        # Store original values for potential restoration
        for key in self.allowed_keys:
            self._original_values[key] = os.environ.get(key)

        # In self-hosted mode, remove cloud-only variables
        if not self.is_cloud:
            cloud_only_keys = [
                "OPENROUTER_API_KEY",
                "OPENROUTER_MASTER_KEY",
                "AUTH_SECRET",
                "SESSION_SECRET",
                "SUPABASE_URL",
                "SUPABASE_ANON_KEY",
                "SUPABASE_SERVICE_ROLE_KEY",
                "SUPABASE_JWT_SECRET",
                "POLAR_ACCESS_TOKEN",
                "POLAR_WEBHOOK_SECRET",
                "RESEND_API_KEY",
                "JWT_SECRET",
            ]

            for key in cloud_only_keys:
                if key in os.environ:
                    logger.warning(f"Environment variable {key} ignored in self-hosted mode")
                    del os.environ[key]

    def get_allowed_keys(self) -> list[str]:
        """Get list of allowed environment variable keys."""
        return self.allowed_keys.copy()

    def is_key_allowed(self, key: str) -> bool:
        """Check if an environment variable key is allowed."""
        return key in self.allowed_keys

    def sanitize_env_for_logging(self) -> dict[str, Any]:
        """Sanitize environment variables for safe logging."""
        sanitized = {}
        sensitive_patterns = ["KEY", "SECRET", "TOKEN", "PASSWORD"]

        for key in self.allowed_keys:
            value = os.environ.get(key)
            if value:
                if any(pattern in key.upper() for pattern in sensitive_patterns):
                    sanitized[key] = "***REDACTED***"
                else:
                    sanitized[key] = value
            else:
                sanitized[key] = None

        return sanitized


# Global instance
_isolator: EnvironmentIsolator | None = None


def get_environment_isolator() -> EnvironmentIsolator:
    """Get the global environment isolator."""
    global _isolator
    if _isolator is None:
        from app.config import get_settings

        settings = get_settings()
        _isolator = EnvironmentIsolator(is_cloud=not settings.is_selfhosted)
    return _isolator


def initialize_environment(is_cloud: bool = False) -> EnvironmentIsolator:
    """Initialize environment isolation."""
    global _isolator
    _isolator = EnvironmentIsolator(is_cloud=is_cloud)
    _isolator.load_environment()
    return _isolator
