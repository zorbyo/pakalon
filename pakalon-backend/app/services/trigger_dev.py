"""Trigger.dev REST API client for automation scheduling.

Uses Trigger.dev v3 REST API to create and manage scheduled tasks.
Falls back gracefully when API key is not configured.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class TriggerDevClient:
    """Lightweight Trigger.dev v3 REST API client."""

    def __init__(self) -> None:
        settings = get_settings()
        self.api_key = settings.trigger_dev_api_key
        self.api_url = settings.trigger_dev_api_url.rstrip("/")
        self.app_id = settings.trigger_dev_app_id
        self._enabled = bool(self.api_key)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def create_schedule(
        self,
        schedule_id: str,
        cron: str,
        timezone: str = "UTC",
        payload: dict[str, Any] | None = None,
        task_id: str = "automation-cron",
    ) -> dict[str, Any]:
        """Create or update a scheduled task on Trigger.dev."""
        if not self._enabled:
            raise RuntimeError("Trigger.dev is not configured")

        body = {
            "deduplicationKey": schedule_id,
            "cronExpression": cron,
            "timezone": timezone,
            "taskId": task_id,
            "payload": payload or {},
            "externalId": schedule_id,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.api_url}/api/v1/schedules",
                headers=self._headers(),
                json=body,
            )
            resp.raise_for_status()
            return resp.json()

    async def delete_schedule(self, schedule_id: str) -> bool:
        """Delete a scheduled task from Trigger.dev."""
        if not self._enabled:
            return False

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # First try to find by deduplication key
                resp = await client.get(
                    f"{self.api_url}/api/v1/schedules",
                    headers=self._headers(),
                    params={"externalId": schedule_id},
                )
                resp.raise_for_status()
                data = resp.json()
                schedules = data.get("data", data) if isinstance(data, dict) else data

                if not schedules:
                    return True

                for sched in schedules if isinstance(schedules, list) else [schedules]:
                    sched_id = sched.get("id")
                    if sched_id:
                        del_resp = await client.delete(
                            f"{self.api_url}/api/v1/schedules/{sched_id}",
                            headers=self._headers(),
                        )
                        del_resp.raise_for_status()

                return True
        except Exception as exc:
            logger.warning("Failed to delete Trigger.dev schedule %s: %s", schedule_id, exc)
            return False

    async def list_schedules(self) -> list[dict[str, Any]]:
        """List all schedules for this app."""
        if not self._enabled:
            return []

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    f"{self.api_url}/api/v1/schedules",
                    headers=self._headers(),
                    params={"perPage": 100},
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("data", data) if isinstance(data, dict) else data
        except Exception as exc:
            logger.warning("Failed to list Trigger.dev schedules: %s", exc)
            return []

    async def get_schedule(self, schedule_id: str) -> dict[str, Any] | None:
        """Get a schedule by external ID."""
        if not self._enabled:
            return None

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    f"{self.api_url}/api/v1/schedules",
                    headers=self._headers(),
                    params={"externalId": schedule_id},
                )
                resp.raise_for_status()
                data = resp.json()
                schedules = data.get("data", data) if isinstance(data, dict) else data
                if isinstance(schedules, list) and schedules:
                    return schedules[0]
                return None
        except Exception as exc:
            logger.warning("Failed to get Trigger.dev schedule %s: %s", schedule_id, exc)
            return None

    async def trigger_task(
        self,
        task_id: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Trigger a one-off task execution on Trigger.dev."""
        if not self._enabled:
            raise RuntimeError("Trigger.dev is not configured")

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.api_url}/api/v1/tasks/{task_id}/trigger",
                headers=self._headers(),
                json=payload or {},
            )
            resp.raise_for_status()
            return resp.json()

    async def health_check(self) -> dict[str, Any]:
        """Check if Trigger.dev API is reachable."""
        if not self._enabled:
            return {"status": "disabled", "message": "No API key configured"}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self.api_url}/api/v1/me",
                    headers=self._headers(),
                )
                if resp.is_success:
                    return {"status": "connected", "details": resp.json()}
                return {"status": "error", "message": f"HTTP {resp.status_code}"}
        except Exception as exc:
            return {"status": "error", "message": str(exc)}


# Singleton instance
trigger_dev = TriggerDevClient()
