"""add model_id column to automations.

Revision ID: 0024_automation_model_id
Revises: 0023_automation_advanced_features
Create Date: 2026-03-18 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_automation_model_id"
down_revision: str | None = "0023_automation_advanced_features"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("automations", sa.Column("model_id", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("automations", "model_id")
