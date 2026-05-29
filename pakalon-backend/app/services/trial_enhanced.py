"""
Enhanced Trial Abuse Prevention
Tracks trial days used per GitHub account to prevent re-registration abuse.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.login_event import LoginEvent

logger = logging.getLogger(__name__)

# Trial duration in days
TRIAL_DURATION_DAYS = 30


class TrialManager:
    """Enhanced trial management with abuse prevention."""

    @staticmethod
    async def get_or_create_user_with_trial(
        github_login: str,
        email: str,
        display_name: Optional[str],
        session: AsyncSession,
    ) -> User:
        """
        Get or create user with trial tracking.

        If user deleted and re-registers with same GitHub account,
        they only get remaining trial days, not a full 30 days.
        """
        # Check if user exists
        result = await session.execute(
            select(User).where(User.github_login == github_login)
        )
        user = result.scalar_one_or_none()

        if user:
            # User exists - check if they're re-registering
            if user.deleted_at is not None:
                # Reactivate with remaining trial days
                remaining = TrialManager.remaining_trial_days(user)
                if remaining > 0:
                    user.deleted_at = None
                    user.plan = "free"
                    user.trial_ends_at = datetime.now(timezone.utc) + timedelta(days=remaining)
                    logger.info(f"Reactivated user {github_login} with {remaining} trial days remaining")
                else:
                    # Trial expired - no more free trial
                    user.deleted_at = None
                    user.plan = "free"
                    user.trial_ends_at = None
                    logger.info(f"Reactivated user {github_login} - trial expired")
            return user

        # Create new user
        now = datetime.now(timezone.utc)
        trial_ends = now + timedelta(days=TRIAL_DURATION_DAYS)

        user = User(
            github_login=github_login,
            email=email,
            display_name=display_name,
            plan="free",
            trial_started_at=now,
            trial_ends_at=trial_ends,
            trial_days_used=0,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        await session.flush()

        logger.info(f"Created new user {github_login} with {TRIAL_DURATION_DAYS}-day trial")
        return user

    @staticmethod
    def remaining_trial_days(user: User) -> int:
        """Calculate remaining trial days for a user."""
        if user.plan == "pro":
            return -1  # Pro users have unlimited

        if user.trial_ends_at is None:
            return 0

        now = datetime.now(timezone.utc)
        remaining = (user.trial_ends_at - now).days
        return max(0, remaining)

    @staticmethod
    def is_trial_expired(user: User) -> bool:
        """Check if user's trial has expired."""
        if user.plan == "pro":
            return False

        return TrialManager.remaining_trial_days(user) <= 0

    @staticmethod
    async def update_trial_usage(
        user: User,
        session: AsyncSession,
    ) -> None:
        """Update trial days used based on account age."""
        if user.plan == "pro":
            return

        now = datetime.now(timezone.utc)
        if user.trial_started_at:
            days_used = (now - user.trial_started_at).days
            user.trial_days_used = min(days_used, TRIAL_DURATION_DAYS)

    @staticmethod
    async def can_user_interact(
        user: User,
        session: AsyncSession,
    ) -> tuple[bool, str | None]:
        """
        Check if user can interact with the application.

        Returns:
            Tuple of (can_interact, reason)
        """
        if user.plan == "pro":
            return True, None

        if TrialManager.is_trial_expired(user):
            return False, "Your free trial has expired. Upgrade to Pro to continue using Pakalon."

        remaining = TrialManager.remaining_trial_days(user)
        if remaining <= 7:
            return True, f"Warning: {remaining} days left in your trial."

        return True, None

    @staticmethod
    async def send_trial_reminders(
        session: AsyncSession,
    ) -> int:
        """
        Send email reminders for trials expiring within 7 days.
        Called by APScheduler daily.
        """
        now = datetime.now(timezone.utc)
        reminder_threshold = now + timedelta(days=7)

        result = await session.execute(
            select(User).where(
                User.plan == "free",
                User.trial_ends_at.isnot(None),
                User.trial_ends_at <= reminder_threshold,
                User.trial_ends_at > now,
                User.deleted_at.is_(None),
            )
        )

        users = result.scalars().all()
        sent_count = 0

        for user in users:
            remaining = TrialManager.remaining_trial_days(user)
            if remaining > 0 and remaining <= 7:
                # Queue reminder email
                logger.info(f"Trial reminder: {user.email} has {remaining} days left")
                sent_count += 1

        return sent_count

    @staticmethod
    async def handle_account_deletion(
        user: User,
        session: AsyncSession,
    ) -> None:
        """
        Handle account deletion with trial tracking.
        Preserves trial days used for re-registration prevention.
        """
        now = datetime.now(timezone.utc)

        # Calculate days used at deletion
        if user.trial_started_at:
            days_used = (now - user.trial_started_at).days
            user.trial_days_used = min(days_used, TRIAL_DURATION_DAYS)

        # Soft delete - preserve for re-registration tracking
        user.deleted_at = now
        user.plan = "free"

        logger.info(f"User {user.github_login} deleted. Trial days used: {user.trial_days_used}")


# Export singleton
trial_manager = TrialManager()
