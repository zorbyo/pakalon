"""Agent memory ORM model — persistent key-value memory per workflow.

Enables workflows to remember data across executions, similar to
Cursor's memory tool that lets agents learn from past runs.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AutomationMemory(Base):
    """Persistent key-value memory for a workflow.

    Each workflow can store arbitrary key-value pairs that persist
    across executions. This enables agents to learn from past runs,
    remember state, and improve over time.
    """

    __tablename__ = "automation_memory"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    automation_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("automations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    memory_key: Mapped[str] = mapped_column(String(255), nullable=False)
    memory_value: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    value_type: Mapped[str] = mapped_column(String(32), nullable=False, default="json")
    access_count: Mapped[int] = mapped_column(nullable=False, default=0)
    last_accessed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
        Index("ix_automation_memory_automation_key", "automation_id", "memory_key", unique=True),
        Index("ix_automation_memory_user_id", "user_id"),
    )

    def __repr__(self) -> str:
        return f"<AutomationMemory automation_id={self.automation_id!r} key={self.memory_key!r}>"
