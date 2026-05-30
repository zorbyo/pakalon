"""Audit trail logging for Pakalon backend.

Tracks user actions for compliance and security purposes.
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.config import get_settings
from app.features import get_feature_flags

logger = logging.getLogger(__name__)


class AuditEvent(BaseModel):
    """An audit event."""

    id: str
    user_id: str
    action: str
    resource: str
    resource_id: str
    details: dict[str, Any]
    ip_address: str
    user_agent: str
    timestamp: datetime


class AuditTrail:
    """Audit trail for tracking user actions."""

    def __init__(self):
        self._events: list[AuditEvent] = []

    async def log_event(
        self,
        user_id: str,
        action: str,
        resource: str,
        resource_id: str,
        details: dict[str, Any] | None = None,
        ip_address: str = "",
        user_agent: str = "",
    ) -> AuditEvent:
        """Log an audit event."""
        settings = get_settings()
        flags = get_feature_flags()

        # Skip audit logging in self-hosted mode or if not enabled
        if settings.is_selfhosted or not flags.audit_logging:
            # Return a dummy event
            return AuditEvent(
                id=str(uuid.uuid4()),
                user_id=user_id,
                action=action,
                resource=resource,
                resource_id=resource_id,
                details=details or {},
                ip_address=ip_address,
                user_agent=user_agent,
                timestamp=datetime.now(),
            )

        event = AuditEvent(
            id=str(uuid.uuid4()),
            user_id=user_id,
            action=action,
            resource=resource,
            resource_id=resource_id,
            details=details or {},
            ip_address=ip_address,
            user_agent=user_agent,
            timestamp=datetime.now(),
        )

        self._events.append(event)

        # Persist to database or log service
        logger.info(
            f"Audit event: {event.action} on {event.resource} by {event.user_id}",
            extra={"audit_event": event.model_dump()},
        )

        return event

    async def query_events(
        self,
        user_id: str | None = None,
        action: str | None = None,
        resource: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        limit: int = 100,
    ) -> list[AuditEvent]:
        """Query audit events."""
        results = self._events.copy()

        if user_id:
            results = [e for e in results if e.user_id == user_id]

        if action:
            results = [e for e in results if e.action == action]

        if resource:
            results = [e for e in results if e.resource == resource]

        if start_date:
            results = [e for e in results if e.timestamp >= start_date]

        if end_date:
            results = [e for e in results if e.timestamp <= end_date]

        # Sort by timestamp (newest first)
        results.sort(key=lambda x: x.timestamp, reverse=True)

        return results[:limit]

    def get_event_count(self, user_id: str | None = None) -> int:
        """Get total event count."""
        if user_id:
            return len([e for e in self._events if e.user_id == user_id])
        return len(self._events)


# Global instance
audit_trail = AuditTrail()


# Convenience functions
async def log_user_action(
    user_id: str,
    action: str,
    resource: str,
    resource_id: str,
    details: dict[str, Any] | None = None,
    ip_address: str = "",
    user_agent: str = "",
) -> AuditEvent:
    """Log a user action."""
    return await audit_trail.log_event(
        user_id=user_id,
        action=action,
        resource=resource,
        resource_id=resource_id,
        details=details,
        ip_address=ip_address,
        user_agent=user_agent,
    )


async def log_auth_event(
    user_id: str,
    action: Literal["login", "logout", "token_refresh", "token_revoke"],
    details: dict[str, Any] | None = None,
    ip_address: str = "",
    user_agent: str = "",
) -> AuditEvent:
    """Log an authentication event."""
    return await audit_trail.log_event(
        user_id=user_id,
        action=action,
        resource="auth",
        resource_id=user_id,
        details=details,
        ip_address=ip_address,
        user_agent=user_agent,
    )


async def log_api_usage(
    user_id: str,
    provider: str,
    model: str,
    tokens: int,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    """Log API usage."""
    return await audit_trail.log_event(
        user_id=user_id,
        action="api_usage",
        resource="api",
        resource_id=f"{provider}/{model}",
        details={
            "provider": provider,
            "model": model,
            "tokens": tokens,
            **(details or {}),
        },
    )
