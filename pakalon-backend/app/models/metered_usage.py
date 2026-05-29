"""MeteredUsage ORM model — records usage-based billing events (T-BACK-17)."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MeteredUsage(Base):
    """Records metered token usage events for post-paid billing."""

    __tablename__ = "metered_usage"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subscription_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("subscriptions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    polar_sub_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True,
    )
    # Number of tokens consumed in this metered event
    tokens_used: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0,
    )
    # Running total of tokens for the current billing cycle
    cycle_token_total: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0,
    )
    # Flush status: "pending" | "reported" | "invoiced" | "paid"
    flush_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending",
    )
    # Polar invoice ID once invoiced
    polar_invoice_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True,
    )
    # Any additional context (JSON string)
    context_json: Mapped[str | None] = mapped_column(
        Text, nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
    )

    def __repr__(self) -> str:
        return (
            f"<MeteredUsage id={self.id!r} user_id={self.user_id!r}"
            f" tokens={self.tokens_used!r} status={self.flush_status!r}>"
        )
