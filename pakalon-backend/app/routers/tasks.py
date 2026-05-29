"""Tasks router — background task management (T-TASKS)."""

import json
import logging
import uuid
from datetime import datetime, timezone
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import get_current_user
from app.models.task import Task, TaskStatus, TaskType
from app.models.user import User
from app.schemas.tasks import (
    TaskCreateRequest,
    TaskListResponse,
    TaskOutputResponse,
    TaskResponse,
    TaskUpdateRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["tasks"])


def task_to_response(task: Task) -> TaskResponse:
    """Convert Task model to TaskResponse."""
    return TaskResponse(
        id=task.id,
        user_id=task.user_id,
        session_id=task.session_id,
        team_id=task.team_id,
        type=task.type,
        status=task.status,
        description=task.description,
        output_file=task.output_file,
        output_offset=task.output_offset,
        tool_use_id=task.tool_use_id,
        total_tokens=task.total_tokens,
        tool_uses=task.tool_uses,
        start_time=task.start_time,
        end_time=task.end_time,
        total_paused_ms=task.total_paused_ms,
        notified=task.notified,
        created_at=task.created_at,
        updated_at=task.updated_at,
        duration_ms=task.duration_ms,
    )


@router.post(
    "",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new task",
)
async def create_task(
    body: TaskCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Create a new background task."""
    # Validate task type
    valid_types = [t.value for t in TaskType]
    if body.type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid task type. Must be one of: {valid_types}",
        )

    task = Task(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        session_id=body.session_id,
        team_id=body.team_id,
        type=body.type,
        status=TaskStatus.PENDING.value,
        description=body.description,
        input_data=json.dumps(body.input_data) if body.input_data else None,
    )

    db.add(task)
    await db.commit()
    await db.refresh(task)

    logger.info(f"Created task {task.id} for user {current_user.id}")
    return task_to_response(task)


@router.get(
    "",
    response_model=TaskListResponse,
    summary="List user's tasks",
)
async def list_tasks(
    status_filter: str | None = Query(None, alias="status", description="Filter by task status"),
    task_type: str | None = Query(None, alias="type", description="Filter by task type"),
    session_id: str | None = Query(None, description="Filter by session ID"),
    team_id: str | None = Query(None, description="Filter by team ID"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """List all tasks for the current user with optional filters."""
    # Base query
    q = select(Task).where(Task.user_id == current_user.id)
    count_q = select(func.count()).select_from(Task).where(Task.user_id == current_user.id)

    # Apply filters
    if status_filter:
        q = q.where(Task.status == status_filter)
        count_q = count_q.where(Task.status == status_filter)
    if task_type:
        q = q.where(Task.type == task_type)
        count_q = count_q.where(Task.type == task_type)
    if session_id:
        q = q.where(Task.session_id == session_id)
        count_q = count_q.where(Task.session_id == session_id)
    if team_id:
        q = q.where(Task.team_id == team_id)
        count_q = count_q.where(Task.team_id == team_id)

    # Get total count
    total_result = await db.execute(count_q)
    total = total_result.scalar_one()

    # Get running/completed/failed counts for summary
    running_result = await db.execute(
        select(func.count())
        .select_from(Task)
        .where(and_(Task.user_id == current_user.id, Task.status == TaskStatus.RUNNING.value))
    )
    running_count = running_result.scalar_one() or 0

    completed_result = await db.execute(
        select(func.count())
        .select_from(Task)
        .where(and_(Task.user_id == current_user.id, Task.status == TaskStatus.COMPLETED.value))
    )
    completed_count = completed_result.scalar_one() or 0

    failed_result = await db.execute(
        select(func.count())
        .select_from(Task)
        .where(and_(Task.user_id == current_user.id, Task.status == TaskStatus.FAILED.value))
    )
    failed_count = failed_result.scalar_one() or 0

    # Execute main query
    result = await db.execute(
        q.order_by(Task.created_at.desc()).limit(limit).offset(offset)
    )
    tasks = result.scalars().all()

    return TaskListResponse(
        tasks=[task_to_response(t) for t in tasks],
        total=total,
        running_count=running_count,
        completed_count=completed_count,
        failed_count=failed_count,
    )


@router.get(
    "/{task_id}",
    response_model=TaskResponse,
    summary="Get a single task",
)
async def get_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Get a specific task by ID."""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()

    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    return task_to_response(task)


@router.patch(
    "/{task_id}",
    response_model=TaskResponse,
    summary="Update a task",
)
async def update_task(
    task_id: str,
    body: TaskUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Update a task's status or metadata."""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()

    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    # Update fields
    update_data = body.model_dump(exclude_unset=True)

    # Validate status if provided
    if "status" in update_data:
        valid_statuses = [s.value for s in TaskStatus]
        if update_data["status"] not in valid_statuses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Must be one of: {valid_statuses}",
            )

        # Set timing fields based on status transition
        if update_data["status"] == TaskStatus.RUNNING.value and not task.start_time:
            update_data["start_time"] = datetime.now(tz=timezone.utc)
        elif update_data["status"] in (
            TaskStatus.COMPLETED.value,
            TaskStatus.FAILED.value,
            TaskStatus.KILLED.value,
        ):
            update_data["end_time"] = datetime.now(tz=timezone.utc)

    for field, value in update_data.items():
        setattr(task, field, value)

    await db.commit()
    await db.refresh(task)

    logger.info(f"Updated task {task_id}: {update_data}")
    return task_to_response(task)


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a task",
)
async def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Delete a task."""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()

    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    await db.delete(task)
    await db.commit()

    logger.info(f"Deleted task {task_id}")


@router.post(
    "/{task_id}/stop",
    response_model=TaskResponse,
    summary="Stop a running task",
)
async def stop_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Stop a running task (sets status to killed)."""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()

    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status == TaskStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot stop a completed task",
        )

    task.status = TaskStatus.KILLED.value
    task.end_time = datetime.now(tz=timezone.utc)

    await db.commit()
    await db.refresh(task)

    logger.info(f"Stopped task {task_id}")
    return task_to_response(task)


@router.get(
    "/{task_id}/output",
    response_model=TaskOutputResponse,
    summary="Get task output",
)
async def get_task_output(
    task_id: str,
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Get the output of a task from its output file."""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()

    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if not task.output_file:
        return TaskOutputResponse(
            task_id=task_id,
            content="",
            offset=0,
            is_complete=task.is_terminal,
        )

    # Read output file
    try:
        import os

        if os.path.exists(task.output_file):
            with open(task.output_file, "r", encoding="utf-8") as f:
                f.seek(offset)
                content = f.read()
                new_offset = f.tell()
        else:
            content = ""
            new_offset = offset
    except Exception as e:
        logger.error(f"Failed to read task output file: {e}")
        content = f"Error reading output: {str(e)}"
        new_offset = offset

    return TaskOutputResponse(
        task_id=task_id,
        content=content,
        offset=new_offset,
        is_complete=task.is_terminal,
    )