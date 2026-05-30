"""API key obfuscation middleware for Pakalon backend.

Ensures OpenRouter API keys are not exposed in self-hosted mode.
"""

import logging
from typing import Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.features import get_feature_flags

logger = logging.getLogger(__name__)


class ApiKeyObfuscationMiddleware(BaseHTTPMiddleware):
    """Middleware to obfuscate API keys based on deployment mode."""

    async def dispatch(self, request: Request, call_next) -> Response:
        settings = get_settings()
        flags = get_feature_flags()

        # In self-hosted mode, block access to OpenRouter-related endpoints
        if settings.is_selfhosted:
            path = request.url.path

            # Block OpenRouter-related endpoints
            if any(
                keyword in path.lower()
                for keyword in ["openrouter", "cloud", "billing", "subscription"]
            ):
                logger.warning(f"Blocked access to {path} in self-hosted mode")
                return Response(
                    content='{"detail": "This feature is not available in self-hosted mode"}',
                    status_code=403,
                    media_type="application/json",
                )

        # Process the request
        response = await call_next(request)

        # Remove sensitive headers that might expose API keys
        if "x-api-key" in response.headers:
            del response.headers["x-api-key"]

        if "x-openrouter-key" in response.headers:
            del response.headers["x-openrouter-key"]

        return response


class EnvironmentVariableGuard:
    """Guards against exposure of sensitive environment variables."""

    SENSITIVE_VARS = [
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
    def sanitize_env(cls, env_vars: dict[str, Any]) -> dict[str, Any]:
        """Remove sensitive variables from environment dict."""
        sanitized = env_vars.copy()
        for var in cls.SENSITIVE_VARS:
            if var in sanitized:
                sanitized[var] = "***REDACTED***"
        return sanitized

    @classmethod
    def validate_env(cls, is_selfhosted: bool) -> list[str]:
        """Validate environment variables and return warnings."""
        warnings = []

        if is_selfhosted:
            # In self-hosted mode, warn if cloud variables are set
            import os

            for var in cls.SENSITIVE_VARS:
                if os.environ.get(var):
                    warnings.append(
                        f"Environment variable {var} is set but will be ignored in self-hosted mode"
                    )

        return warnings


def redact_api_key(key: str) -> str:
    """Redact an API key for safe logging."""
    if not key or len(key) < 8:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def log_api_key_usage(provider: str, user_id: str | None = None) -> None:
    """Log API key usage for audit purposes."""
    settings = get_settings()

    if settings.is_selfhosted:
        # In self-hosted mode, don't log API key usage
        return

    logger.info(
        f"API key usage: provider={provider}, user_id={user_id}",
        extra={"provider": provider, "user_id": user_id},
    )
