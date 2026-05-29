"""add visual workflow editor columns and new tables for executions, node logs, versions.

Revision ID: 0022_automation_visual_editor
Revises: 0021
Create Date: 2026-03-16 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0022_automation_visual_editor"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add new columns to automations table
    op.add_column("automations", sa.Column("workflow_json", sa.JSON(), nullable=True))
    op.add_column(
        "automations",
        sa.Column("workflow_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "automations",
        sa.Column("is_visual", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "automations", sa.Column("webhook_id", sa.String(length=100), nullable=True, unique=True)
    )
    op.add_column(
        "automations",
        sa.Column("trigger_type", sa.String(length=50), nullable=False, server_default="cron"),
    )
    op.add_column("automations", sa.Column("trigger_config", sa.JSON(), nullable=True))

    # Create automation_versions table
    op.create_table(
        "automation_versions",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "automation_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("workflow_json", sa.JSON(), nullable=False),
        sa.Column("change_summary", sa.String(length=500), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_automation_versions_automation_id", "automation_versions", ["automation_id"]
    )

    # Create automation_executions table
    op.create_table(
        "automation_executions",
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
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("trigger_type", sa.String(length=50), nullable=False, server_default="manual"),
        sa.Column("trigger_data", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column(
            "execution_data", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")
        ),
        sa.Column("workflow_snapshot", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_automation_executions_automation_id", "automation_executions", ["automation_id"]
    )
    op.create_index("ix_automation_executions_user_id", "automation_executions", ["user_id"])

    # Create automation_node_logs table
    op.create_table(
        "automation_node_logs",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "execution_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automation_executions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "automation_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("automations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_id", sa.String(length=100), nullable=False),
        sa.Column("node_name", sa.String(length=255), nullable=True),
        sa.Column("node_type", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("level", sa.String(length=20), nullable=False, server_default="info"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("input_data", sa.JSON(), nullable=True),
        sa.Column("output_data", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_automation_node_logs_execution_id", "automation_node_logs", ["execution_id"]
    )
    op.create_index(
        "ix_automation_node_logs_automation_id", "automation_node_logs", ["automation_id"]
    )


def downgrade() -> None:
    op.drop_table("automation_node_logs")
    op.drop_table("automation_executions")
    op.drop_table("automation_versions")
    op.drop_column("automations", "trigger_config")
    op.drop_column("automations", "trigger_type")
    op.drop_column("automations", "webhook_id")
    op.drop_column("automations", "is_visual")
    op.drop_column("automations", "workflow_version")
    op.drop_column("automations", "workflow_json")
