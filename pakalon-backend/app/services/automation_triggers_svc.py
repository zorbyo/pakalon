"""GitHub and Slack event trigger services.

Handles incoming webhooks from GitHub (PR, push, issue events) and
Slack (message, reaction events) and routes them to matching automations.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.automation_inbox import AutomationSchedule

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ── GitHub Event Routing ────────────────────────────────────────


GITHUB_EVENT_MAP: dict[str, str] = {
    "pull_request": "pull_request",
    "push": "push",
    "issues": "issues",
    "release": "release",
    "issue_comment": "issue_comment",
    "pull_request_review": "pull_request_review",
}


async def handle_github_event(
    *,
    event_type: str,
    action: str | None,
    payload: dict[str, Any],
    session: AsyncSession,
) -> list[dict[str, Any]]:
    """Route a GitHub webhook event to matching automations.

    Returns list of {automation_id, status} for each triggered automation.
    """
    # Normalize the event key
    event_key = GITHUB_EVENT_MAP.get(event_type, event_type)
    if action:
        event_key = f"{event_key}.{action}"

    repo_name = None
    if "repository" in payload:
        repo_name = payload["repository"].get("full_name")

    # Find automations listening for this event
    results = []

    # Check automation_schedules table for GitHub triggers
    rows = await session.execute(
        select(AutomationSchedule).where(
            AutomationSchedule.trigger_provider == "github",
            AutomationSchedule.trigger_event.in_([event_key, event_type, "github"]),
            AutomationSchedule.is_active.is_(True),
        )
    )
    schedules = list(rows.scalars())

    for schedule in schedules:
        # Check repo filter if configured
        config = schedule.trigger_config or {}
        repo_filter = config.get("repo")
        if repo_filter and repo_name and repo_filter != repo_name:
            continue

        # Check branch filter for push events
        if event_type == "push":
            branch_filter = config.get("branch")
            ref = payload.get("ref", "")
            if branch_filter and not ref.endswith(f"/{branch_filter}"):
                continue

        try:
            from app.services.automation_executor import execute_workflow

            await execute_workflow(
                automation_id=schedule.automation_id,
                trigger_type=f"github.{event_key}",
                trigger_data={
                    "event": event_key,
                    "action": action,
                    "repo": repo_name,
                    "payload": _sanitize_payload(payload),
                },
            )

            schedule.last_triggered_at = _now()
            schedule.trigger_count += 1
            await session.flush()

            results.append({"automation_id": schedule.automation_id, "status": "triggered"})
        except Exception as exc:
            logger.exception(
                "Failed to trigger automation %s for GitHub event", schedule.automation_id
            )
            results.append(
                {"automation_id": schedule.automation_id, "status": "error", "error": str(exc)}
            )

    return results


def verify_github_signature(payload_body: bytes, signature: str | None) -> bool:
    """Verify GitHub webhook HMAC signature."""
    if not signature:
        return False
    settings = get_settings()
    secret = getattr(settings, "github_webhook_secret", "")
    if not secret:
        return True  # No secret configured, skip verification

    expected = "sha256=" + hmac.new(secret.encode(), payload_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ── Slack Event Routing ─────────────────────────────────────────


async def handle_slack_event(
    *,
    event_type: str,
    event_data: dict[str, Any],
    team_id: str | None,
    session: AsyncSession,
) -> list[dict[str, Any]]:
    """Route a Slack event to matching automations."""
    results = []

    # Find automations listening for Slack events
    rows = await session.execute(
        select(AutomationSchedule).where(
            AutomationSchedule.trigger_provider == "slack",
            AutomationSchedule.trigger_event.in_([event_type, "slack"]),
            AutomationSchedule.is_active.is_(True),
        )
    )
    schedules = list(rows.scalars())

    for schedule in schedules:
        config = schedule.trigger_config or {}

        # Channel filter
        channel_filter = config.get("channel")
        if channel_filter:
            event_channel = event_data.get("channel", "")
            if event_channel != channel_filter and event_channel != channel_filter.lstrip("#"):
                continue

        try:
            from app.services.automation_executor import execute_workflow

            await execute_workflow(
                automation_id=schedule.automation_id,
                trigger_type=f"slack.{event_type}",
                trigger_data={
                    "event": event_type,
                    "team_id": team_id,
                    "data": _sanitize_payload(event_data),
                },
            )

            schedule.last_triggered_at = _now()
            schedule.trigger_count += 1
            await session.flush()

            results.append({"automation_id": schedule.automation_id, "status": "triggered"})
        except Exception as exc:
            logger.exception(
                "Failed to trigger automation %s for Slack event", schedule.automation_id
            )
            results.append(
                {"automation_id": schedule.automation_id, "status": "error", "error": str(exc)}
            )

    return results


def verify_slack_signature(payload_body: bytes, timestamp: str, signature: str) -> bool:
    """Verify Slack request signature."""
    settings = get_settings()
    signing_secret = getattr(settings, "slack_signing_secret", "")
    if not signing_secret:
        return True

    sig_basestring = f"v0:{timestamp}:{payload_body.decode()}"
    computed = (
        "v0="
        + hmac.new(signing_secret.encode(), sig_basestring.encode(), hashlib.sha256).hexdigest()
    )
    return hmac.compare_digest(computed, signature)


# ── Linear / PagerDuty / Jira Event Routing ─────────────────────


PROVIDER_EVENT_MAP: dict[str, dict[str, str]] = {
    "linear": {
        "Issue": "issue",
        "Comment": "comment",
        "Project": "project",
    },
    "pagerduty": {
        "incident.trigger": "incident.trigger",
        "incident.acknowledge": "incident.acknowledge",
        "incident.resolve": "incident.resolve",
    },
    "jira": {
        "jira:issue_created": "issue.created",
        "jira:issue_updated": "issue.updated",
        "jira:issue_deleted": "issue.deleted",
    },
}


async def handle_generic_event(
    *,
    provider: str,
    event_type: str,
    payload: dict[str, Any],
    session: AsyncSession,
) -> list[dict[str, Any]]:
    """Route events from Linear, PagerDuty, Jira, or other providers."""
    results = []

    # Normalize event key
    event_map = PROVIDER_EVENT_MAP.get(provider, {})
    normalized_event = event_map.get(event_type, event_type)

    rows = await session.execute(
        select(AutomationSchedule).where(
            AutomationSchedule.trigger_provider == provider,
            AutomationSchedule.trigger_event.in_([normalized_event, provider]),
            AutomationSchedule.is_active.is_(True),
        )
    )
    schedules = list(rows.scalars())

    for schedule in schedules:
        try:
            from app.services.automation_executor import execute_workflow

            await execute_workflow(
                automation_id=schedule.automation_id,
                trigger_type=f"{provider}.{normalized_event}",
                trigger_data={
                    "provider": provider,
                    "event": normalized_event,
                    "payload": _sanitize_payload(payload),
                },
            )

            schedule.last_triggered_at = _now()
            schedule.trigger_count += 1
            await session.flush()

            results.append({"automation_id": schedule.automation_id, "status": "triggered"})
        except Exception as exc:
            logger.exception(
                "Failed to trigger automation %s for %s event", schedule.automation_id, provider
            )
            results.append(
                {"automation_id": schedule.automation_id, "status": "error", "error": str(exc)}
            )

    return results


# ── Helpers ─────────────────────────────────────────────────────


def _sanitize_payload(payload: dict[str, Any], max_size: int = 50000) -> dict[str, Any]:
    """Truncate large payloads to avoid storing excessive data."""
    import json

    serialized = json.dumps(payload)
    if len(serialized) <= max_size:
        return payload

    # Truncate nested large fields
    result = {}
    for key, value in payload.items():
        if isinstance(value, (str, bytes)) and len(str(value)) > 5000:
            result[key] = str(value)[:5000] + "... (truncated)"
        elif isinstance(value, dict):
            result[key] = _sanitize_payload(value, max_size=5000)
        elif isinstance(value, list) and len(value) > 50:
            result[key] = value[:50] + ["... (truncated)"]
        else:
            result[key] = value
    return result
