"""Connection pooling for Pakalon backend.

Provides reusable HTTP connections to providers for better performance.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class ConnectionPool:
    """Manages reusable HTTP connections to providers."""

    def __init__(self, max_connections: int = 10, timeout: float = 30.0):
        self._clients: dict[str, httpx.AsyncClient] = {}
        self._last_used: dict[str, float] = {}
        self._max_connections: int = max_connections
        self._timeout: float = timeout

    async def get_client(self, provider_id: str, base_url: str) -> httpx.AsyncClient:
        """Get or create an HTTP client for a provider."""
        if provider_id in self._clients:
            client = self._clients[provider_id]
            if not client.is_closed:
                self._last_used[provider_id] = time.time()
                return client
            else:
                del self._clients[provider_id]

        if len(self._clients) >= self._max_connections:
            self._evict_oldest()

        client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(self._timeout),
            limits=httpx.Limits(
                max_connections=self._max_connections,
                max_keepalive_connections=5,
            ),
        )
        self._clients[provider_id] = client
        self._last_used[provider_id] = time.time()
        logger.debug(f"Created connection pool for {provider_id}")
        return client

    def _evict_oldest(self) -> None:
        """Evict the least recently used client."""
        if not self._last_used:
            return

        oldest_id: str = min(self._last_used, key=lambda k: self._last_used.get(k, 0.0))
        client = self._clients.pop(oldest_id, None)
        self._last_used.pop(oldest_id, None)

        if client and not client.is_closed:
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(client.aclose())
            except RuntimeError:
                pass

        logger.debug(f"Evicted connection pool for {oldest_id}")

    async def close_all(self) -> None:
        """Close all connections."""
        for _provider_id, client in self._clients.items():
            if not client.is_closed:
                await client.aclose()
        self._clients.clear()
        self._last_used.clear()
        logger.debug("Closed all connection pools")

    def get_stats(self) -> dict[str, Any]:
        """Get connection pool statistics."""
        return {
            "active_connections": len(self._clients),
            "max_connections": self._max_connections,
            "providers": list(self._clients.keys()),
        }


# Global instance
connection_pool = ConnectionPool()
