"""add agent memory, inbox, skills, schedules, and audit tables.

Revision ID: 0023_automation_advanced_features
Revises: 0022
Create Date: 2026-03-16 01:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_automation_advanced_features"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Agent Memory — persistent KV store per workflow
    op.create_table(
        "automation_memory",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "automation_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("memory_key", sa.String(length=255), nullable=False),
        sa.Column("memory_value", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("value_type", sa.String(length=32), nullable=False, server_default="json"),
        sa.Column("access_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("automation_id", "memory_key", name="uq_automation_memory_key"),
    )
    op.create_index(
        "ix_automation_memory_automation_key",
        "automation_memory",
        ["automation_id", "memory_key"],
        unique=True,
    )
    op.create_index("ix_automation_memory_user_id", "automation_memory", ["user_id"])

    # Results Inbox
    op.create_table(
        "automation_inbox",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "automation_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "execution_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automation_executions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="info"),
        sa.Column("category", sa.String(length=50), nullable=False, server_default="result"),
        sa.Column("result_data", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("action_url", sa.String(length=1000), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_starred", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "notification_sent", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_automation_inbox_user_unread", "automation_inbox", ["user_id", "is_read", "is_archived"]
    )
    op.create_index("ix_automation_inbox_automation", "automation_inbox", ["automation_id"])

    # External Trigger Schedules (GitHub, Slack, Linear, etc.)
    op.create_table(
        "automation_schedules",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "automation_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("trigger_provider", sa.String(length=50), nullable=False),
        sa.Column("trigger_event", sa.String(length=100), nullable=False),
        sa.Column(
            "trigger_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trigger_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_automation_schedules_automation", "automation_schedules", ["automation_id"])
    op.create_index(
        "ix_automation_schedules_provider_event",
        "automation_schedules",
        ["trigger_provider", "trigger_event"],
    )

    # Skills
    op.create_table(
        "automation_skills",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False, server_default="general"),
        sa.Column("icon", sa.String(length=50), nullable=False, server_default="extension"),
        sa.Column("prompt_template", sa.Text(), nullable=False),
        sa.Column("config_schema", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("node_type", sa.String(length=100), nullable=False),
        sa.Column("node_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column(
            "required_connectors", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")
        ),
        sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_automation_skills_user", "automation_skills", ["user_id"])
    op.create_index("ix_automation_skills_category", "automation_skills", ["category"])
    op.create_index("ix_automation_skills_public", "automation_skills", ["is_public"])

    # Audit Logs
    op.create_table(
        "automation_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "automation_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "execution_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automation_executions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("resource_type", sa.String(length=50), nullable=False),
        sa.Column("resource_id", sa.String(length=255), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_automation_audit_user", "automation_audit_logs", ["user_id"])
    op.create_index("ix_automation_audit_automation", "automation_audit_logs", ["automation_id"])
    op.create_index("ix_automation_audit_action", "automation_audit_logs", ["action"])
    op.create_index("ix_automation_audit_created", "automation_audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_table("automation_audit_logs")
    op.drop_table("automation_skills")
    op.drop_table("automation_schedules")
    op.drop_table("automation_inbox")
    op.drop_table("automation_memory")
