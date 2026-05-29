"""Billing notification batch job — nightly scheduler for billing reminders and trial notifications."""
import logging

from app.services.billing_notifications import batch_check_and_schedule_notifications

logger = logging.getLogger(__name__)


async def run_billing_notification_batch() -> None:
    """
    Scheduled job (cron 1:00 AM UTC).

    Runs the batch notification check across all users:
    - Trial expiration warnings (14, 7, 3, 1 days)
    - Billing cycle reminders (7 days before due)
    - Subscription renewal reminders (7 days before renewal)
    """
    from app.database import make_async_engine  # noqa: PLC0415
    from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: PLC0415

    engine = make_async_engine(echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with async_session() as session:
            stats = await batch_check_and_schedule_notifications(session)
            await session.commit()

        logger.info("Billing notification batch complete: %s", stats)
    except Exception as exc:
        logger.exception("Billing notification batch job failed: %s", exc)
    finally:
        await engine.dispose()
