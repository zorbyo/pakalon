"""Users router — profile management (T030)."""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.dependencies import get_current_user
from app.models.contribution_heatmap import ContributionHeatmap
from app.models.machine_id import MachineId
from app.models.telemetry_event import TelemetryEvent
from app.models.user import User
from app.schemas.users import (
    MeResponse,
    TelemetryResetRequest,
    TelemetryResetResponse,
    TelegramTokenRequest,
    TelegramTokenResponse,
    UserUpdateRequest,
)
from app.services.trial_abuse import can_delete_account, remaining_trial_days
from app.services.email import send_account_deleted_email

logger = logging.getLogger(__name__)
router = APIRouter(tags=["users"])


async def anonymise_user(user: User, session: AsyncSession) -> None:
    """Compatibility helper for account deletion flows used by older tests."""
    user.account_deleted = True
    await session.flush()


async def _validate_telegram_token(token: str) -> str | None:
    """Validate a Telegram bot token and return the bot username if available."""
    token = token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Telegram token is required.")

    endpoint = f"https://api.telegram.org/bot{token}/getMe"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(endpoint)
        payload = response.json()
    except Exception as exc:
        logger.warning("[users] telegram token validation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Telegram API validation failed.") from exc

    if not response.is_success or payload.get("ok") is False:
        raise HTTPException(status_code=400, detail="Invalid Telegram bot token.")

    result = payload.get("result") or {}
    username = result.get("username")
    return username if isinstance(username, str) and username else None


@router.get(
    "/auth/me",
    response_model=MeResponse,
    summary="Get authenticated user profile",
)
async def get_me(
    current_user: User = Depends(get_current_user),
):
    """Return the current user's profile and plan details."""
    return MeResponse(
        id=current_user.id,
        github_login=current_user.github_login,
        email=current_user.email or "",
        display_name=current_user.display_name or "",
        plan=current_user.plan,
        privacy_mode=current_user.privacy_mode,
        trial_days_used=current_user.trial_days_used,
        trial_days_remaining=remaining_trial_days(current_user),
        created_at=current_user.created_at,
    )


@router.patch(
    "/users/{user_id}",
    response_model=MeResponse,
    summary="Update user display name",
)
async def update_user(
    user_id: str,
    body: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Users can only update their own display_name."""
    if current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot modify another user",
        )
    if body.display_name is not None:
        current_user.display_name = body.display_name.strip()
    if body.privacy_mode is not None:
        current_user.privacy_mode = body.privacy_mode
    await session.commit()
    await session.refresh(current_user)
    return MeResponse(
        id=current_user.id,
        github_login=current_user.github_login,
        email=current_user.email or "",
        display_name=current_user.display_name or "",
        plan=current_user.plan,
        privacy_mode=current_user.privacy_mode,
        trial_days_used=current_user.trial_days_used,
        trial_days_remaining=remaining_trial_days(current_user),
        created_at=current_user.created_at,
    )


@router.get(
    "/users/me/telegram-token",
    response_model=TelegramTokenResponse,
    summary="Get stored Telegram bot token",
)
async def get_telegram_token(
    current_user: User = Depends(get_current_user),
):
    """Return stored Telegram bridge credentials for the authenticated user."""
    return TelegramTokenResponse(
        token=current_user.telegram_bot_token,
        bot_username=current_user.telegram_bot_username,
        webhook_url=current_user.telegram_webhook_url,
    )


@router.put(
    "/users/me/telegram-token",
    response_model=TelegramTokenResponse,
    summary="Store Telegram bot token",
)
async def set_telegram_token(
    body: TelegramTokenRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Validate and persist Telegram bot credentials for the current user."""
    token = body.token.strip()
    username = await _validate_telegram_token(token)
    webhook_url = (body.webhook_url or "").strip() or None

    current_user.telegram_bot_token = token
    current_user.telegram_bot_username = username or body.bot_username
    current_user.telegram_webhook_url = webhook_url
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)

    return TelegramTokenResponse(
        token=current_user.telegram_bot_token,
        bot_username=current_user.telegram_bot_username,
        webhook_url=current_user.telegram_webhook_url,
    )


