"""
Pakalon Billing Calculator
Implements post-paid billing with per-model pricing and 10% platform fee.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_usage import ModelUsage
from app.models.user import User

logger = logging.getLogger(__name__)

# Platform fee percentage
PLATFORM_FEE_PERCENT = Decimal("10")

# Model pricing per million tokens (from OpenRouter)
# These are defaults - actual prices come from model registry
DEFAULT_MODEL_PRICING: dict[str, dict[str, Decimal]] = {
    "claude-3.5-sonnet": {
        "input": Decimal("3.00"),
        "output": Decimal("15.00"),
    },
    "gpt-4o": {
        "input": Decimal("2.50"),
        "output": Decimal("10.00"),
    },
    "gpt-4o-mini": {
        "input": Decimal("0.15"),
        "output": Decimal("0.60"),
    },
    "claude-3-haiku": {
        "input": Decimal("0.25"),
        "output": Decimal("1.25"),
    },
}


class BillingCalculator:
    """Calculate billing for post-paid usage."""

    @staticmethod
    def calculate_model_cost(
        model_id: str,
        input_tokens: int,
        output_tokens: int,
        pricing: dict[str, Decimal] | None = None,
    ) -> Decimal:
        """
        Calculate cost for a specific model usage.

        Args:
            model_id: The model identifier
            input_tokens: Number of input tokens used
            output_tokens: Number of output tokens used
            pricing: Optional override pricing dict with 'input' and 'output' keys

        Returns:
            Cost in dollars (before platform fee)
        """
        if pricing is None:
            pricing = DEFAULT_MODEL_PRICING.get(model_id, {
                "input": Decimal("1.00"),
                "output": Decimal("3.00"),
            })

        input_cost = (Decimal(str(input_tokens)) / Decimal("1000000")) * pricing["input"]
        output_cost = (Decimal(str(output_tokens)) / Decimal("1000000")) * pricing["output"]

        return (input_cost + output_cost).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_platform_fee(subtotal: Decimal) -> Decimal:
        """Calculate 10% platform fee on subtotal."""
        return (subtotal * PLATFORM_FEE_PERCENT / Decimal("100")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

    @staticmethod
    def calculate_total_cost(
        model_costs: dict[str, Decimal],
    ) -> dict[str, Decimal]:
        """
        Calculate total cost including platform fee.

        Args:
            model_costs: Dict mapping model_id to cost

        Returns:
            Dict with 'subtotal', 'platform_fee', 'total' keys
        """
        subtotal = sum(model_costs.values())
        platform_fee = BillingCalculator.calculate_platform_fee(subtotal)
        total = subtotal + platform_fee

        return {
            "subtotal": subtotal,
            "platform_fee": platform_fee,
            "total": total,
        }

    @staticmethod
    async def calculate_monthly_bill(
        user_id: str,
        session: AsyncSession,
        year: int,
        month: int,
    ) -> dict[str, Any]:
        """
        Calculate monthly bill for a user.

        Args:
            user_id: User ID
            session: Database session
            year: Billing year
            month: Billing month (1-12)

        Returns:
            Detailed billing breakdown
        """
        # Get all usage for the month
        start_date = datetime(year, month, 1, tzinfo=timezone.utc)
        if month == 12:
            end_date = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            end_date = datetime(year, month + 1, 1, tzinfo=timezone.utc)

        result = await session.execute(
            select(
                ModelUsage.model_id,
                func.sum(ModelUsage.input_tokens).label("total_input"),
                func.sum(ModelUsage.output_tokens).label("total_output"),
                func.count().label("call_count"),
            )
            .where(
                ModelUsage.user_id == user_id,
                ModelUsage.created_at >= start_date,
                ModelUsage.created_at < end_date,
            )
            .group_by(ModelUsage.model_id)
        )

        model_breakdowns: list[dict[str, Any]] = []
        model_costs: dict[str, Decimal] = {}

        for row in result.all():
            model_id = row.model_id
            input_tokens = int(row.total_input or 0)
            output_tokens = int(row.total_output or 0)
            call_count = int(row.call_count or 0)

            cost = BillingCalculator.calculate_model_cost(model_id, input_tokens, output_tokens)
            model_costs[model_id] = cost

            model_breakdowns.append({
                "model_id": model_id,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "call_count": call_count,
                "cost": float(cost),
            })

        totals = BillingCalculator.calculate_total_cost(model_costs)

        return {
            "user_id": user_id,
            "period": f"{year}-{month:02d}",
            "models": model_breakdowns,
            "subtotal": float(totals["subtotal"]),
            "platform_fee": float(totals["platform_fee"]),
            "total": float(totals["total"]),
            "currency": "USD",
        }

    @staticmethod
    def get_model_pricing(model_id: str) -> dict[str, Decimal]:
        """Get pricing for a specific model."""
        return DEFAULT_MODEL_PRICING.get(model_id, {
            "input": Decimal("1.00"),
            "output": Decimal("3.00"),
        })

    @staticmethod
    def list_available_models(plan: str) -> list[dict[str, Any]]:
        """List models available for a plan with pricing."""
        models = []
        for model_id, pricing in DEFAULT_MODEL_PRICING.items():
            # Free plan only gets :free models
            if plan == "free" and not model_id.endswith(":free"):
                continue

            models.append({
                "id": model_id,
                "input_price_per_m": float(pricing["input"]),
                "output_price_per_m": float(pricing["output"]),
            })

        return models


# Export singleton
billing_calculator = BillingCalculator()
