"""Notifications router — in-app notification management + email delivery tracking."""

import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BACKEND_ROOT
from app.database import get_session
from app.dependencies import get_current_user
from app.models.email_queue import EmailQueue
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notifications import (
    BillingReminderRequest,
    EmailDeliveryStatus,
    EmailListResponse,
    EmailResponse,
    NotificationCreateRequest,
    NotificationListResponse,
    NotificationPreferences,
    NotificationPreferencesUpdate,
    NotificationReadResponse,
    NotificationResponse,
    TrialExpirationRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notifications", tags=["notifications"])


def _prefs_path(user_id: str) -> str:
    return str(BACKEND_ROOT / ".local" / f"prefs_{user_id}.json")


def _load_prefs(user_id: str) -> NotificationPreferences:
    import os  # noqa: PLC0415

    path = _prefs_path(user_id)
    if not os.path.exists(path):
        return NotificationPreferences()
    try:
        with open(path, "r") as f:
            return NotificationPreferences(**json.load(f))
    except Exception:
        return NotificationPreferences()


def _save_prefs(user_id: str, prefs: NotificationPreferences) -> None:
    import os  # noqa: PLC0415

    path = _prefs_path(user_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(prefs.model_dump(), f)


# ── In-app notification endpoints ───────────────────────────────

@router.get(
    "",
    response_model=NotificationListResponse,
    summary="List user's notifications (unread first, paginated)",
)
async def list_notifications(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    unread_only: bool = Query(default=False, description="Return only unread notifications"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationListResponse:
    """
    Return paginated notifications for the authenticated user.

    Expired notifications (expires_at < now) are excluded automatically.
    Unread notifications are returned first, then sorted by created_at desc.
    """
    now = datetime.now(tz=timezone.utc)

    base_filter = [
        Notification.user_id == current_user.id,
        (Notification.expires_at == None) | (Notification.expires_at > now),  # noqa: E711
    ]
    if unread_only:
        base_filter.append(Notification.read == False)  # noqa: E712

    q = (
        select(Notification)
        .where(*base_filter)
        .order_by(Notification.read.asc(), Notification.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    count_q = select(func.count()).select_from(Notification).where(*base_filter)
    unread_q = (
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.read == False,  # noqa: E712
            (Notification.expires_at == None) | (Notification.expires_at > now),  # noqa: E711
        )
    )

    result = await session.execute(q)
    notifications = result.scalars().all()

    count_result = await session.execute(count_q)
    total = count_result.scalar_one()

    unread_result = await session.execute(unread_q)
    unread_count = unread_result.scalar_one()

    return NotificationListResponse(
        notifications=[NotificationResponse.model_validate(n) for n in notifications],
        total=total,
        unread_count=unread_count,
    )


@router.patch(
    "/{notification_id}/read",
    response_model=NotificationReadResponse,
    summary="Mark a single notification as read",
)
async def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationReadResponse:
    """Mark one notification as read. Idempotent — safe to call multiple times."""
    result = await session.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if notif is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    notif.read = True
    await session.commit()
    await session.refresh(notif)
    return NotificationReadResponse(id=notif.id, read=notif.read)


@router.post(
    "/read-all",
    response_model=dict[str, int],
    summary="Mark all of the user's unread notifications as read",
)
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    """Bulk-mark every unread notification for the current user as read."""
    result = await session.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.read == False,  # noqa: E712
        )
    )
    unread = result.scalars().all()
    for notif in unread:
        notif.read = True
    await session.commit()
    return {"marked_read": len(unread)}


@router.post(
    "",
    response_model=NotificationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a notification (internal use — no user auth required)",
    include_in_schema=False,
)
async def create_notification(
    body: NotificationCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> NotificationResponse:
    """
    Internal endpoint for background jobs and services to create in-app notifications.

    Not authenticated — only reachable via localhost or internal network.
    Hidden from public API docs.
    """
    notif = Notification(
        id=str(uuid.uuid4()),
        user_id=body.user_id,
        notification_type=body.notification_type,
        title=body.title,
        body=body.body,
        action_url=body.action_url,
        action_label=body.action_label,
        expires_at=body.expires_at,
        read=False,
        created_at=datetime.now(tz=timezone.utc),
    )
    session.add(notif)
    await session.commit()
    await session.refresh(notif)
    logger.info(
        "Created notification type=%s user_id=%s id=%s",
        notif.notification_type,
        notif.user_id,
        notif.id,
    )
    return NotificationResponse.model_validate(notif)


# ── Email delivery tracking endpoints ───────────────────────────

@router.get(
    "/emails",
    response_model=EmailListResponse,
    summary="List user's email delivery history",
)
async def list_user_emails(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EmailListResponse:
    """Return paginated email delivery history for the authenticated user."""
    base_filter = [EmailQueue.user_id == current_user.id]

    q = (
        select(EmailQueue)
        .where(*base_filter)
        .order_by(EmailQueue.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    count_q = select(func.count()).select_from(EmailQueue).where(*base_filter)

    result = await session.execute(q)
    emails = result.scalars().all()

    count_result = await session.execute(count_q)
    total = count_result.scalar_one()

    return EmailListResponse(
        emails=[EmailResponse.model_validate(e) for e in emails],
        total=total,
    )


@router.get(
    "/emails/{email_id}/status",
    response_model=EmailDeliveryStatus,
    summary="Get delivery status for a specific email",
)
async def get_email_status(
    email_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EmailDeliveryStatus:
    """Return the delivery status of a specific email."""
    result = await session.execute(
        select(EmailQueue).where(
            EmailQueue.id == email_id,
            EmailQueue.user_id == current_user.id,
        )
    )
    email = result.scalar_one_or_none()
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email not found",
        )

    return EmailDeliveryStatus(
        email_id=email.id,
        status=email.status,
        sent_at=email.sent_at,
        error_message=email.error_message,
        retry_count=email.retry_count,
    )


@router.post(
    "/emails/{email_id}/retry",
    response_model=dict[str, str],
    summary="Retry a failed email delivery",
)
async def retry_email(
    email_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """Reset a failed email to pending status for retry."""
    result = await session.execute(
        select(EmailQueue).where(
            EmailQueue.id == email_id,
            EmailQueue.user_id == current_user.id,
            EmailQueue.status == "failed",
        )
    )
    email = result.scalar_one_or_none()
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Failed email not found or not in failed state",
        )

    email.status = "pending"
    email.retry_count = 0
    email.error_message = None
    await session.commit()

    logger.info("Retrying email id=%s user_id=%s", email_id, current_user.id)
    return {"status": "queued", "email_id": email_id}


# ── Billing reminder endpoint ───────────────────────────────────

@router.post(
    "/billing-reminders",
    response_model=dict[str, str],
    status_code=status.HTTP_202_ACCEPTED,
    summary="Request a billing reminder email",
)
async def request_billing_reminder(
    body: BillingReminderRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """
    Schedule a billing reminder email for the user.

    Creates both an email queue record and an in-app notification.
    Deduplicates: returns existing ID if already queued for this day.
    """
    from app.services.billing_notifications import schedule_billing_reminder  # noqa: PLC0415

    email_id = await schedule_billing_reminder(
        user_id=current_user.id,
        email=body.email or current_user.email or "",
        display_name=body.display_name or current_user.display_name or "User",
        days_remaining=body.days_remaining,
        plan=body.plan,
        session=session,
        amount_usd=body.amount_usd,
        period_end=body.period_end,
    )

    if email_id is None:
        return {"status": "duplicate", "message": "Reminder already queued for this day"}

    return {"status": "queued", "email_id": email_id}


# ── Trial expiration endpoint ───────────────────────────────────

@router.post(
    "/trial-expiration",
    response_model=dict[str, str],
    status_code=status.HTTP_202_ACCEPTED,
    summary="Request a trial expiration notification",
)
async def request_trial_expiration(
    body: TrialExpirationRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """
    Schedule a trial expiration notification (email + in-app).

    Supports milestones: 14, 7, 3, 1 days remaining.
    """
    from app.services.billing_notifications import schedule_trial_expiration_notification  # noqa: PLC0415

    email_id = await schedule_trial_expiration_notification(
        user_id=current_user.id,
        email=body.email or current_user.email or "",
        display_name=body.display_name or current_user.display_name or "User",
        days_remaining=body.days_remaining,
        session=session,
    )

    if email_id is None:
        return {"status": "skipped", "message": "No notification needed for this threshold"}

    return {"status": "queued", "email_id": email_id}


# ── Notification preferences ────────────────────────────────────

@router.get(
    "/preferences",
    response_model=NotificationPreferences,
    summary="Get user notification preferences",
)
async def get_preferences(
    current_user: User = Depends(get_current_user),
) -> NotificationPreferences:
    """Return the current user's notification preferences."""
    return _load_prefs(current_user.id)


@router.patch(
    "/preferences",
    response_model=NotificationPreferences,
    summary="Update notification preferences",
)
async def update_preferences(
    body: NotificationPreferencesUpdate,
    current_user: User = Depends(get_current_user),
) -> NotificationPreferences:
    """Update the current user's notification preferences."""
    current = _load_prefs(current_user.id)

    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(current, key, value)

    _save_prefs(current_user.id, current)
    return current