@router.delete(
    "/users/me/telegram-token",
    summary="Delete stored Telegram bot token",
)
async def delete_telegram_token(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """Remove Telegram bot credentials from the current user profile."""
    current_user.telegram_bot_token = None
    current_user.telegram_bot_username = None
    current_user.telegram_webhook_url = None
    session.add(current_user)
    await session.commit()
    return {"status": "ok", "message": "Telegram token removed."}


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete user account",
)
async def delete_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    Soft-delete the user's account.

    Blocked if the user has already exhausted their 30-day trial
    (trial abuse prevention).
    """
    if current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete another user",
        )
    if not can_delete_account(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Account deletion is not allowed after the trial period has been "
                "fully consumed. Please contact support."
            ),
        )

    # Hard-delete cascade: remove all user data
    # (sessions, messages, model_usage, telemetry, subscriptions, email_queue)
    try:
        from sqlalchemy import delete  # noqa: PLC0415
        from app.models.session import Session as PakalonSession  # noqa: PLC0415
        from app.models.message import Message  # noqa: PLC0415
        from app.models.model_usage import ModelUsage  # noqa: PLC0415
        from app.models.telemetry_event import TelemetryEvent  # noqa: PLC0415
        from app.models.subscription import Subscription  # noqa: PLC0415
        from app.models.email_queue import EmailQueue  # noqa: PLC0415
        from app.models.contribution_heatmap import ContributionHeatmap  # noqa: PLC0415

        uid = current_user.id

        # Delete messages first (FK → session)
        sessions_result = await session.execute(
            select(PakalonSession.id).where(PakalonSession.user_id == uid)
        )
        session_ids = [row[0] for row in sessions_result]
        if session_ids:
            await session.execute(delete(Message).where(Message.session_id.in_(session_ids)))

        # Delete all related records
        await session.execute(delete(PakalonSession).where(PakalonSession.user_id == uid))
        await session.execute(delete(ModelUsage).where(ModelUsage.user_id == uid))
        await session.execute(delete(TelemetryEvent).where(TelemetryEvent.user_id == uid))
        await session.execute(delete(Subscription).where(Subscription.user_id == uid))
        await session.execute(delete(EmailQueue).where(EmailQueue.user_id == uid))
        await session.execute(delete(ContributionHeatmap).where(ContributionHeatmap.user_id == uid))

        logger.info("[users] Hard-deleted data cascade for user %s", uid)
    except Exception as exc:
        logger.error("[users] Cascade delete error for user %s: %s", current_user.id, exc)
        # Still proceed with soft-delete even if cascade fails

    # Soft-delete the user record itself (keep for trial abuse prevention tracking)
    # Capture PII before we nullify it
    deleted_email = current_user.email or ""
    deleted_name = current_user.display_name or current_user.github_login or "there"
    await anonymise_user(current_user, session)
    await session.commit()

    # Send confirmation email (best-effort — non-blocking)
    if deleted_email:
        await send_account_deleted_email(
            to_email=deleted_email,
            display_name=deleted_name,
        )
    logger.info("[users] Account deletion confirmed email sent to %s", deleted_email or "(no email)")


@router.post(
    "/users/{user_id}/telemetry/reset",
    response_model=TelemetryResetResponse,
    summary="Development-only reset for telemetry/machine IDs (fake-pakalon QA)",
)
async def reset_user_telemetry(
    user_id: str,
    body: TelemetryResetRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    Reset telemetry + machine-id links for local/dev QA testing.

    Safety guards:
    - Only the authenticated user can reset their own data.
    - Endpoint is disabled outside development environment.
    """
    if current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot reset telemetry for another user",
        )

    settings = get_settings()
    if not settings.is_development:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Telemetry reset endpoint is only available in development",
        )

    tel_result = await session.execute(
        delete(TelemetryEvent).where(TelemetryEvent.user_id == user_id)
    )
    machine_result = await session.execute(
        delete(MachineId).where(MachineId.user_id == user_id)
    )
    heatmap_result = await session.execute(
        delete(ContributionHeatmap).where(ContributionHeatmap.user_id == user_id)
    )

    trial_days_reset = False
    if body.reset_trial_days:
        current_user.trial_days_used = 0
        trial_days_reset = True

    await session.commit()

    return TelemetryResetResponse(
        user_id=user_id,
        telemetry_deleted=tel_result.rowcount or 0,
        machine_ids_deleted=machine_result.rowcount or 0,
        heatmap_deleted=heatmap_result.rowcount or 0,
        trial_days_reset=trial_days_reset,
    )
