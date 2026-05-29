"""Billing service — extended billing operations and usage tracking."""
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.user import User

logger = logging.getLogger(__name__)


async def get_usage_summary(
    user_id: str,
    session: AsyncSession,
) -> dict[str, Any]:
    """Get a summary of the user's usage for the current billing period."""
    from app.models.model_usage import ModelUsage  # noqa: PLC0415
    from app.models.subscription import Subscription  # noqa: PLC0415

    sub_result = await session.execute(
        select(Subscription)
        .where(Subscription.user_id == user_id)
        .order_by(Subscription.created_at.desc())
        .limit(1)
    )
    sub = sub_result.scalar_one_or_none()

    now = datetime.now(tz=timezone.utc)
    period_start = sub.period_start if sub else now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    period_end = sub.period_end if sub else now

    usage_result = await session.execute(
        select(
            func.count(ModelUsage.id).label("total_requests"),
            func.sum(ModelUsage.tokens_used).label("total_tokens"),
            func.sum(ModelUsage.cost_usd).label("total_cost"),
        ).where(
            ModelUsage.user_id == user_id,
            ModelUsage.created_at >= period_start,
            ModelUsage.created_at <= period_end,
        )
    )
    row = usage_result.one()

    model_breakdown_result = await session.execute(
        select(
            ModelUsage.model_id,
            func.count(ModelUsage.id).label("requests"),
            func.sum(ModelUsage.tokens_used).label("tokens"),
            func.sum(ModelUsage.cost_usd).label("cost"),
        )
        .where(
            ModelUsage.user_id == user_id,
            ModelUsage.created_at >= period_start,
            ModelUsage.created_at <= period_end,
        )
        .group_by(ModelUsage.model_id)
        .order_by(func.sum(ModelUsage.cost_usd).desc())
    )
    model_breakdown = [
        {
            "model_id": row.model_id,
            "requests": row.requests,
            "tokens": row.tokens or 0,
            "cost_usd": round(row.cost or 0, 6),
        }
        for row in model_breakdown_result.all()
    ]

    user_result = await session.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    return {
        "user_id": user_id,
        "plan": user.plan if user else "free",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "total_requests": row.total_requests or 0,
        "total_tokens": row.total_tokens or 0,
        "total_cost_usd": round(row.total_cost or 0, 6),
        "model_breakdown": model_breakdown,
    }


async def get_invoice_history(
    user_id: str,
    session: AsyncSession,
) -> list[dict[str, Any]]:
    """Get the user's invoice history from Polar."""
    from app.models.subscription import Subscription  # noqa: PLC0415

    sub_result = await session.execute(
        select(Subscription)
        .where(Subscription.user_id == user_id)
        .order_by(Subscription.created_at.desc())
    )
    subscriptions = sub_result.scalars().all()

    invoices = []
    for sub in subscriptions:
        if sub.polar_sub_id:
            invoices.append({
                "subscription_id": sub.polar_sub_id,
                "status": sub.status,
                "period_start": sub.period_start.isoformat() if sub.period_start else None,
                "period_end": sub.period_end.isoformat() if sub.period_end else None,
                "created_at": sub.created_at.isoformat() if sub.created_at else None,
            })

    return invoices


async def calculate_usage_charges(
    user_id: str,
    period_start: datetime,
    period_end: datetime,
    session: AsyncSession,
) -> dict[str, Any]:
    """Calculate usage-based charges for a billing period."""
    from app.models.model_usage import ModelUsage  # noqa: PLC0415
    from app.models.model_cache import ModelCache  # noqa: PLC0415

    usage_result = await session.execute(
        select(ModelUsage.model_id, ModelUsage.tokens_used)
        .where(
            ModelUsage.user_id == user_id,
            ModelUsage.created_at >= period_start,
            ModelUsage.created_at <= period_end,
        )
    )

    usage_by_model: dict[str, int] = {}
    for model_id, tokens in usage_result.all():
        usage_by_model[model_id] = usage_by_model.get(model_id, 0) + (tokens or 0)

    if not usage_by_model:
        return {
            "total_tokens": 0,
            "total_cost_usd": 0.0,
            "breakdown": [],
        }

    model_rows = await session.execute(
        select(ModelCache.model_id, ModelCache.raw_json)
        .where(ModelCache.model_id.in_(list(usage_by_model.keys())))
    )
    pricing_by_model = {
        row.model_id: (row.raw_json or {}).get("pricing", {})
        for row in model_rows
    }

    breakdown = []
    total_cost = 0.0
    total_tokens = 0

    for model_id, tokens in usage_by_model.items():
        pricing = pricing_by_model.get(model_id, {})
        prompt_cost = float(pricing.get("prompt", 0))
        completion_cost = float(pricing.get("completion", 0))
        effective_unit_cost = max(0.0, (prompt_cost + completion_cost) / 2)
        model_cost = tokens * effective_unit_cost

        total_tokens += tokens
        total_cost += model_cost
        breakdown.append({
            "model_id": model_id,
            "tokens": tokens,
            "cost_usd": round(model_cost, 6),
        })

    breakdown.sort(key=lambda x: x["cost_usd"], reverse=True)

    return {
        "total_tokens": total_tokens,
        "total_cost_usd": round(total_cost, 6),
        "breakdown": breakdown,
    }
