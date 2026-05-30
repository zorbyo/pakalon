"""Security and runtime validation for Pakalon backend.

Validates environment and configuration at startup.
"""

import logging
import os
import re
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)


class SecurityValidator:
    """Validates security configuration at runtime."""

    SENSITIVE_VARS: list[str] = [
        "OPENROUTER_API_KEY",
        "OPENROUTER_MASTER_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_JWT_SECRET",
        "POLAR_ACCESS_TOKEN",
        "POLAR_WEBHOOK_SECRET",
        "RESEND_API_KEY",
        "JWT_SECRET",
    ]

    @classmethod
    def validate_environment(cls, is_selfhosted: bool) -> list[str]:
        """Validate environment variables and return warnings."""
        warnings: list[str] = []

        if is_selfhosted:
            # In self-hosted mode, warn if cloud variables are set
            for var in cls.SENSITIVE_VARS:
                if os.environ.get(var):
                    warnings.append(
                        f"Environment variable {var} is set but will be ignored in self-hosted mode"
                    )

        # Validate JWT secret length
        jwt_secret = os.environ.get("JWT_SECRET", "")
        if jwt_secret and len(jwt_secret) < 32:
            warnings.append("JWT_SECRET should be at least 32 characters")

        # Validate database URL format
        db_url = os.environ.get("DATABASE_URL", "")
        if db_url and not db_url.startswith(("postgresql://", "postgresql+psycopg://", "sqlite+")):
            warnings.append("DATABASE_URL format may be invalid")

        return warnings

    @classmethod
    def sanitize_env(cls, env_vars: dict[str, Any]) -> dict[str, Any]:
        """Remove sensitive variables from environment dict."""
        sanitized = env_vars.copy()
        for var in cls.SENSITIVE_VARS:
            if var in sanitized:
                sanitized[var] = "***REDACTED***"
        return sanitized

    @classmethod
    def redact_api_key(cls, key: str) -> str:
        """Redact an API key for safe logging."""
        if not key or len(key) < 8:
            return "***"
        return f"{key[:4]}...{key[-4:]}"


class RuntimeValidator:
    """Validates runtime configuration."""

    @staticmethod
    def validate_local_provider_ports() -> list[str]:
        """Validate local provider ports."""
        warnings: list[str] = []

        ollama_url = os.environ.get("PAKALON_OLLAMA_URL", "http://localhost:11434")
        lmstudio_url = os.environ.get("PAKALON_LMSTUDIO_URL", "http://localhost:1234")

        # Validate Ollama URL
        if not RuntimeValidator._is_valid_local_url(ollama_url):
            warnings.append(f"PAKALON_OLLAMA_URL may be invalid: {ollama_url}")

        # Validate LM Studio URL
        if not RuntimeValidator._is_valid_local_url(lmstudio_url):
            warnings.append(f"PAKALON_LMSTUDIO_URL may be invalid: {lmstudio_url}")

        return warnings

    @staticmethod
    def _is_valid_local_url(url: str) -> bool:
        """Check if URL is a valid local URL."""
        pattern = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?(/.*)?$"
        return bool(re.match(pattern, url))

    @staticmethod
    def validate_provider_url(url: str, provider_name: str) -> tuple[bool, str | None]:
        """Validate a provider URL."""
        if not url:
            return False, f"{provider_name} URL is empty"

        if not url.startswith(("http://", "https://")):
            return False, f"{provider_name} URL must start with http:// or https://"

        return True, None


def validate_startup() -> dict[str, Any]:
    """Validate all configuration at startup."""
    settings = get_settings()

    result: dict[str, Any] = {
        "valid": True,
        "warnings": [],
        "errors": [],
        "mode": settings.pakalon_mode,
    }

    # Validate environment
    env_warnings = SecurityValidator.validate_environment(settings.is_selfhosted)
    result["warnings"].extend(env_warnings)

    # Validate local provider ports (in self-hosted mode)
    if settings.is_selfhosted:
        port_warnings = RuntimeValidator.validate_local_provider_ports()
        result["warnings"].extend(port_warnings)

    # Validate critical configuration
    if not settings.is_selfhosted:
        if not settings.openrouter_master_key:
            result["warnings"].append("OPENROUTER_MASTER_KEY not set (cloud mode)")

        if not settings.supabase_url:
            result["warnings"].append("SUPABASE_URL not set (cloud mode)")

    # Log results
    if result["warnings"]:
        for warning in result["warnings"]:
            logger.warning(f"Startup validation: {warning}")

    if result["errors"]:
        for error in result["errors"]:
            logger.error(f"Startup validation error: {error}")
        result["valid"] = False

    return result
