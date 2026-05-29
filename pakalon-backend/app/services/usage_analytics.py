"""Model usage tracking service (T-BACK-01)."""

from collections import defaultdict
from datetime import date
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_usage import ModelUsage
from app.services.heatmap_service import update_contribution_day

logger = logging.getLogger(__name__)


async def _safe_execute(db: AsyncSession, statement):
    try:
        return await db.execute(statement)
    except OperationalError:
        return None


def _date_key(value: datetime | date | str | None) -> str:
    """Return a stable YYYY-MM-DD string for usage bucketing across DB backends."""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")


async def record_model_usage(
    *,
    user_id: str,
    model_id: str,
    tokens_used: int,
    input_tokens: int = 0,
    output_tokens: int = 0,
    context_window_size: int,
    context_window_used: int,
    lines_written: int = 0,
    session_id: str | None = None,
    db: AsyncSession,
) -> ModelUsage:
    """Insert a new model usage record and return it."""
    record = ModelUsage(
        user_id=user_id,
        session_id=session_id,
        model_id=model_id,
        tokens_used=tokens_used,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        context_window_size=context_window_size,
        context_window_used=context_window_used,
        lines_written=lines_written,
    )
    db.add(record)
    await db.flush()

    await update_contribution_day(
        user_id=user_id,
        db=db,
        lines_added=max(0, int(lines_written or 0)),
        tokens_used=max(0, int(tokens_used or 0)),
    )

    # Supabase realtime is the primary path now; no local cache publish.

    return record


async def get_daily_token_count(user_id: str, db: AsyncSession) -> int:
    """
    Count tokens used by the user today (UTC).

    Used by the free-tier daily quota enforcement dependency.
    """
    today_start = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await _safe_execute(
        db,
        select(func.coalesce(func.sum(ModelUsage.tokens_used), 0)).where(
            ModelUsage.user_id == user_id,
            ModelUsage.created_at >= today_start,
        )
    )
    if result is None:
        return 0
    return int(result.scalar_one())


