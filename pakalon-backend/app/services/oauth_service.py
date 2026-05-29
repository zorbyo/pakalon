"""OAuth service — OAuth connection management and token operations."""
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def get_oauth_connection(
    user_id: str,
    provider: str,
    session: AsyncSession,
) -> dict[str, Any] | None:
    """Get an OAuth connection for a user and provider."""
    from app.models.oauth_connection import OAuthConnection  # noqa: PLC0415

    result = await session.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == provider,
        )
    )
    connection = result.scalar_one_or_none()

    if not connection:
        return None

    return {
        "id": connection.id,
        "provider": connection.provider,
        "account_uuid": connection.account_uuid,
        "account_email": connection.account_email,
        "display_name": connection.display_name,
        "organization_uuid": connection.organization_uuid,
        "organization_name": connection.organization_name,
        "organization_type": connection.organization_type,
        "rate_limit_tier": connection.rate_limit_tier,
        "billing_type": connection.billing_type,
        "has_extra_usage_enabled": connection.has_extra_usage_enabled,
        "connected_at": connection.connected_at,
        "token_expires_at": connection.token_expires_at,
    }


async def update_oauth_tokens(
    user_id: str,
    provider: str,
    access_token: str,
    refresh_token: str | None,
    expires_at: datetime | None,
    session: AsyncSession,
) -> bool:
    """Update OAuth tokens for an existing connection."""
    from app.models.oauth_connection import OAuthConnection  # noqa: PLC0415

    result = await session.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == provider,
        )
    )
    connection = result.scalar_one_or_none()

    if not connection:
        return False

    connection.access_token = access_token
    if refresh_token:
        connection.refresh_token = refresh_token
    if expires_at:
        connection.token_expires_at = expires_at

    await session.flush()
    return True


async def refresh_expired_tokens(
    user_id: str,
    provider: str,
    session: AsyncSession,
) -> dict[str, Any] | None:
    """Check and refresh OAuth tokens if they are expired."""
    from app.models.oauth_connection import OAuthConnection  # noqa: PLC0415

    result = await session.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == provider,
        )
    )
    connection = result.scalar_one_or_none()

    if not connection or not connection.refresh_token:
        return None

    now = datetime.now(tz=timezone.utc)
    if connection.token_expires_at and connection.token_expires_at > now:
        return {
            "access_token": connection.access_token,
            "expires_at": connection.token_expires_at,
        }

    token_url = _get_token_url(provider)
    if not token_url:
        return None

    try:
        import httpx

        async with httpx.AsyncClient() as client:
            response = await client.post(
                token_url,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": connection.refresh_token,
                    "client_id": _get_client_id(provider),
                },
                timeout=15,
            )

            if response.status_code != 200:
                logger.warning(
                    "Token refresh failed for user %s, provider %s: %s",
                    user_id,
                    provider,
                    response.text,
                )
                return None

            data = response.json()
            access_token = data.get("access_token")
            new_refresh_token = data.get("refresh_token", connection.refresh_token)
            expires_in = data.get("expires_in")

            if access_token:
                new_expires_at = (
                    datetime.now(tz=timezone.utc).replace(second=0, microsecond=0)
                    + __import__("datetime").timedelta(seconds=expires_in)
                    if expires_in
                    else None
                )
                await update_oauth_tokens(
                    user_id,
                    provider,
                    access_token,
                    new_refresh_token,
                    new_expires_at,
                    session,
                )

                return {
                    "access_token": access_token,
                    "expires_at": new_expires_at,
                }
    except Exception as exc:
        logger.exception("Error refreshing OAuth tokens: %s", exc)

    return None


async def get_user_oauth_profile(
    user_id: str,
    provider: str,
    session: AsyncSession,
) -> dict[str, Any] | None:
    """Get the OAuth profile for a user's connection."""
    connection = await get_oauth_connection(user_id, provider, session)
    if not connection:
        return None

    return {
        "account": {
            "uuid": connection["account_uuid"],
            "email": connection["account_email"],
            "display_name": connection["display_name"],
            "created_at": connection["connected_at"].isoformat() if connection["connected_at"] else None,
        },
        "organization": {
            "uuid": connection["organization_uuid"],
            "name": connection["organization_name"],
            "organization_type": connection["organization_type"],
            "rate_limit_tier": connection["rate_limit_tier"],
            "billing_type": connection["billing_type"],
            "has_extra_usage_enabled": connection["has_extra_usage_enabled"],
        },
    }


def _get_token_url(provider: str) -> str | None:
    """Get the token URL for an OAuth provider."""
    urls = {
        "anthropic": "https://console.anthropic.com/oauth/token",
    }
    return urls.get(provider)


def _get_client_id(provider: str) -> str:
    """Get the client ID for an OAuth provider."""
    from app.config import get_settings

    settings = get_settings()
    client_ids = {
        "anthropic": settings.github_oauth_client_id or "ant_cli_01",
    }
    return client_ids.get(provider, "")
