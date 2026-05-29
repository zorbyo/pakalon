"""Automation results inbox ORM model.

Stores workflow execution results that require user attention,
similar to Cursor's inbox or Codex's results inbox.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, Index
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AutomationInboxItem(Base):
    """An inbox item representing a workflow result that needs attention."""

    __tablename__ = "automation_inbox"

    id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    automation_id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False),
        ForeignKey("automations.id", ondelete="CASCADE"),
        nullable=False,
    )
    execution_id: Mapped[str | None] = mapped_column(
        postgresql.UUID(as_uuid=False),
        ForeignKey("automation_executions.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="info")
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="result")
    result_data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    action_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_starred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notification_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(tz=timezone.utc)
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_automation_inbox_user_unread", "user_id", "is_read", "is_archived"),
        Index("ix_automation_inbox_automation", "automation_id"),
    )

    def __repr__(self) -> str:
        return f"<AutomationInboxItem id={self.id!r} title={self.title!r}>"


class AutomationSchedule(Base):
    """Extended schedule configuration for external triggers (GitHub, Slack, Linear, etc.)."""

    __tablename__ = "automation_schedules"

    id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    automation_id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False),
        ForeignKey("automations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    trigger_provider: Mapped[str] = mapped_column(String(50), nullable=False)
    trigger_event: Mapped[str] = mapped_column(String(100), nullable=False)
    trigger_config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    trigger_count: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(tz=timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
        onupdate=lambda: datetime.now(tz=timezone.utc),
    )

    __table_args__ = (
        Index("ix_automation_schedules_automation", "automation_id"),
        Index("ix_automation_schedules_provider_event", "trigger_provider", "trigger_event"),
    )
