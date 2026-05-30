"""Stream optimization for Pakalon backend.

Provides buffered streaming for provider responses.
"""

import asyncio
import logging
from typing import AsyncIterator, Any

logger = logging.getLogger(__name__)


class StreamOptimizer:
    """Optimizes streaming responses with buffering."""

    def __init__(self, buffer_size: int = 10, flush_interval_ms: int = 100):
        self._buffer: list[str] = []
        self._buffer_size: int = buffer_size
        self._flush_interval: float = flush_interval_ms / 1000.0
        self._on_chunk_callback: Any = None

    def set_callback(self, callback) -> None:
        """Set callback for chunk events."""
        self._on_chunk_callback = callback

    async def process_stream(
        self,
        stream: AsyncIterator[str],
        buffer_size: int | None = None,
    ) -> AsyncIterator[str]:
        """Process a stream with buffering."""
        buf_size = buffer_size or self._buffer_size
        buffer: list[str] = []

        async for chunk in stream:
            buffer.append(chunk)

            if len(buffer) >= buf_size:
                combined = "".join(buffer)
                buffer.clear()
                yield combined

        # Flush remaining
        if buffer:
            yield "".join(buffer)

    async def batch_stream(
        self,
        stream: AsyncIterator[str],
        max_batch_size: int = 50,
        timeout_seconds: float = 0.1,
    ) -> AsyncIterator[str]:
        """Batch stream chunks with timeout."""
        batch: list[str] = []
        last_flush = asyncio.get_event_loop().time()

        async for chunk in stream:
            batch.append(chunk)
            current_time = asyncio.get_event_loop().time()

            should_flush = (
                len(batch) >= max_batch_size
                or (current_time - last_flush) >= timeout_seconds
            )

            if should_flush and batch:
                yield "".join(batch)
                batch.clear()
                last_flush = current_time

        if batch:
            yield "".join(batch)


# Global instance
stream_optimizer = StreamOptimizer()
