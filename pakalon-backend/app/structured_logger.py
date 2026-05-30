"""Structured logging for Pakalon backend.

Provides structured log entries with correlation IDs and context.
"""

import json
import logging
import uuid
from datetime import datetime
from enum import IntEnum
from typing import Any

from app.config import get_settings


class LogLevel(IntEnum):
    """Log levels."""

    DEBUG = 0
    INFO = 1
    WARNING = 2
    ERROR = 3
    CRITICAL = 4


class StructuredLogger:
    """Structured logger with context and correlation IDs."""

    def __init__(self, name: str, min_level: LogLevel = LogLevel.INFO):
        self._logger = logging.getLogger(name)
        self._min_level = min_level
        self._context: dict[str, Any] = {}

    def set_context(self, **kwargs: Any) -> None:
        """Set context for all subsequent log entries."""
        self._context.update(kwargs)

    def clear_context(self) -> None:
        """Clear log context."""
        self._context.clear()

    def _log(self, level: LogLevel, message: str, **kwargs: Any) -> None:
        """Log a structured message."""
        if level < self._min_level:
            return

        settings = get_settings()

        entry: dict[str, Any] = {
            "timestamp": datetime.now().isoformat(),
            "level": level.name,
            "message": message,
            "context": {**self._context, **kwargs},
        }

        # Add correlation ID if available
        correlation_id = kwargs.get("correlation_id") or self._context.get("correlation_id")
        if correlation_id:
            entry["correlation_id"] = correlation_id

        # Add mode info
        entry["mode"] = settings.pakalon_mode

        # Log as JSON in production, human-readable in development
        if settings.is_production:
            self._logger.log(level, json.dumps(entry, default=str))
        else:
            extra_str = " ".join(f"{k}={v}" for k, v in entry["context"].items() if k != "correlation_id")
            self._logger.log(level, f"{message} {extra_str}" if extra_str else message)

    def debug(self, message: str, **kwargs: Any) -> None:
        """Log debug message."""
        self._log(LogLevel.DEBUG, message, **kwargs)

    def info(self, message: str, **kwargs: Any) -> None:
        """Log info message."""
        self._log(LogLevel.INFO, message, **kwargs)

    def warning(self, message: str, **kwargs: Any) -> None:
        """Log warning message."""
        self._log(LogLevel.WARNING, message, **kwargs)

    def error(self, message: str, **kwargs: Any) -> None:
        """Log error message."""
        self._log(LogLevel.ERROR, message, **kwargs)

    def critical(self, message: str, **kwargs: Any) -> None:
        """Log critical message."""
        self._log(LogLevel.CRITICAL, message, **kwargs)


def generate_correlation_id() -> str:
    """Generate a unique correlation ID."""
    return str(uuid.uuid4())[:8]


# Factory function
def get_structured_logger(name: str, min_level: LogLevel | None = None) -> StructuredLogger:
    """Get a structured logger instance."""
    settings = get_settings()
    level = min_level or (LogLevel.DEBUG if settings.is_development else LogLevel.INFO)
    return StructuredLogger(name, level)
