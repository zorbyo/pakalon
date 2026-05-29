"""Billing notification scheduler — coordinates billing reminders and trial expiration emails.

Provides service-layer functions for:
- Scheduling billing reminder emails (7 days before due date)
- Sending free trial expiration notifications
- Creating in-app notifications alongside emails
- Deduplication to avoid duplicate notifications
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.notification import Notification
from app.models.email_queue import EmailQueue
from app.models.subscription import Subscription
from app.models.user import User
from app.services.email_service import send_templated_email

logger = logging.getLogger(__name__)


async def schedule_billing_reminder(
    user_id: str,
    email: str,
    display_name: str,
    days_remaining: int,
    plan: str,
    session: AsyncSession,
    amount_usd: float | None = None,
    period_end: datetime | None = None,
) -> str | None:
    """
    Schedule a billing reminder email for a user.

    Creates both an email queue record and an in-app notification.
    Deduplicates: returns None if a reminder for this day already exists.

    Returns the email_queue ID if queued, None if duplicate.
    """
    if days_remaining > 7:
        return None

    email_type = f"billing_reminder_{days_remaining}d"

    existing = await session.execute(
        select(EmailQueue).where(
            EmailQueue.user_id == user_id,
            EmailQueue.email_type == email_type,
            EmailQueue.status.in_(["pending", "sent"]),
        )
    )
    if existing.scalar_one_or_none() is not None:
        return None

    settings = get_settings()
    billing_url = f"{settings.frontend_url}/dashboard/billing"
    context = {
        "display_name": display_name,
        "days_remaining": str(days_remaining),
        "billing_url": billing_url,
    }
    if amount_usd:
        context["amount_usd"] = f"{amount_usd:.2f}"

    email_id = await send_templated_email(
        user_id=user_id,
        to_email=email,
        template_name="billing_reminder_7d",
        context=context,
        session=session,
    )

    now = datetime.now(tz=timezone.utc)
    notification = Notification(
        id=str(uuid.uuid4()),
        user_id=user_id,
        notification_type="billing_reminder",
        title=f"Payment reminder: Billing cycle ends in {days_remaining} day{'s' if days_remaining != 1 else ''}",
        body=(
            f"Your Pakalon billing cycle will end in {days_remaining} day{'s' if days_remaining != 1 else ''}. "
            "No action is needed to continue your subscription."
        ),
        action_url="/dashboard/billing",
        action_label="Manage Billing",
        expires_at=now + timedelta(days=days_remaining + 1),
    )
    session.add(notification)

    logger.info(
        "Scheduled billing reminder user_id=%s days_remaining=%d email_id=%s",
        user_id,
        days_remaining,
        email_id,
    )
    return email_id


async def schedule_trial_expiration_notification(
    user_id: str,
    email: str,
    display_name: str,
    days_remaining: int,
    session: AsyncSession,
) -> str | None:
    """
    Schedule a trial expiration notification (email + in-app).

    Supports milestones: 14, 7, 3, 1 days remaining.
    Deduplicates per milestone.

    Returns the email_queue ID if queued, None if duplicate.
    """
    valid_thresholds = [14, 7, 3, 1]
    if days_remaining not in valid_thresholds:
        return None

    email_type = f"trial_expiration_{days_remaining}d"

    existing = await session.execute(
        select(EmailQueue).where(
            EmailQueue.user_id == user_id,
            EmailQueue.email_type == email_type,
            EmailQueue.status.in_(["pending", "sent"]),
        )
    )
    if existing.scalar_one_or_none() is not None:
        return None

    settings = get_settings()
    upgrade_url = f"{settings.frontend_url}/pricing"

    if days_remaining > 0:
        template_name = "trial_expiring_soon"
        title = f"Your free trial ends in {days_remaining} day{'s' if days_remaining != 1 else ''}"
        body = (
            f"You have {days_remaining} day{'s' if days_remaining != 1 else ''} left on your "
            "Pakalon free trial. Upgrade to Pro to keep full access."
        )
    else:
        template_name = "trial_expired"
        title = "Your free trial has expired"
        body = "Your Pakalon free trial has expired. Your account has been moved to the free plan."

    context = {
        "display_name": display_name,
        "days_remaining": str(days_remaining),
        "upgrade_url": upgrade_url,
    }

    email_id = await send_templated_email(
        user_id=user_id,
        to_email=email,
        template_name=template_name,
        context=context,
        session=session,
    )

    now = datetime.now(tz=timezone.utc)
    notification = Notification(
        id=str(uuid.uuid4()),
        user_id=user_id,
        notification_type="trial_expiration" if days_remaining == 0 else "trial_expiring_soon",
        title=title,
        body=body,
        action_url="/upgrade",
        action_label="Upgrade to Pro",
        expires_at=now + timedelta(days=7),
    )
    session.add(notification)

    logger.info(
        "Scheduled trial expiration notification user_id=%s days_remaining=%d email_id=%s",
        user_id,
        days_remaining,
        email_id,
    )
    return email_id


async def schedule_subscription_renewal_reminder(
    user_id: str,
    email: str,
    display_name: str,
    days_remaining: int,
    session: AsyncSession,
) -> str | None:
    """
    Schedule a subscription renewal reminder for Pro users.

    Only sends within the 7-day window before renewal.
    Deduplicates per day count.

    Returns the email_queue ID if queued, None if duplicate.
    """
    if days_remaining > 7 or days_remaining < 1:
        return None

    email_type = f"subscription_renewal_{days_remaining}d"

    existing = await session.execute(
        select(EmailQueue).where(
            EmailQueue.user_id == user_id,
            EmailQueue.email_type == email_type,
            EmailQueue.status.in_(["pending", "sent"]),
        )
    )
    if existing.scalar_one_or_none() is not None:
        return None

    settings = get_settings()
    billing_url = f"{settings.frontend_url}/dashboard/billing"

    context = {
        "display_name": display_name,
        "days_remaining": str(days_remaining),
        "billing_url": billing_url,
    }

    email_id = await send_templated_email(
        user_id=user_id,
        to_email=email,
        template_name="subscription_renewal",
        context=context,
        session=session,
    )

    now = datetime.now(tz=timezone.utc)
    notification = Notification(
        id=str(uuid.uuid4()),
        user_id=user_id,
        notification_type="billing_reminder",
        title=f"Your Pro subscription renews in {days_remaining} day{'s' if days_remaining != 1 else ''}",
        body=(
            f"Your Pakalon Pro subscription will renew in {days_remaining} day{'s' if days_remaining != 1 else ''}. "
            "Ensure your payment method is up to date."
        ),
        action_url="/billing",
        action_label="Manage Billing",
        expires_at=now + timedelta(days=days_remaining + 1),
    )
    session.add(notification)

    logger.info(
        "Scheduled subscription renewal reminder user_id=%s days_remaining=%d email_id=%s",
        user_id,
        days_remaining,
        email_id,
    )
    return email_id


async def batch_check_and_schedule_notifications(
    session: AsyncSession,
) -> dict[str, int]:
    """
    Nightly batch job: check all users and schedule due notifications.

    Returns a summary of actions taken.
    """
    now = datetime.now(tz=timezone.utc)
    stats = {
        "trial_reminders_queued": 0,
        "billing_reminders_queued": 0,
        "subscription_reminders_queued": 0,
        "errors": 0,
    }

    await _check_trial_expirations(session, now, stats)
    await _check_billing_cycles(session, now, stats)
    await _check_subscription_renewals(session, now, stats)

    logger.info(
        "Batch notification check complete: %s",
        stats,
    )
    return stats


async def _check_trial_expirations(
    session: AsyncSession,
    now: datetime,
    stats: dict[str, int],
) -> None:
    """Check for users whose trials are expiring soon."""
    from app.services.trial_abuse import TRIAL_DAYS  # noqa: PLC0415

    result = await session.execute(
        select(User).where(
            User.plan == "free",
            User.account_deleted == False,  # noqa: E712
            User.trial_days_used >= TRIAL_DAYS - 14,
            User.trial_days_used < TRIAL_DAYS,
            User.email.isnot(None),
        )
    )
    users = result.scalars().all()

    for user in users:
        try:
            days_remaining = TRIAL_DAYS - user.trial_days_used
            display_name = user.display_name or user.github_login or "User"
            email_id = await schedule_trial_expiration_notification(
                user_id=user.id,
                email=user.email,
                display_name=display_name,
                days_remaining=days_remaining,
                session=session,
            )
            if email_id:
                stats["trial_reminders_queued"] += 1
        except Exception as exc:
            logger.error("Failed to schedule trial notification for user %s: %s", user.id, exc)
            stats["errors"] += 1


async def _check_billing_cycles(
    session: AsyncSession,
    now: datetime,
    stats: dict[str, int],
) -> None:
    """Check for Pro users whose billing cycle ends within 7 days."""
    window_end = now + timedelta(days=7)

    result = await session.execute(
        select(Subscription, User)
        .join(User, User.id == Subscription.user_id)
        .where(
            Subscription.status == "active",
            Subscription.period_end >= now,
            Subscription.period_end <= window_end,
            User.email.isnot(None),
        )
    )
    rows = result.all()

    for sub, user in rows:
        try:
            days_remaining = max(1, (sub.period_end - now).days)
            display_name = user.display_name or user.github_login or "User"
            email_id = await schedule_billing_reminder(
                user_id=user.id,
                email=user.email,
                display_name=display_name,
                days_remaining=days_remaining,
                plan="pro",
                session=session,
                amount_usd=sub.amount_usd,
                period_end=sub.period_end,
            )
            if email_id:
                stats["billing_reminders_queued"] += 1
        except Exception as exc:
            logger.error("Failed to schedule billing reminder for user %s: %s", user.id, exc)
            stats["errors"] += 1


async def _check_subscription_renewals(
    session: AsyncSession,
    now: datetime,
    stats: dict[str, int],
) -> None:
    """Check for subscriptions renewing within 7 days."""
    window_end = now + timedelta(days=7)

    result = await session.execute(
        select(Subscription, User)
        .join(User, User.id == Subscription.user_id)
        .where(
            Subscription.status.in_(["active", "past_due"]),
            Subscription.period_end >= now,
            Subscription.period_end <= window_end,
            User.email.isnot(None),
        )
    )
    rows = result.all()

    for sub, user in rows:
        try:
            days_remaining = max(1, (sub.period_end - now).days)
            display_name = user.display_name or user.github_login or "User"
            email_id = await schedule_subscription_renewal_reminder(
                user_id=user.id,
                email=user.email,
                display_name=display_name,
                days_remaining=days_remaining,
                session=session,
            )
            if email_id:
                stats["subscription_reminders_queued"] += 1
        except Exception as exc:
            logger.error("Failed to schedule subscription reminder for user %s: %s", user.id, exc)
            stats["errors"] += 1
