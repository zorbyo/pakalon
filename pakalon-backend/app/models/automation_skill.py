"""Automation skills ORM model — reusable composable workflow bundles.

Similar to Cursor Skills, OpenAI Codex Skills, and OpenClaw Skills:
named workflows that encode how work should be done, which can be
composed into larger automations.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, Index
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AutomationSkill(Base):
    """A reusable skill definition that can be composed into workflows."""

    __tablename__ = "automation_skills"

    id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str | None] = mapped_column(
        postgresql.UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="general")
    icon: Mapped[str] = mapped_column(String(50), nullable=False, default="extension")
    # The skill definition — a prompt template + config schema
    prompt_template: Mapped[str] = mapped_column(Text, nullable=False)
    config_schema: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    # Node definition for visual editor
    node_type: Mapped[str] = mapped_column(String(100), nullable=False)
    node_config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    # Required connectors
    required_connectors: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    # Metadata
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
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
        Index("ix_automation_skills_user", "user_id"),
        Index("ix_automation_skills_category", "category"),
        Index("ix_automation_skills_public", "is_public"),
    )

    def __repr__(self) -> str:
        return f"<AutomationSkill slug={self.slug!r} name={self.name!r}>"


class AutomationAuditLog(Base):
    """Detailed audit trail for all automation actions."""

    __tablename__ = "automation_audit_logs"

    id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    automation_id: Mapped[str | None] = mapped_column(
        postgresql.UUID(as_uuid=False),
        ForeignKey("automations.id", ondelete="SET NULL"),
        nullable=True,
    )
    execution_id: Mapped[str | None] = mapped_column(
        postgresql.UUID(as_uuid=False),
        ForeignKey("automation_executions.id", ondelete="SET NULL"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(tz=timezone.utc)
    )

    __table_args__ = (
        Index("ix_automation_audit_user", "user_id"),
        Index("ix_automation_audit_automation", "automation_id"),
        Index("ix_automation_audit_action", "action"),
        Index("ix_automation_audit_created", "created_at"),
    )
