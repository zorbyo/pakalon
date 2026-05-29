"""Audit trail and rate limiting services for automations."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_skill import AutomationAuditLog

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ── Audit Trail ─────────────────────────────────────────────────


async def log_action(
    *,
    user_id: str,
    action: str,
    resource_type: str,
    automation_id: str | None = None,
    execution_id: str | None = None,
    resource_id: str | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    session: AsyncSession,
) -> AutomationAuditLog:
    """Log an audit trail entry."""
    entry = AutomationAuditLog(
        user_id=user_id,
        automation_id=automation_id,
        execution_id=execution_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details or {},
        ip_address=ip_address,
        user_agent=user_agent,
    )
    session.add(entry)
    await session.flush()
    return entry


async def get_audit_logs(
    user_id: str,
    session: AsyncSession,
    *,
    automation_id: str | None = None,
    action: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AutomationAuditLog]:
    """Get audit logs for a user."""
    query = select(AutomationAuditLog).where(AutomationAuditLog.user_id == user_id)
    if automation_id:
        query = query.where(AutomationAuditLog.automation_id == automation_id)
    if action:
        query = query.where(AutomationAuditLog.action == action)
    query = query.order_by(AutomationAuditLog.created_at.desc()).offset(offset).limit(limit)
    rows = await session.execute(query)
    return list(rows.scalars())


# ── Rate Limiting ──────────────────────────────────────────────


class RateLimiter:
    """In-memory rate limiter for automation executions.

    Uses a sliding window approach. For production, this should
    use Redis for distributed rate limiting.
    """

    def __init__(self) -> None:
        # {user_id: {window_start: count}}
        self._user_windows: dict[str, dict[int, int]] = {}
        # {automation_id: {window_start: count}}
        self._automation_windows: dict[str, dict[int, int]] = {}
        self._window_size = 60  # 1 minute windows

    def _current_window(self) -> int:
        return int(time.time()) // self._window_size

    def check_user_limit(self, user_id: str, max_per_minute: int = 60) -> tuple[bool, int]:
        """Check if user is within rate limit. Returns (allowed, remaining)."""
        window = self._current_window()
        user_data = self._user_windows.setdefault(user_id, {})

        # Clean old windows
        old_windows = [w for w in user_data if w < window - 1]
        for w in old_windows:
            del user_data[w]

        current_count = user_data.get(window, 0)
        if current_count >= max_per_minute:
            return False, 0

        user_data[window] = current_count + 1
        return True, max_per_minute - current_count - 1

    def check_automation_limit(
        self, automation_id: str, max_per_minute: int = 30
    ) -> tuple[bool, int]:
        """Check if automation is within rate limit. Returns (allowed, remaining)."""
        window = self._current_window()
        auto_data = self._automation_windows.setdefault(automation_id, {})

        old_windows = [w for w in auto_data if w < window - 1]
        for w in old_windows:
            del auto_data[w]

        current_count = auto_data.get(window, 0)
        if current_count >= max_per_minute:
            return False, 0

        auto_data[window] = current_count + 1
        return True, max_per_minute - current_count - 1

    def get_usage(self, user_id: str) -> dict[str, Any]:
        """Get current usage stats for a user."""
        window = self._current_window()
        user_data = self._user_windows.get(user_id, {})
        return {
            "current_minute_count": user_data.get(window, 0),
            "window_start": window * self._window_size,
            "window_size": self._window_size,
        }


# Singleton rate limiter
rate_limiter = RateLimiter()
