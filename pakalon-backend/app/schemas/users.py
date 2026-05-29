"""Pydantic schemas for user endpoints."""
from datetime import datetime

from pydantic import BaseModel, Field


class MeResponse(BaseModel):
    """Response for GET /auth/me — flat user profile."""
    id: str
    github_login: str
    email: str
    display_name: str
    plan: str
    trial_days_used: int
    trial_days_remaining: int
    privacy_mode: bool = False
    figma_pat: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdateRequest(BaseModel):
    """Fields the user can update."""
    display_name: str | None = Field(None, max_length=255)
    privacy_mode: bool | None = None


class FigmaPatRequest(BaseModel):
    """Request body for storing/updating the Figma Personal Access Token."""
    pat: str = Field(..., min_length=10, max_length=512, description="Figma Personal Access Token")


class TelegramTokenRequest(BaseModel):
    """Request body for storing/updating Telegram bot credentials."""
    token: str = Field(..., min_length=20, max_length=512, description="Telegram bot token")
    bot_username: str | None = Field(None, max_length=255)
    webhook_url: str | None = Field(None, max_length=2048)


class TelegramTokenResponse(BaseModel):
    """Stored Telegram bridge credentials for the authenticated user."""
    token: str | None = None
    bot_username: str | None = None
    webhook_url: str | None = None


class TelemetryResetRequest(BaseModel):
    """Request body for fake-pakalon reset endpoint (development only)."""
    reset_trial_days: bool = False


class TelemetryResetResponse(BaseModel):
    """Response summary for fake-pakalon reset endpoint."""
    user_id: str
    telemetry_deleted: int
    machine_ids_deleted: int
    heatmap_deleted: int
    trial_days_reset: bool
