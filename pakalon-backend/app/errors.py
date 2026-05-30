"""Custom error hierarchy for Pakalon backend.

Provides structured error types for provider failures, API errors, and validation errors.
"""

import logging

logger = logging.getLogger(__name__)


class PakalonError(Exception):
    """Base error for all Pakalon errors."""

    def __init__(self, message: str, code: str = "UNKNOWN"):
        super().__init__(message)
        self.code = code
        self.message = message


class ProviderError(PakalonError):
    """Error related to provider operations."""

    def __init__(
        self,
        message: str,
        provider_id: str = "unknown",
        code: str = "PROVIDER_ERROR",
        retryable: bool = False,
        status_code: int | None = None,
    ):
        super().__init__(message, code)
        self.provider_id = provider_id
        self.retryable = retryable
        self.status_code = status_code


class OllamaConnectionError(ProviderError):
    """Cannot connect to Ollama."""

    def __init__(self, port: int = 11434, message: str | None = None):
        msg = message or f"Cannot connect to Ollama on port {port}"
        super().__init__(
            msg,
            provider_id="ollama",
            code="OLLAMA_CONNECTION_FAILED",
            retryable=True,
        )
        self.port = port


class LMStudioConnectionError(ProviderError):
    """Cannot connect to LM Studio."""

    def __init__(self, port: int = 1234, message: str | None = None):
        msg = message or f"Cannot connect to LM Studio on port {port}"
        super().__init__(
            msg,
            provider_id="lmstudio",
            code="LMSTUDIO_CONNECTION_FAILED",
            retryable=True,
        )
        self.port = port


class OpenRouterError(ProviderError):
    """Error from OpenRouter API."""

    def __init__(self, status_code: int, message: str = ""):
        msg = message or f"OpenRouter API error: HTTP {status_code}"
        super().__init__(
            msg,
            provider_id="openrouter",
            code=f"OPENROUTER_HTTP_{status_code}",
            retryable=status_code >= 500,
            status_code=status_code,
        )


class AuthenticationError(PakalonError):
    """Authentication failed."""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, code="AUTH_FAILED")


class RateLimitError(PakalonError):
    """Rate limit exceeded."""

    def __init__(self, message: str = "Rate limit exceeded", retry_after: int | None = None):
        super().__init__(message, code="RATE_LIMITED")
        self.retry_after = retry_after


class ValidationError(PakalonError):
    """Validation error for configuration or input."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message, code="VALIDATION_ERROR")
        self.field = field


class ConfigurationError(PakalonError):
    """Invalid configuration."""

    def __init__(self, message: str, setting: str | None = None):
        super().__init__(message, code="CONFIG_ERROR")
        self.setting = setting


class ServiceUnavailableError(PakalonError):
    """Service temporarily unavailable."""

    def __init__(self, message: str = "Service unavailable", retry_after: int | None = None):
        super().__init__(message, code="SERVICE_UNAVAILABLE")
        self.retry_after = retry_after


class NotFoundError(PakalonError):
    """Resource not found."""

    def __init__(self, resource: str, resource_id: str):
        super().__init__(f"{resource} '{resource_id}' not found", code="NOT_FOUND")
        self.resource = resource
        self.resource_id = resource_id
