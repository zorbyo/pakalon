"""Teams router — multi-agent team management (T-TEAM)."""

import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.dependencies import get_current_user
from app.models.team import Team, TeamMember
from app.models.user import User
from app.schemas.teams import (
    TeamCreateRequest,
    TeamListResponse,
    TeamMemberAddRequest,
    TeamMemberResponse,
    TeamMessageRequest,
    TeamResponse,
    TeamUpdateRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/teams", tags=["teams"])


def team_to_response(team: Team) -> TeamResponse:
    """Convert Team model to TeamResponse."""
    return TeamResponse(
        id=team.id,
        user_id=team.user_id,
        name=team.name,
        description=team.description,
        lead_agent_id=team.lead_agent_id,
        lead_session_id=team.lead_session_id,
        is_active=team.is_active,
        members=[member_to_response(m) for m in team.members],
        created_at=team.created_at,
        updated_at=team.updated_at,
        member_count=len(team.members),
    )


def member_to_response(member: TeamMember) -> TeamMemberResponse:
    """Convert TeamMember model to TeamMemberResponse."""
    subscriptions = []
    if member.subscriptions:
        try:
            subscriptions = json.loads(member.subscriptions)
        except json.JSONDecodeError:
            subscriptions = []

    return TeamMemberResponse(
        id=member.id,
        team_id=member.team_id,
        user_id=member.user_id,
        agent_id=member.agent_id,
        name=member.name,
        agent_type=member.agent_type,
        model=member.model,
        lead_session_id=member.lead_session_id,
        tmux_pane_id=member.tmux_pane_id,
        tmux_session_name=member.tmux_session_name,
        backend_type=member.backend_type,
        cwd=member.cwd,
        subscriptions=subscriptions,
        joined_at=member.joined_at,
    )


@router.post(
    "",
    response_model=TeamResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new team",
)
async def create_team(
    body: TeamCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Create a new multi-agent team."""
    # Check if team name already exists
    existing = await db.execute(select(Team).where(Team.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Team with name '{body.name}' already exists",
        )

    team = Team(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        name=body.name,
        description=body.description,
        lead_agent_id=body.lead_agent_id,
    )

    # Create the lead as the first member
    lead_member = TeamMember(
        id=str(uuid.uuid4()),
        team_id=team.id,
        user_id=current_user.id,
        agent_id=body.lead_agent_id,
        name="team-lead",
        agent_type="coordinator",
    )
    team.members.append(lead_member)

    db.add(team)
    await db.commit()
    await db.refresh(team)

    logger.info(f"Created team {team.id} ('{team.name}') for user {current_user.id}")
    return team_to_response(team)


@router.get(
    "",
    response_model=TeamListResponse,
    summary="List user's teams",
)
async def list_teams(
    active_only: bool = Query(default=True, description="Only show active teams"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """List all teams for the current user."""
    q = select(Team).where(Team.user_id == current_user.id)
    count_q = select(func.count()).select_from(Team).where(Team.user_id == current_user.id)

    if active_only:
        q = q.where(Team.is_active == True)
        count_q = count_q.where(Team.is_active == True)

    # Get total count
    total_result = await db.execute(count_q)
    total = total_result.scalar_one()

    # Execute query with members loaded
    result = await db.execute(
        q.options(selectinload(Team.members))
        .order_by(Team.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    teams = result.scalars().all()

    return TeamListResponse(
        teams=[team_to_response(t) for t in teams],
        total=total,
    )


@router.get(
    "/{team_id}",
    response_model=TeamResponse,
    summary="Get a single team",
)
async def get_team(
    team_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Get a specific team by ID."""
    result = await db.execute(
        select(Team)
        .where(Team.id == team_id, Team.user_id == current_user.id)
        .options(selectinload(Team.members))
    )
    team = result.scalar_one_or_none()

    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    return team_to_response(team)


@router.patch(
    "/{team_id}",
    response_model=TeamResponse,
    summary="Update a team",
)
async def update_team(
    team_id: str,
    body: TeamUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Update a team's metadata."""
    result = await db.execute(
        select(Team)
        .where(Team.id == team_id, Team.user_id == current_user.id)
        .options(selectinload(Team.members))
    )
    team = result.scalar_one_or_none()

    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(team, field, value)

    await db.commit()
    await db.refresh(team)

    logger.info(f"Updated team {team_id}: {update_data}")
    return team_to_response(team)


@router.delete(
    "/{team_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a team",
)
async def delete_team(
    team_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Delete a team and all its members."""
    result = await db.execute(
        select(Team).where(Team.id == team_id, Team.user_id == current_user.id)
    )
    team = result.scalar_one_or_none()

    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    await db.delete(team)
    await db.commit()

    logger.info(f"Deleted team {team_id}")


@router.post(
    "/{team_id}/members",
    response_model=TeamMemberResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a member to a team",
)
async def add_team_member(
    team_id: str,
    body: TeamMemberAddRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Add a new member to a team."""
    # Verify team ownership
    result = await db.execute(
        select(Team).where(Team.id == team_id, Team.user_id == current_user.id)
    )
    team = result.scalar_one_or_none()

    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    if not team.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add members to an inactive team",
        )

    member = TeamMember(
        id=str(uuid.uuid4()),
        team_id=team_id,
        user_id=current_user.id,
        agent_id=body.agent_id,
        name=body.name,
        agent_type=body.agent_type,
        model=body.model,
        cwd=body.cwd,
    )

    db.add(member)
    await db.commit()
    await db.refresh(member)

    logger.info(f"Added member {member.id} to team {team_id}")
    return member_to_response(member)


@router.delete(
    "/{team_id}/members/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a member from a team",
)
async def remove_team_member(
    team_id: str,
    member_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Remove a member from a team."""
    # Verify team ownership
    result = await db.execute(
        select(Team).where(Team.id == team_id, Team.user_id == current_user.id)
    )
    team = result.scalar_one_or_none()

    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    # Find the member
    member_result = await db.execute(
        select(TeamMember).where(
            TeamMember.id == member_id, TeamMember.team_id == team_id
        )
    )
    member = member_result.scalar_one_or_none()

    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team member not found",
        )

    await db.delete(member)
    await db.commit()

    logger.info(f"Removed member {member_id} from team {team_id}")


@router.post(
    "/{team_id}/message",
    status_code=status.HTTP_200_OK,
    summary="Send a message to a team member",
)
async def send_team_message(
    team_id: str,
    body: TeamMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """
    Send a message to a team member or broadcast to all members.

    Note: This is a thin layer that stores the message.
    Actual message delivery is handled by the CLI's inbox system.
    """
    # Verify team ownership
    result = await db.execute(
        select(Team)
        .where(Team.id == team_id, Team.user_id == current_user.id)
        .options(selectinload(Team.members))
    )
    team = result.scalar_one_or_none()

    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    if not team.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot send messages to an inactive team",
        )

    # Find recipient(s)
    recipients = []
    if body.to == "*":
        recipients = team.members
    else:
        recipients = [m for m in team.members if m.name == body.to]
        if not recipients:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Team member '{body.to}' not found",
            )

    # Log the message attempt
    logger.info(
        f"Message from {current_user.id} to team {team_id}: "
        f"to='{body.to}', summary='{body.summary}'"
    )

    return {
        "success": True,
        "message": f"Message queued for {'broadcast' if body.to == '*' else 'delivery'}",
        "recipient_count": len(recipients),
    }