async def get_monthly_token_count(user_id: str, db: AsyncSession) -> int:
    """
    Count tokens used by the user this month (UTC).

    Used by the free-tier monthly quota enforcement dependency.
    """
    now = datetime.now(tz=timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    result = await _safe_execute(
        db,
        select(func.coalesce(func.sum(ModelUsage.tokens_used), 0)).where(
            ModelUsage.user_id == user_id,
            ModelUsage.created_at >= month_start,
        )
    )
    if result is None:
        return 0
    return int(result.scalar_one())


async def get_remaining_pct(
    user_id: str,
    model_id: str,
    db: AsyncSession,
    session_id: str | None = None,
) -> int | None:
    """
    Return the percentage of context window remaining for the given model,
    based on the most recent usage record (0–100).
    Returns None if no usage exists yet.
    """
    try:
        query = (
            select(ModelUsage)
            .where(
                ModelUsage.user_id == user_id,
                ModelUsage.model_id == model_id,
                ModelUsage.context_window_size > 0,
            )
            .order_by(ModelUsage.created_at.desc())
            .limit(1)
        )
        if session_id is not None:
            query = query.where(ModelUsage.session_id == session_id)
        result = await db.execute(query)
    except (OperationalError, ProgrammingError) as exc:
        error_text = str(getattr(exc, "orig", exc)).lower()
        missing_table_markers = (
            "no such table: model_usage",
            'relation "model_usage" does not exist',
            "undefinedtable",
        )
        if any(marker in error_text for marker in missing_table_markers):
            logger.warning("model_usage table is unavailable; returning no context-usage data")
            return None
        raise
    row = result.scalar_one_or_none()
    if row is None:
        return None
    used = row.context_window_used
    total = row.context_window_size
    if total == 0:
        return None
    return max(0, 100 - round(used / total * 100))


async def is_context_exhausted(
    user_id: str,
    model_id: str,
    db: AsyncSession,
    session_id: str | None = None,
) -> bool:
    """
    Return True if the user's context window for model_id is exhausted (0%).

    T-BACK-06 / T-BACK-09: Used by the backend to gate new AI calls.
    Returns False if no usage recorded yet (context not exhausted by default).
    """
    pct = await get_remaining_pct(user_id, model_id, db, session_id=session_id)
    if pct is None:
        return False  # No usage yet — not exhausted
    return pct == 0


async def get_context_status(
    user_id: str,
    model_id: str,
    db: AsyncSession,
    session_id: str | None = None,
) -> dict[str, Any]:
    """
    Return a structured context status dict for the given user + model.

    Returns:
        {
          "model_id": str,
          "remaining_pct": int | None,
          "exhausted": bool,
          "message": str | None,   # set when exhausted
        }
    """
    if session_id is None:
        return {
            "model_id": model_id,
            "remaining_pct": 100,
            "exhausted": False,
            "message": None,
        }

    pct = await get_remaining_pct(user_id, model_id, db, session_id=session_id)
    exhausted = pct == 0 if pct is not None else False
    return {
        "model_id": model_id,
        "remaining_pct": pct,
        "exhausted": exhausted,
        "message": (
            f"{model_id} Models context windows is used completely, "
            "switch to another model to use the application"
        )
        if exhausted
        else None,
    }


async def get_usage_analytics(
    user_id: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Aggregate usage statistics for the given user (T-BACK-02).

    Returns:
      total_tokens, tokens_by_model, daily_tokens, lines_written, sessions_count
    """
    from app.models.session import Session  # avoid circular import

    # Total tokens
    total_result = await _safe_execute(
        db,
        select(func.coalesce(func.sum(ModelUsage.tokens_used), 0)).where(
            ModelUsage.user_id == user_id
        )
    )
    total_tokens: int = total_result.scalar_one() if total_result is not None else 0

    # Tokens by model
    model_result = await _safe_execute(
        db,
        select(ModelUsage.model_id, func.sum(ModelUsage.tokens_used))
        .where(ModelUsage.user_id == user_id)
        .group_by(ModelUsage.model_id)
    )
    tokens_by_model: dict[str, int] = {row[0]: int(row[1]) for row in model_result.all()} if model_result is not None else {}

    # Lines written (total)
    lines_result = await _safe_execute(
        db,
        select(func.coalesce(func.sum(ModelUsage.lines_written), 0)).where(
            ModelUsage.user_id == user_id
        )
    )
    lines_written: int = lines_result.scalar_one() if lines_result is not None else 0

    # Daily aggregates are computed in Python for SQLite/Postgres consistency.
    usage_rows_result = await _safe_execute(
        db,
        select(ModelUsage.created_at, ModelUsage.tokens_used, ModelUsage.lines_written)
        .where(ModelUsage.user_id == user_id)
        .order_by(ModelUsage.created_at)
    )
    daily_tokens_map: dict[str, int] = defaultdict(int)
    daily_lines_map: dict[str, int] = defaultdict(int)
    if usage_rows_result is not None:
        for created_at, tokens_used, lines_written_value in usage_rows_result.all():
            day = _date_key(created_at)
            daily_tokens_map[day] += int(tokens_used or 0)
            daily_lines_map[day] += int(lines_written_value or 0)

    daily_tokens = [
        {"date": day, "tokens": daily_tokens_map[day]} for day in sorted(daily_tokens_map)
    ]
    daily_lines_written = [
        {"date": day, "lines": daily_lines_map[day]} for day in sorted(daily_lines_map)
    ]

    # Sessions count
    sessions_result = await _safe_execute(
        db,
        select(func.count(Session.id)).where(
            Session.user_id == user_id,
        )
    )
    sessions_count: int = sessions_result.scalar_one() if sessions_result is not None else 0

    return {
        "total_tokens": total_tokens,
        "tokens_by_model": tokens_by_model,
        "daily_tokens": daily_tokens,
        "daily_lines_written": daily_lines_written,
        "lines_written": lines_written,
        "sessions_count": sessions_count,
    }
