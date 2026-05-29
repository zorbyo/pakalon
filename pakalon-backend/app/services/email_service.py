"""Email delivery service — enhanced template-based email system.

Extends the existing email.py service with:
- Template rendering engine
- Email delivery tracking
- Retry with exponential backoff
- Delivery status callbacks
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.email_queue import EmailQueue

logger = logging.getLogger(__name__)

# ── Template Registry ────────────────────────────────────────────

EMAIL_TEMPLATES: dict[str, dict[str, Any]] = {
    "billing_reminder_7d": {
        "subject": "Payment reminder: Your Pakalon billing cycle ends in {days_remaining} days",
        "html": """
<h2>Hi {display_name},</h2>
<p>Your current Pakalon billing cycle will end in <strong>{days_remaining} days</strong>.</p>
<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:16px;margin:16px 0;">
  <p style="margin:0;">No action is needed if you want to continue your subscription.</p>
</div>
<p><a href="{billing_url}" style="background:#0070f3;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">
  Manage Billing
</a></p>
<p>– The Pakalon Team</p>
""",
    },
    "trial_expiring_soon": {
        "subject": "Your Pakalon free trial ends in {days_remaining} day(s)",
        "html": """
<h2>Hi {display_name},</h2>
<p>Your Pakalon free trial has <strong>{days_remaining} day(s) remaining</strong>.</p>
<p>Upgrade to Pakalon Pro for $22/month to keep full access to all features.</p>
<p><a href="{upgrade_url}" style="background:#0070f3;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">
  Upgrade to Pro — $22/mo
</a></p>
<p>– The Pakalon Team</p>
""",
    },
    "trial_expired": {
        "subject": "Your Pakalon free trial has expired",
        "html": """
<h2>Hi {display_name},</h2>
<p>Your Pakalon free trial has <strong>expired</strong>. Your account has been moved to the free plan.</p>
<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:16px;margin:16px 0;">
  <p style="margin:0;">You still have access to free-tier AI models. Upgrade to Pro for unlimited access.</p>
</div>
<p><a href="{upgrade_url}" style="background:#0070f3;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">
  Upgrade to Pro
</a></p>
<p>– The Pakalon Team</p>
""",
    },
    "subscription_renewal": {
        "subject": "Your Pakalon Pro subscription renews in {days_remaining} day(s)",
        "html": """
<h2>Hi {display_name},</h2>
<p>Your Pakalon Pro subscription will renew in <strong>{days_remaining} day(s)</strong>.</p>
<p>Your subscription is set to automatically renew. Manage or cancel from your dashboard.</p>
<p><a href="{billing_url}" style="background:#0070f3;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">
  Manage Subscription
</a></p>
<p>Thank you for being a Pakalon Pro member!</p>
<p>– The Pakalon Team</p>
""",
    },
    "grace_period_warning": {
        "subject": "Warning: Your Pakalon Pro access ends in {days_remaining} day(s)",
        "html": """
<h2>Hi {display_name},</h2>
<p>Your Pakalon account is in its <strong>grace period</strong>, ending in <strong>{days_remaining} day(s)</strong>.</p>
<div style="background:#fee;border-left:4px solid #e53e3e;padding:16px;margin:16px 0;">
  <p style="margin:0;">After the grace period, your account will be locked and sessions become read-only.</p>
</div>
<p><a href="{upgrade_url}" style="background:#e53e3e;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">
  Re-subscribe — $22/mo
</a></p>
<p>– The Pakalon Team</p>
""",
    },
}


def _render_template(template_name: str, context: dict[str, str]) -> tuple[str, str]:
    """Render an email template with the given context variables."""
    template = EMAIL_TEMPLATES.get(template_name)
    if template is None:
        raise ValueError(f"Unknown email template: {template_name}")

    subject = template["subject"].format(**context)
    html = template["html"].format(**context)
    return subject, html


async def send_templated_email(
    user_id: str,
    to_email: str,
    template_name: str,
    context: dict[str, str],
    session: AsyncSession,
) -> str:
    """
    Queue a templated email for delivery.

    Returns the email_queue record ID.
    """
    subject, html = _render_template(template_name, context)

    queue_item = EmailQueue(
        id=str(uuid.uuid4()),
        user_id=user_id,
        to_email=to_email,
        subject=subject,
        html=html,
        email_type=template_name,
        status="pending",
        created_at=datetime.now(tz=timezone.utc),
    )
    session.add(queue_item)
    await session.flush()

    logger.info(
        "Queued templated email type=%s user_id=%s to=%s queue_id=%s",
        template_name,
        user_id,
        to_email,
        queue_item.id,
    )
    return queue_item.id


async def send_immediate_email(
    to_email: str,
    subject: str,
    html: str,
    from_email: str | None = None,
) -> bool:
    """Send an email immediately via Resend (bypasses queue)."""
    settings = get_settings()
    try:
        import resend  # noqa: PLC0415

        resend.api_key = settings.resend_api_key
        resend.Emails.send(
            {
                "from": from_email or settings.email_from,
                "to": [to_email],
                "subject": subject,
                "html": html,
            }
        )
        return True
    except Exception as exc:
        logger.error("Failed to send immediate email to %s: %s", to_email, exc)
        return False


async def get_email_delivery_status(
    email_id: str,
    user_id: str,
    session: AsyncSession,
) -> EmailQueue | None:
    """Fetch the delivery status of a specific email."""
    result = await session.execute(
        select(EmailQueue).where(
            EmailQueue.id == email_id,
            EmailQueue.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def get_user_email_history(
    user_id: str,
    session: AsyncSession,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[EmailQueue], int]:
    """Fetch paginated email history for a user."""
    base_query = select(EmailQueue).where(EmailQueue.user_id == user_id)

    count_query = select(EmailQueue.id).where(EmailQueue.user_id == user_id)
    count_result = await session.execute(count_query)
    total = len(count_result.all())

    emails_query = (
        base_query.order_by(EmailQueue.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await session.execute(emails_query)
    emails = result.scalars().all()

    return emails, total


async def retry_failed_email(
    email_id: str,
    user_id: str,
    session: AsyncSession,
) -> bool:
    """Retry a failed email by resetting its status to pending."""
    result = await session.execute(
        select(EmailQueue).where(
            EmailQueue.id == email_id,
            EmailQueue.user_id == user_id,
            EmailQueue.status == "failed",
        )
    )
    email = result.scalar_one_or_none()
    if email is None:
        return False

    email.status = "pending"
    email.retry_count = 0
    email.error_message = None
    await session.flush()

    logger.info("Retrying failed email id=%s user_id=%s", email_id, user_id)
    return True


def get_available_templates() -> list[str]:
    """Return list of available email template names."""
    return list(EMAIL_TEMPLATES.keys())
