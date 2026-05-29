"""OAuth API — OAuth connector management and token operations."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/oauth", tags=["oauth-api"])


@router.get(
    "/profile",
    summary="Get OAuth profile for authenticated user",
)
async def get_oauth_profile(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Return the OAuth profile information for the authenticated user."""
    from app.models.oauth_connection import OAuthConnection  # noqa: PLC0415

    result = await session.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == current_user.id,
            OAuthConnection.provider == "anthropic",
        )
    )
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No OAuth connection found",
        )

    return {
        "account": {
            "uuid": connection.account_uuid,
            "email": connection.account_email,
            "display_name": connection.display_name or current_user.display_name,
            "created_at": connection.connected_at.isoformat() if connection.connected_at else None,
        },
        "organization": {
            "uuid": connection.organization_uuid,
            "name": connection.organization_name,
            "organization_type": connection.organization_type,
            "rate_limit_tier": connection.rate_limit_tier,
            "billing_type": connection.billing_type,
            "has_extra_usage_enabled": connection.has_extra_usage_enabled,
            "subscription_created_at": connection.subscription_created_at.isoformat()
            if connection.subscription_created_at
            else None,
        },
    }


@router.post(
    "/connect",
    status_code=status.HTTP_201_CREATED,
    summary="Connect an OAuth provider to the user's account",
)
async def connect_oauth(
    body: dict[str, Any],
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Connect an OAuth provider (e.g., Anthropic) to the user's account."""
    from app.models.oauth_connection import OAuthConnection  # noqa: PLC0415

    provider = body.get("provider")
    account_uuid = body.get("account_uuid")
    access_token = body.get("access_token")
    refresh_token = body.get("refresh_token")
    expires_at = body.get("expires_at")

    if not provider or not account_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="provider and account_uuid are required",
        )

    existing = await session.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == current_user.id,
            OAuthConnection.provider == provider,
            OAuthConnection.account_uuid == account_uuid,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="OAuth connection already exists",
        )

    connection = OAuthConnection(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        provider=provider,
        account_uuid=account_uuid,
        account_email=body.get("account_email"),
        access_token=access_token,
        refresh_token=refresh_token,
        token_expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc)
        if expires_at
        else None,
        organization_uuid=body.get("organization_uuid"),
        organization_name=body.get("organization_name"),
        organization_type=body.get("organization_type"),
        rate_limit_tier=body.get("rate_limit_tier"),
        billing_type=body.get("billing_type"),
        has_extra_usage_enabled=body.get("has_extra_usage_enabled", False),
        connected_at=datetime.now(tz=timezone.utc),
    )
    session.add(connection)
    await session.flush()

    return {
        "id": connection.id,
        "provider": connection.provider,
        "account_uuid": connection.account_uuid,
        "connected_at": connection.connected_at.isoformat(),
    }


@router.delete(
    "/disconnect/{provider}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Disconnect an OAuth provider",
)
async def disconnect_oauth(
    provider: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Disconnect an OAuth provider from the user's account."""
    from app.models.oauth_connection import OAuthConnection  # noqa: PLC0415

    result = await session.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == current_user.id,
            OAuthConnection.provider == provider,
        )
    )
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No OAuth connection found for provider: {provider}",
        )

    await session.delete(connection)
    await session.flush()


@router.get(
    "/connections",
    summary="List all OAuth connections for the user",
)
async def list_oauth_connections(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Return all OAuth connections for the authenticated user."""
    from app.models.oauth_connection import OAuthConnection  # noqa: PLC0415

    result = await session.execute(
        select(OAuthConnection)
        .where(OAuthConnection.user_id == current_user.id)
        .order_by(OAuthConnection.connected_at.desc())
    )
    connections = result.scalars().all()

    return {
        "connections": [
            {
                "id": c.id,
                "provider": c.provider,
                "account_uuid": c.account_uuid,
                "account_email": c.account_email,
                "organization_name": c.organization_name,
                "connected_at": c.connected_at.isoformat() if c.connected_at else None,
            }
            for c in connections
        ]
    }
