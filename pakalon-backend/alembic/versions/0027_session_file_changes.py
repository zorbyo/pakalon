"""Add per-session file change history.

Revision ID: 0027
Revises: 0026
Create Date: 2026-05-20 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "session_file_changes",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, nullable=False),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("path", sa.String(length=2048), nullable=False),
        sa.Column("lines_added", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lines_deleted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("diff", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False, server_default="cli"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_session_file_changes_session_id",
        "session_file_changes",
        ["session_id"],
    )
    op.create_index(
        "ix_session_file_changes_user_id",
        "session_file_changes",
        ["user_id"],
    )
    op.create_index(
        "ix_session_file_changes_session_created",
        "session_file_changes",
        ["session_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_session_file_changes_session_created", table_name="session_file_changes")
    op.drop_index("ix_session_file_changes_user_id", table_name="session_file_changes")
    op.drop_index("ix_session_file_changes_session_id", table_name="session_file_changes")
    op.drop_table("session_file_changes")
