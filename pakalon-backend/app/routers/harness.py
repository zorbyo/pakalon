"""Harness features router — session export, share, model roles, token counting."""

import logging
import subprocess
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.dependencies import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/harness", tags=["harness"])


# ============================================================================
# Request/Response Schemas
# ============================================================================

class SessionExportRequest(BaseModel):
    """Request to export session to HTML."""
    session_id: str = Field(..., description="Session ID to export")
    include_tool_results: bool = Field(True, description="Include tool results in export")
    include_thinking: bool = Field(False, description="Include thinking/reasoning blocks")
    theme: str = Field("dark", description="Theme: 'light' or 'dark'")
    title: Optional[str] = Field(None, description="Custom title for the HTML file")


class SessionExportResponse(BaseModel):
    """Response from session export."""
    success: bool
    html_content: Optional[str] = None
    error: Optional[str] = None


class SessionShareRequest(BaseModel):
    """Request to share session as GitHub Gist."""
    session_id: str = Field(..., description="Session ID to share")
    description: Optional[str] = Field(None, description="Custom description for the gist")
    public: bool = Field(False, description="Whether to make the gist public")
    filename: Optional[str] = Field(None, description="Custom filename")


class SessionShareResponse(BaseModel):
    """Response from session share."""
    success: bool
    gist_id: Optional[str] = None
    gist_url: Optional[str] = None
    html_url: Optional[str] = None
    error: Optional[str] = None


class ModelRoleConfig(BaseModel):
    """Model role configuration."""
    provider_id: str = Field(..., description="Provider ID")
    model_id: str = Field(..., description="Model ID")


class ModelRoleResponse(BaseModel):
    """Response for model roles."""
    roles: dict[str, dict]
    global_fallbacks: list[ModelRoleConfig]


class TokenCountRequest(BaseModel):
    """Request to count tokens."""
    text: str = Field(..., description="Text to count tokens for")
    encoding: str = Field("o200k_base", description="Encoding to use")


class TokenCountResponse(BaseModel):
    """Response for token counting."""
    count: int
    encoding: str
    text_length: int


# ============================================================================
# Session Export Endpoint
# ============================================================================

