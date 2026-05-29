"""Task ORM model — represents a background task."""

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TaskType(str, Enum):
    LOCAL_BASH = "local_bash"
    LOCAL_AGENT = "local_agent"
    REMOTE_AGENT = "remote_agent"
    IN_PROCESS_TEAMMATE = "in_process_teammate"
    LOCAL_WORKFLOW = "local_workflow"
    MONITOR_MCP = "monitor_mcp"
    DREAM = "dream"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    KILLED = "killed"


class Task(Base):
    """A background task in Pakalon, tied to a user and optionally a session."""

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    team_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # Task metadata
    type: Mapped[str] = mapped_column(String(32), nullable=False, default=TaskType.LOCAL_BASH.value)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=TaskStatus.PENDING.value)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Task input/output
    input_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON serialized
    output_file: Mapped[str | None] = mapped_column(String(512), nullable=True)
    output_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Progress tracking
    tool_use_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tool_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Timing
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_paused_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Notification state
    notified: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
        onupdate=lambda: datetime.now(tz=timezone.utc),
    )

    def __repr__(self) -> str:
        return f"<Task id={self.id!r} type={self.type!r} status={self.status!r}>"

    @property
    def is_terminal(self) -> bool:
        """True when task is in a terminal state."""
        return self.status in (
            TaskStatus.COMPLETED.value,
            TaskStatus.FAILED.value,
            TaskStatus.KILLED.value,
        )

    @property
    def duration_ms(self) -> int | None:
        """Calculate task duration in milliseconds."""
        if self.start_time and self.end_time:
            return int((self.end_time - self.start_time).total_seconds() * 1000)
        return None