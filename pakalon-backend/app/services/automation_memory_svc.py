"""Agent memory service — persistent key-value memory for workflows.

Enables workflows to remember data across executions, similar to
Cursor's memory tool. Workflows can read/write memory entries that
persist between runs.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_memory import AutomationMemory

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


async def get_memory(
    automation_id: str,
    key: str,
    session: AsyncSession,
) -> dict[str, Any] | None:
    """Get a memory value by key for a workflow."""
    row = await session.execute(
        select(AutomationMemory).where(
            AutomationMemory.automation_id == automation_id,
            AutomationMemory.memory_key == key,
        )
    )
    memory = row.scalar_one_or_none()
    if memory is None:
        return None

    # Check expiration
    if memory.expires_at and memory.expires_at < _now():
        await session.delete(memory)
        await session.flush()
        return None

    # Update access tracking
    memory.access_count += 1
    memory.last_accessed_at = _now()
    await session.flush()

    return memory.memory_value


async def set_memory(
    automation_id: str,
    user_id: str,
    key: str,
    value: dict[str, Any],
    session: AsyncSession,
    value_type: str = "json",
    expires_in_seconds: int | None = None,
) -> AutomationMemory:
    """Set or update a memory value for a workflow."""
    row = await session.execute(
        select(AutomationMemory).where(
            AutomationMemory.automation_id == automation_id,
            AutomationMemory.memory_key == key,
        )
    )
    memory = row.scalar_one_or_none()

    expires_at = None
    if expires_in_seconds:
        from datetime import timedelta

        expires_at = _now() + timedelta(seconds=expires_in_seconds)

    if memory is None:
        memory = AutomationMemory(
            automation_id=automation_id,
            user_id=user_id,
            memory_key=key,
            memory_value=value,
            value_type=value_type,
            expires_at=expires_at,
        )
        session.add(memory)
    else:
        memory.memory_value = value
        memory.value_type = value_type
        memory.expires_at = expires_at
        memory.updated_at = _now()

    await session.flush()
    return memory


async def delete_memory(
    automation_id: str,
    key: str,
    session: AsyncSession,
) -> bool:
    """Delete a memory entry."""
    row = await session.execute(
        select(AutomationMemory).where(
            AutomationMemory.automation_id == automation_id,
            AutomationMemory.memory_key == key,
        )
    )
    memory = row.scalar_one_or_none()
    if memory:
        await session.delete(memory)
        await session.flush()
        return True
    return False


async def list_memory(
    automation_id: str,
    session: AsyncSession,
    limit: int = 100,
) -> list[AutomationMemory]:
    """List all memory entries for a workflow."""
    rows = await session.execute(
        select(AutomationMemory)
        .where(AutomationMemory.automation_id == automation_id)
        .order_by(AutomationMemory.updated_at.desc())
        .limit(limit)
    )
    return list(rows.scalars())


async def clear_memory(
    automation_id: str,
    session: AsyncSession,
) -> int:
    """Clear all memory for a workflow. Returns count of deleted entries."""
    result = await session.execute(
        delete(AutomationMemory).where(AutomationMemory.automation_id == automation_id)
    )
    await session.flush()
    return result.rowcount or 0


async def append_to_memory_list(
    automation_id: str,
    user_id: str,
    key: str,
    item: Any,
    session: AsyncSession,
    max_items: int = 100,
) -> dict[str, Any]:
    """Append an item to a list stored in memory. Keeps only the last N items."""
    current = await get_memory(automation_id, key, session)
    items = current.get("items", []) if current else []
    items.append({"value": item, "timestamp": _now().isoformat()})
    items = items[-max_items:]
    result = {"items": items, "count": len(items)}
    await set_memory(automation_id, user_id, key, result, session)
    return result
