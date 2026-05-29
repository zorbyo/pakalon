"""Pydantic schemas for team management."""

from datetime import datetime

from pydantic import BaseModel, Field


class TeamMemberResponse(BaseModel):
    """Response schema for a team member."""

    id: str
    team_id: str
    user_id: str | None = None
    agent_id: str
    name: str
    agent_type: str
    model: str | None = None
    lead_session_id: str | None = None
    tmux_pane_id: str | None = None
    tmux_session_name: str | None = None
    backend_type: str | None = None
    cwd: str | None = None
    subscriptions: list[str] = []
    joined_at: datetime

    model_config = {"from_attributes": True}


class TeamCreateRequest(BaseModel):
    """Request to create a new team."""

    name: str = Field(description="Unique team name")
    description: str | None = Field(None, description="Team description/purpose")
    lead_agent_id: str = Field(description="Agent ID of the team lead")


class TeamResponse(BaseModel):
    """Response schema for a team."""

    id: str
    user_id: str
    name: str
    description: str | None = None
    lead_agent_id: str
    lead_session_id: str | None = None
    is_active: bool = True
    members: list[TeamMemberResponse] = []
    created_at: datetime
    updated_at: datetime
    member_count: int = 0

    model_config = {"from_attributes": True}


class TeamListResponse(BaseModel):
    """Response for listing teams."""

    teams: list[TeamResponse]
    total: int


class TeamMemberAddRequest(BaseModel):
    """Request to add a member to a team."""

    agent_id: str = Field(description="Agent ID")
    name: str = Field(description="Member name")
    agent_type: str = Field(default="worker", description="Agent type/role")
    model: str | None = Field(None, description="Model to use")
    cwd: str | None = Field(None, description="Working directory")


class TeamUpdateRequest(BaseModel):
    """Request to update a team."""

    description: str | None = None
    is_active: bool | None = None
    lead_session_id: str | None = None


class TeamMessageRequest(BaseModel):
    """Request to send a message to a team member."""

    to: str = Field(description="Recipient name ('*' for broadcast)")
    message: str = Field(description="Message content")
    summary: str | None = Field(None, description="Message summary (required for direct messages)")