"""Team ORM model — represents a multi-agent team."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TeamMember(Base):
    """A member of a team."""

    __tablename__ = "team_members"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    team_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # Agent metadata
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    agent_type: Mapped[str] = mapped_column(String(32), nullable=False, default="worker")
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Session/pane tracking
    lead_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tmux_pane_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tmux_session_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Backend type (in-process, tmux, remote)
    backend_type: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Working directory
    cwd: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Subscription status
    subscriptions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array

    # Timing
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
    )

    def __repr__(self) -> str:
        return f"<TeamMember id={self.id!r} name={self.name!r}>"


class Team(Base):
    """A multi-agent team for coordinating workers."""

    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Team metadata
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Lead agent info
    lead_agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    lead_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(default=True)

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

    # Relationships
    members: Mapped[list["TeamMember"]] = relationship(
        "TeamMember", back_populates="team", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Team id={self.id!r} name={self.name!r}>"


# Add relationship to TeamMember
TeamMember.team = relationship("Team", back_populates="members")