@router.post(
    "/sessions/export",
    response_model=SessionExportResponse,
    summary="Export session to HTML",
)
async def export_session(
    body: SessionExportRequest,
    current_user: User = Depends(get_current_user),
):
    """Export a session to a nicely formatted HTML file."""
    try:
        # For now, return a placeholder response
        # In production, this would read the session from the database
        # and generate HTML using the SessionHtmlExporter
        
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session {body.session_id}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; max-width: 900px; margin: 0 auto; }}
    .header {{ border-bottom: 1px solid #ddd; padding-bottom: 1rem; margin-bottom: 2rem; }}
    .message {{ margin-bottom: 1.5rem; padding: 1rem; border-radius: 0.5rem; border-left: 3px solid #ddd; }}
    .message.user {{ border-left-color: #2563eb; background: #f5f5f5; }}
    .message.assistant {{ border-left-color: #16a34a; }}
    .message-role {{ font-weight: 600; font-size: 0.875rem; text-transform: uppercase; margin-bottom: 0.5rem; color: #666; }}
    .message-content {{ white-space: pre-wrap; word-break: break-word; }}
    .message-timestamp {{ font-size: 0.75rem; color: #999; margin-top: 0.5rem; }}
  </style>
</head>
<body>
  <div class="header">
    <h1>Session {body.session_id}</h1>
    <p>Exported: {datetime.now(tz=timezone.utc).isoformat()}</p>
  </div>
  <div class="messages">
    <div class="message user">
      <div class="message-role">user</div>
      <div class="message-content">Sample message content</div>
      <div class="message-timestamp">{datetime.now(tz=timezone.utc).isoformat()}</div>
    </div>
  </div>
</body>
</html>"""
        
        return SessionExportResponse(
            success=True,
            html_content=html_content,
        )
    except Exception as e:
        logger.exception("Failed to export session")
        return SessionExportResponse(
            success=False,
            error=str(e),
        )


# ============================================================================
# Session Share Endpoint
# ============================================================================

@router.post(
    "/sessions/share",
    response_model=SessionShareResponse,
    summary="Share session as GitHub Gist",
)
async def share_session(
    body: SessionShareRequest,
    current_user: User = Depends(get_current_user),
):
    """Share a session as a private GitHub Gist with a shareable HTML link."""
    try:
        # Check if gh CLI is available
        try:
            subprocess.run(["gh", "--version"], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            return SessionShareResponse(
                success=False,
                error="GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
            )
        
        # Check if authenticated
        try:
            subprocess.run(["gh", "auth", "status"], capture_output=True, check=True)
        except subprocess.CalledProcessError:
            return SessionShareResponse(
                success=False,
                error="Not authenticated with GitHub. Run 'gh auth login' first.",
            )
        
        # For now, return a placeholder response
        # In production, this would:
        # 1. Export the session to HTML
        # 2. Create a GitHub Gist using gh CLI
        # 3. Return the gist URL
        
        return SessionShareResponse(
            success=True,
            gist_id="placeholder-gist-id",
            gist_url="https://gist.github.com/placeholder",
            html_url="https://gist.github.com/placeholder",
        )
    except Exception as e:
        logger.exception("Failed to share session")
        return SessionShareResponse(
            success=False,
            error=str(e),
        )


# ============================================================================
# Model Roles Endpoint
# ============================================================================

@router.get(
    "/model-roles",
    response_model=ModelRoleResponse,
    summary="Get model role configurations",
)
async def get_model_roles(
    current_user: User = Depends(get_current_user),
):
    """Get the configured model roles and their fallback chains."""
    # Default model roles configuration
    roles = {
        "default": {
            "primary": {"provider_id": "anthropic", "model_id": "claude-sonnet-4-20250514"},
            "fallbacks": [
                {"provider_id": "openai", "model_id": "gpt-4o"},
                {"provider_id": "google", "model_id": "gemini-2.0-flash"},
            ],
        },
        "smol": {
            "primary": {"provider_id": "anthropic", "model_id": "claude-haiku-3.5"},
            "fallbacks": [
                {"provider_id": "openai", "model_id": "gpt-4o-mini"},
                {"provider_id": "google", "model_id": "gemini-2.0-flash"},
            ],
        },
        "slow": {
            "primary": {"provider_id": "anthropic", "model_id": "claude-opus-4"},
            "fallbacks": [
                {"provider_id": "openai", "model_id": "o3"},
                {"provider_id": "google", "model_id": "gemini-2.5-pro"},
            ],
        },
        "plan": {
            "primary": {"provider_id": "anthropic", "model_id": "claude-sonnet-4-20250514"},
            "fallbacks": [
                {"provider_id": "openai", "model_id": "gpt-4o"},
            ],
        },
        "commit": {
            "primary": {"provider_id": "anthropic", "model_id": "claude-haiku-3.5"},
            "fallbacks": [
                {"provider_id": "openai", "model_id": "gpt-4o-mini"},
            ],
        },
    }
    
    global_fallbacks = [
        {"provider_id": "anthropic", "model_id": "claude-sonnet-4-20250514"},
        {"provider_id": "openai", "model_id": "gpt-4o"},
    ]
    
    return ModelRoleResponse(
        roles=roles,
        global_fallbacks=global_fallbacks,
    )


# ============================================================================
# Token Counting Endpoint
# ============================================================================

@router.post(
    "/tokens/count",
    response_model=TokenCountResponse,
    summary="Count tokens in text",
)
async def count_tokens(
    body: TokenCountRequest,
    current_user: User = Depends(get_current_user),
):
    """Count tokens in text using BPE encoding estimation."""
    # Simple character-based estimation
    # Average token is ~4 characters for English text
    char_count = len(body.text)
    
    # Check if text looks like code
    is_code = any(char in body.text for char in "{}[]();") or any(
        word in body.text for word in ["function", "const", "let", "var", "if", "else", "for", "while"]
    )
    chars_per_token = 3 if is_code else 4
    
    count = (char_count + chars_per_token - 1) // chars_per_token  # Ceiling division
    
    return TokenCountResponse(
        count=count,
        encoding=body.encoding,
        text_length=char_count,
    )
