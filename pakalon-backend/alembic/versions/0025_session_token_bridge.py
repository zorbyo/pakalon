"""Add message and usage token split fields for CLI bridge.

Revision ID: 0025
Revises: 0024
Create Date: 2026-03-24 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages", sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "messages", sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "model_usage", sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "model_usage", sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0")
    )


def downgrade() -> None:
    op.drop_column("model_usage", "output_tokens")
    op.drop_column("model_usage", "input_tokens")
    op.drop_column("messages", "output_tokens")
    op.drop_column("messages", "input_tokens")
