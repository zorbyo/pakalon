"""Add Telegram token fields to users.

Revision ID: 0026
Revises: 0025
Create Date: 2026-03-30 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("telegram_bot_token", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("telegram_bot_username", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("telegram_webhook_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "telegram_webhook_url")
    op.drop_column("users", "telegram_bot_username")
    op.drop_column("users", "telegram_bot_token")
