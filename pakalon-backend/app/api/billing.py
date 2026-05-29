"""Billing API — extended billing endpoints for OAuth-linked billing."""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.billing import SubscriptionStatusResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing-api"])


@router.get(
    "/usage-summary",
    summary="Get billing usage summary for the current period",
)
async def get_usage_summary(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Return a summary of the user's billing usage for the current period."""
    from app.services.billing_service import get_usage_summary  # noqa: PLC0415

    try:
        summary = await get_usage_summary(current_user.id, session)
        return summary
    except Exception as exc:
        logger.exception("Usage summary error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not retrieve usage summary",
        ) from exc


@router.get(
    "/invoice-history",
    summary="Get invoice history for the user",
)
async def get_invoice_history(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Return the user's invoice history."""
    from app.services.billing_service import get_invoice_history  # noqa: PLC0415

    try:
        invoices = await get_invoice_history(current_user.id, session)
        return {"invoices": invoices}
    except Exception as exc:
        logger.exception("Invoice history error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not retrieve invoice history",
        ) from exc


@router.post(
    "/update-payment-method",
    summary="Update the user's payment method via Polar portal",
)
async def update_payment_method(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Generate a Polar customer portal URL for updating payment method."""
    from app.services.billing import create_portal_url  # noqa: PLC0415

    try:
        url = await create_portal_url(current_user, session)
        return {"portal_url": url}
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Payment method update error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not generate payment portal URL",
        ) from exc


@router.get(
    "/plan-details",
    summary="Get available plan details and pricing",
)
async def get_plan_details():
    """Return details about available plans and their pricing."""
    settings = get_settings()
    return {
        "plans": [
            {
                "id": "free",
                "name": "Free",
                "price_usd": 0,
                "features": [
                    "Basic model access",
                    "Standard rate limits",
                ],
            },
            {
                "id": "pro",
                "name": "Pro",
                "price_usd": 22,
                "billing_period": "monthly",
                "features": [
                    "Full model access",
                    "Higher rate limits",
                    "Priority support",
                    "Usage-based billing",
                ],
                "polar_product_price_id": settings.polar_product_price_id,
            },
        ],
    }
