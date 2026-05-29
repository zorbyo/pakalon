"""Unified automation scheduler — APScheduler primary with optional Trigger.dev fallback.

APScheduler is ALWAYS the primary scheduler for automation cron jobs.
When Trigger.dev is configured (via TRIGGER_DEV_API_KEY), schedules are
also mirrored there as a reliability fallback.  If APScheduler misses a
job (e.g. server was down during the scheduled time), Trigger.dev can
still fire the job via the webhook callback endpoint.

Usage:
    from app.services.scheduler_manager import automation_scheduler
    automation_scheduler.add_job(...)
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable

from app.config import get_settings

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


class AutomationSchedulerManager:
    """APScheduler-primary scheduler with optional Trigger.dev fallback mirror."""

    def __init__(self) -> None:
        self._apscheduler = None  # lazy import
        self._trigger_dev = None  # lazy import — only used as fallback
        self._trigger_dev_enabled: bool = False
        self._jobs: dict[str, dict[str, Any]] = {}  # in-memory metadata for Trigger.dev fallback

    # ── Initialisation ──────────────────────────────────────────

    def init(self) -> None:
        """Initialise APScheduler (always) and optionally Trigger.dev (fallback)."""
        # Always load APScheduler
        from app.scheduler import scheduler  # noqa: PLC0415

        self._apscheduler = scheduler
        logger.info("Automation scheduler: APScheduler active (primary)")

        # Optionally load Trigger.dev as fallback
        settings = get_settings()
        if settings.trigger_dev_api_key:
            from app.services.trigger_dev import trigger_dev  # noqa: PLC0415

            self._trigger_dev = trigger_dev
            if trigger_dev.enabled:
                self._trigger_dev_enabled = True
                logger.info("Automation scheduler: Trigger.dev active (fallback mirror)")
            else:
                logger.info("Automation scheduler: Trigger.dev key present but client disabled")
        else:
            logger.info("Automation scheduler: Trigger.dev not configured — APScheduler only")

    @property
    def using_trigger_dev(self) -> bool:
        """Whether Trigger.dev fallback is active alongside APScheduler."""
        return self._trigger_dev_enabled

    @property
    def backend_name(self) -> str:
        """Human-readable scheduler backend summary for startup logs."""
        return "apscheduler+triggerdev-fallback" if self._trigger_dev_enabled else "apscheduler"

    # ── Job management ──────────────────────────────────────────

    def add_job(
        self,
        func: Callable,
        trigger: str = "cron",
        id: str | None = None,
        args: list[Any] | None = None,
        replace_existing: bool = True,
        **trigger_kwargs: Any,
    ) -> None:
        """Schedule a recurring job on APScheduler (primary).

        If Trigger.dev is configured, also mirror the schedule there
        as a reliability fallback.
        """
        job_id = id or f"automation:{_now().timestamp()}"

        # Store metadata for Trigger.dev fallback lookups
        self._jobs[job_id] = {
            "func": func,
            "args": args or [],
            "trigger": trigger,
            "trigger_kwargs": trigger_kwargs,
        }

        # PRIMARY: Always add to APScheduler
        self._add_apscheduler_job(job_id, func, trigger, args, replace_existing, trigger_kwargs)

        # FALLBACK: Also mirror to Trigger.dev if configured
        if self._trigger_dev_enabled and self._trigger_dev:
            self._mirror_to_trigger_dev(job_id, trigger_kwargs)

    def _add_apscheduler_job(
        self,
        job_id: str,
        func: Callable,
        trigger: str,
        args: list[Any] | None,
        replace_existing: bool,
        trigger_kwargs: dict[str, Any],
    ) -> None:
        """Add job to APScheduler (primary scheduler)."""
        if not self._apscheduler:
            return

        from apscheduler.triggers.cron import CronTrigger  # noqa: PLC0415

        if trigger == "cron":
            cron_expr = trigger_kwargs.get("cron_expression")
            tz = trigger_kwargs.get("timezone", get_settings().scheduler_timezone)

            if cron_expr:
                ap_trigger = CronTrigger.from_crontab(cron_expr, timezone=tz)
            else:
                ap_trigger = CronTrigger(
                    **{
                        k: v
                        for k, v in trigger_kwargs.items()
                        if k not in ("cron_expression", "timezone")
                    },
                    timezone=tz,
                )

            self._apscheduler.add_job(
                func,
                trigger=ap_trigger,
                id=job_id,
                args=args or [],
                replace_existing=replace_existing,
            )
        else:
            self._apscheduler.add_job(
                func,
                trigger=trigger,
                id=job_id,
                args=args or [],
                replace_existing=replace_existing,
                **trigger_kwargs,
            )

    def _mirror_to_trigger_dev(self, job_id: str, trigger_kwargs: dict[str, Any]) -> None:
        """Mirror a schedule to Trigger.dev as fallback (fire-and-forget)."""
        cron_expr = trigger_kwargs.get("cron_expression", "0 * * * *")
        tz = trigger_kwargs.get("timezone", get_settings().scheduler_timezone)

        async def _create() -> None:
            try:
                assert self._trigger_dev is not None
                await self._trigger_dev.create_schedule(
                    schedule_id=job_id,
                    cron=cron_expr,
                    timezone=tz,
                    payload={
                        "automation_id": job_id.split(":", 1)[-1] if ":" in job_id else job_id
                    },
                )
                logger.debug("Trigger.dev fallback schedule created: %s", job_id)
            except Exception as exc:
                logger.warning(
                    "Trigger.dev fallback mirror failed for %s (non-critical): %s",
                    job_id,
                    exc,
                )

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_create())
        except RuntimeError:
            asyncio.run(_create())

    def remove_job(self, job_id: str) -> None:
        """Remove a scheduled job from APScheduler (and Trigger.dev fallback)."""
        self._jobs.pop(job_id, None)

        # Remove from APScheduler (primary)
        if self._apscheduler:
            try:
                self._apscheduler.remove_job(job_id)
            except Exception:
                pass

        # Remove from Trigger.dev (fallback)
        if self._trigger_dev_enabled and self._trigger_dev:
            self._remove_trigger_dev_job(job_id)

    def _remove_trigger_dev_job(self, job_id: str) -> None:
        async def _delete() -> None:
            try:
                assert self._trigger_dev is not None
                await self._trigger_dev.delete_schedule(job_id)
                logger.debug("Trigger.dev fallback schedule removed: %s", job_id)
            except Exception as exc:
                logger.warning(
                    "Trigger.dev fallback remove failed for %s (non-critical): %s",
                    job_id,
                    exc,
                )

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_delete())
        except RuntimeError:
            asyncio.run(_delete())

    def get_job(self, job_id: str) -> Any:
        """Get job metadata from APScheduler (primary).

        Always returns the APScheduler Job object — Trigger.dev is only fallback.
        """
        if self._apscheduler:
            return self._apscheduler.get_job(job_id)
        return None

    def get_jobs(self) -> list[Any]:
        """List all APScheduler jobs (primary)."""
        if self._apscheduler:
            return self._apscheduler.get_jobs()
        return []

    # ── Trigger.dev fallback callback ───────────────────────────

    async def handle_trigger_dev_callback(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Handle an incoming webhook from Trigger.dev fallback.

        This fires when Trigger.dev's scheduled task executes. It serves as
        a fallback in case APScheduler missed the job (e.g. server was down).
        The job executes normally via the same function APScheduler would call.
        """
        automation_id = payload.get("automation_id") or payload.get("externalId", "")
        if not automation_id:
            return {"status": "error", "message": "No automation_id in payload"}

        job_meta = self._jobs.get(f"automation:{automation_id}")
        if not job_meta:
            # Execute directly via the executor
            try:
                from app.services.automation_executor import execute_workflow  # noqa: PLC0415

                await execute_workflow(
                    automation_id=automation_id,
                    trigger_type="triggerdev_fallback",
                    trigger_data=payload,
                )
                return {
                    "status": "executed",
                    "source": "triggerdev_fallback",
                    "automation_id": automation_id,
                }
            except Exception as exc:
                logger.exception("Trigger.dev fallback execution failed")
                return {"status": "error", "message": str(exc)}

        # Call the stored function
        func = job_meta["func"]
        args = job_meta.get("args", [])
        try:
            if asyncio.iscoroutinefunction(func):
                await func(*args)
            else:
                func(*args)
            return {
                "status": "executed",
                "source": "triggerdev_fallback",
                "automation_id": automation_id,
            }
        except Exception as exc:
            logger.exception("Trigger.dev fallback function failed")
            return {"status": "error", "message": str(exc)}

    # ── Health ──────────────────────────────────────────────────

    def health(self) -> dict[str, Any]:
        """Return scheduler health info."""
        info: dict[str, Any] = {
            "primary": "apscheduler",
            "fallback": "triggerdev" if self._trigger_dev_enabled else "none",
            "jobs_count": len(self._jobs),
        }
        if self._apscheduler:
            info["apscheduler_running"] = self._apscheduler.running
            info["apscheduler_jobs"] = len(self._apscheduler.get_jobs())
        if self._trigger_dev_enabled and self._trigger_dev:
            info["triggerdev_enabled"] = True
        return info


# Singleton instance
automation_scheduler = AutomationSchedulerManager()
