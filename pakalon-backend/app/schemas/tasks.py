"""Pydantic schemas for task management."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TaskCreateRequest(BaseModel):
    """Request to create a new task."""

    type: str = Field(description="Task type (local_bash, local_agent, remote_agent, etc.)")
    description: str | None = Field(None, description="Human-readable task description")
    session_id: str | None = Field(None, description="Associated session ID")
    team_id: str | None = Field(None, description="Associated team ID")
    input_data: dict[str, Any] | None = Field(None, description="Task input data as JSON")


class TaskResponse(BaseModel):
    """Response schema for a task."""

    id: str
    user_id: str
    session_id: str | None = None
    team_id: str | None = None
    type: str
    status: str
    description: str | None = None
    output_file: str | None = None
    output_offset: int = 0
    tool_use_id: str | None = None
    total_tokens: int | None = None
    tool_uses: int | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    total_paused_ms: int | None = None
    notified: bool = False
    created_at: datetime
    updated_at: datetime
    duration_ms: int | None = None

    model_config = {"from_attributes": True}


class TaskUpdateRequest(BaseModel):
    """Request to update a task status."""

    status: str | None = Field(None, description="New status (pending, running, completed, failed, killed)")
    output_offset: int | None = Field(None, description="Output file offset")
    total_tokens: int | None = Field(None, description="Total tokens used")
    tool_uses: int | None = Field(None, description="Number of tool uses")
    tool_use_id: str | None = Field(None, description="Tool use ID for this task")
    notified: bool | None = Field(None, description="Notification sent flag")


class TaskListResponse(BaseModel):
    """Response for listing tasks."""

    tasks: list[TaskResponse]
    total: int
    running_count: int = 0
    completed_count: int = 0
    failed_count: int = 0


class TaskOutputResponse(BaseModel):
    """Response for task output retrieval."""

    task_id: str
    content: str
    offset: int
    is_complete: bool