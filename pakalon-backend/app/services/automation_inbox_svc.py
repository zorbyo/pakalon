"""Results inbox and notification service for automation workflows.

Provides an inbox system for workflow results that need attention,
plus notification delivery via Slack and email.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.automation_inbox import AutomationInboxItem

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


async def create_inbox_item(
    *,
    user_id: str,
    automation_id: str,
    execution_id: str | None,
    title: str,
    body: str | None = None,
    severity: str = "info",
    category: str = "result",
    result_data: dict[str, Any] | None = None,
    action_url: str | None = None,
    session: AsyncSession,
) -> AutomationInboxItem:
    """Create a new inbox item for a workflow result."""
    item = AutomationInboxItem(
        user_id=user_id,
        automation_id=automation_id,
        execution_id=execution_id,
        title=title,
        body=body,
        severity=severity,
        category=category,
        result_data=result_data or {},
        action_url=action_url,
    )
    session.add(item)
    await session.flush()

    # Trigger notification delivery (fire-and-forget)
    _notify_inbox_item(item)

    return item


async def list_inbox(
    user_id: str,
    session: AsyncSession,
    *,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[AutomationInboxItem]:
    """List inbox items for a user."""
    query = select(AutomationInboxItem).where(
        AutomationInboxItem.user_id == user_id,
        AutomationInboxItem.is_archived.is_(False),
    )
    if unread_only:
        query = query.where(AutomationInboxItem.is_read.is_(False))
    query = query.order_by(AutomationInboxItem.created_at.desc()).offset(offset).limit(limit)
    rows = await session.execute(query)
    return list(rows.scalars())


async def get_inbox_counts(user_id: str, session: AsyncSession) -> dict[str, int]:
    """Get inbox counts (total, unread, starred)."""
    from sqlalchemy import func

    total_row = await session.execute(
        select(func.count()).where(
            AutomationInboxItem.user_id == user_id,
            AutomationInboxItem.is_archived.is_(False),
        )
    )
    unread_row = await session.execute(
        select(func.count()).where(
            AutomationInboxItem.user_id == user_id,
            AutomationInboxItem.is_archived.is_(False),
            AutomationInboxItem.is_read.is_(False),
        )
    )
    starred_row = await session.execute(
        select(func.count()).where(
            AutomationInboxItem.user_id == user_id,
            AutomationInboxItem.is_archived.is_(False),
            AutomationInboxItem.is_starred.is_(True),
        )
    )
    return {
        "total": total_row.scalar() or 0,
        "unread": unread_row.scalar() or 0,
        "starred": starred_row.scalar() or 0,
    }


async def mark_read(item_id: str, user_id: str, session: AsyncSession) -> bool:
    """Mark an inbox item as read."""
    row = await session.execute(
        select(AutomationInboxItem).where(
            AutomationInboxItem.id == item_id,
            AutomationInboxItem.user_id == user_id,
        )
    )
    item = row.scalar_one_or_none()
    if item:
        item.is_read = True
        item.read_at = _now()
        await session.flush()
        return True
    return False


async def mark_all_read(user_id: str, session: AsyncSession) -> int:
    """Mark all inbox items as read for a user."""
    result = await session.execute(
        update(AutomationInboxItem)
        .where(
            AutomationInboxItem.user_id == user_id,
            AutomationInboxItem.is_read.is_(False),
        )
        .values(is_read=True, read_at=_now())
    )
    await session.flush()
    return result.rowcount or 0


async def archive_item(item_id: str, user_id: str, session: AsyncSession) -> bool:
    """Archive an inbox item."""
    row = await session.execute(
        select(AutomationInboxItem).where(
            AutomationInboxItem.id == item_id,
            AutomationInboxItem.user_id == user_id,
        )
    )
    item = row.scalar_one_or_none()
    if item:
        item.is_archived = True
        await session.flush()
        return True
    return False


async def toggle_star(item_id: str, user_id: str, session: AsyncSession) -> bool:
    """Toggle star on an inbox item."""
    row = await session.execute(
        select(AutomationInboxItem).where(
            AutomationInboxItem.id == item_id,
            AutomationInboxItem.user_id == user_id,
        )
    )
    item = row.scalar_one_or_none()
    if item:
        item.is_starred = not item.is_starred
        await session.flush()
        return item.is_starred
    return False


def _notify_inbox_item(item: AutomationInboxItem) -> None:
    """Send notification for a new inbox item (fire-and-forget)."""
    try:
        import asyncio

        async def _send() -> None:
            try:
                settings = get_settings()

                # Send Slack notification if connector is configured
                if item.severity in ("warning", "error", "critical"):
                    await _send_slack_notification(item, settings)

                # Send email notification for critical items
                if item.severity == "critical":
                    await _send_email_notification(item, settings)

                # Mark as notified
                item.notification_sent = True
            except Exception:
                logger.exception("Failed to send inbox notification")

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_send())
        except RuntimeError:
            pass  # No running loop, skip notification
    except Exception:
        pass


async def _send_slack_notification(item: AutomationInboxItem, settings: Any) -> None:
    """Send a Slack notification for an inbox item."""
    import httpx

    from app.models.automation_connector import AutomationConnector
    from app.database import AsyncSessionLocal
    from app.services.automations import decrypt_secret

    async with AsyncSessionLocal() as session:
        row = await session.execute(
            select(AutomationConnector).where(
                AutomationConnector.user_id == item.user_id,
                AutomationConnector.provider == "slack",
                AutomationConnector.enabled.is_(True),
            )
        )
        connector = row.scalar_one_or_none()
        if not connector or not connector.access_token_encrypted:
            return

        token = decrypt_secret(connector.access_token_encrypted)
        if not token:
            return

        severity_emoji = {"info": "[i]", "warning": "Warning:", "error": "[X]", "critical": "[Siren]"}
        emoji = severity_emoji.get(item.severity, "[Clipboard]")

        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(
                "https://slack.com/api/chat.postMessage",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "channel": "#general",
                    "text": f"{emoji} *Automation Result*\n*{item.title}*\n{item.body or ''}",
                },
            )


async def _send_email_notification(item: AutomationInboxItem, settings: Any) -> None:
    """Send an email notification for a critical inbox item."""
    if not settings.resend_api_key:
        return

    import httpx

    try:
        from app.models.user import User
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as session:
            user = await session.get(User, item.user_id)
            if not user or not user.email:
                return

        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.email_from,
                    "to": [user.email],
                    "subject": f"[Pakalon] Automation Alert: {item.title}",
                    "html": f"""
                    <h2>Automation Alert</h2>
                    <p><strong>{item.title}</strong></p>
                    <p>{item.body or "No details available."}</p>
                    <p>Severity: {item.severity}</p>
                    <p><a href="{settings.frontend_url}/dashboard/automations/inbox">View in Inbox</a></p>
                    """,
                },
            )
    except Exception:
        logger.exception("Failed to send email notification")
