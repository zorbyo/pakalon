"""Database-backed rate limiting helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Tuple

WINDOW_SECONDS = 60  # 1-minute rolling window
FREE_LIMIT = 60      # requests per minute — free plan
PRO_LIMIT = 300      # requests per minute — pro plan


def _limit_for_plan(plan: str) -> int:
    """Return the per-minute request limit for the given plan slug."""
    if plan in ("pro", "enterprise"):
        return PRO_LIMIT
    return FREE_LIMIT


async def check_rate_limit(
    session,
    user_id: str,
    plan: str,
    route_key: str = "ai",
    limit_override: int | None = None,
) -> Tuple[bool, int, int]:
    """Sliding-window rate limit check backed by Postgres rows."""
    limit = limit_override if limit_override is not None else _limit_for_plan(plan)
    now = datetime.now(tz=timezone.utc)
    window_start = now.timestamp() - WINDOW_SECONDS

    from app.models.rate_limit_event import RateLimitEvent  # noqa: PLC0415
    from sqlalchemy import delete, func, select  # noqa: PLC0415

    # Cleanup events older than 2 windows (120s) to keep table small
    await session.execute(
        delete(RateLimitEvent).where(
            RateLimitEvent.created_at < datetime.fromtimestamp(window_start - WINDOW_SECONDS, tz=timezone.utc)
        )
    )

    count_result = await session.execute(
        select(func.count())
        .select_from(RateLimitEvent)
        .where(
            RateLimitEvent.user_id == user_id,
            RateLimitEvent.limit_key == route_key,
            RateLimitEvent.created_at >= datetime.fromtimestamp(window_start, tz=timezone.utc),
        )
    )
    current_count = int(count_result.scalar_one() or 0)

    if current_count >= limit:
        oldest_result = await session.execute(
            select(RateLimitEvent.created_at)
            .where(
                RateLimitEvent.user_id == user_id,
                RateLimitEvent.limit_key == route_key,
                RateLimitEvent.created_at >= datetime.fromtimestamp(window_start, tz=timezone.utc),
            )
            .order_by(RateLimitEvent.created_at.asc())
            .limit(1)
        )
        oldest = oldest_result.scalar_one_or_none()
        retry_after = WINDOW_SECONDS
        if oldest is not None:
            retry_after = max(1, int(WINDOW_SECONDS - (now - oldest).total_seconds()))
        return False, 0, retry_after

    session.add(
        RateLimitEvent(user_id=user_id, route_key=route_key, limit_key=route_key, status_code=200)
    )
    return True, max(0, limit - current_count - 1), 0


def rate_limit_headers(remaining: int, limit: int, retry_after: int = 0) -> dict[str, str]:
    """Build RFC-compliant rate-limit response headers."""
    headers = {
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Remaining": str(remaining),
        "X-RateLimit-Window": str(WINDOW_SECONDS),
    }
    if retry_after:
        headers["Retry-After"] = str(retry_after)
    return headers
