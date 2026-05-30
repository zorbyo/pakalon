"""Response caching for Pakalon backend.

Provides LRU caching for provider responses to improve performance.
"""

import hashlib
import json
import logging
import time
from collections import OrderedDict
from typing import Any

logger = logging.getLogger(__name__)


class ResponseCache:
    """LRU cache for provider responses."""

    def __init__(self, max_size: int = 100, ttl_seconds: int = 300):
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._max_size: int = max_size
        self._ttl_seconds: int = ttl_seconds

    def _make_key(
        self,
        provider: str,
        model: str,
        messages: list[dict[str, Any]],
        options: dict[str, Any] | None = None,
    ) -> str:
        """Generate a cache key from request parameters."""
        content = json.dumps(
            {
                "provider": provider,
                "model": model,
                "messages": messages,
                "options": options or {},
            },
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def get(
        self,
        provider: str,
        model: str,
        messages: list[dict[str, Any]],
        options: dict[str, Any] | None = None,
    ) -> Any | None:
        """Get a cached response if available and not expired."""
        key = self._make_key(provider, model, messages, options)

        if key in self._cache:
            entry = self._cache[key]
            if time.time() - entry["timestamp"] < self._ttl_seconds:
                self._cache.move_to_end(key)
                logger.debug(f"Cache hit for {provider}/{model}")
                return entry["response"]
            else:
                del self._cache[key]
                logger.debug(f"Cache expired for {provider}/{model}")

        return None

    def set(
        self,
        provider: str,
        model: str,
        messages: list[dict[str, Any]],
        response: Any,
        options: dict[str, Any] | None = None,
    ) -> None:
        """Cache a response."""
        key = self._make_key(provider, model, messages, options)

        if key in self._cache:
            del self._cache[key]

        while len(self._cache) >= self._max_size:
            self._cache.popitem(last=False)

        self._cache[key] = {
            "response": response,
            "timestamp": time.time(),
            "provider": provider,
            "model": model,
        }
        logger.debug(f"Cached response for {provider}/{model}")

    def invalidate(self, provider: str | None = None) -> int:
        """Invalidate cache entries, optionally filtered by provider."""
        count = 0
        keys_to_remove = []

        for key, entry in self._cache.items():
            if provider is None or entry.get("provider") == provider:
                keys_to_remove.append(key)

        for key in keys_to_remove:
            del self._cache[key]
            count += 1

        if count > 0:
            logger.debug(f"Invalidated {count} cache entries" + (f" for {provider}" if provider else ""))
        return count

    def clear(self) -> None:
        """Clear entire cache."""
        count = len(self._cache)
        self._cache.clear()
        if count > 0:
            logger.debug(f"Cleared {count} cache entries")

    def get_stats(self) -> dict[str, Any]:
        """Get cache statistics."""
        return {
            "size": len(self._cache),
            "max_size": self._max_size,
            "ttl_seconds": self._ttl_seconds,
        }


# Global instance
response_cache = ResponseCache()
