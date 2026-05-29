"""
Security API Router — Endpoints for security features.

Provides:
- Audit logging
- Permission management
- Rate limit monitoring
- Budget tracking
- Injection detection logs
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
import datetime

from ..dependencies import get_current_user, get_db

router = APIRouter(prefix="/security", tags=["security"])


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────

class AuditLogEntry(BaseModel):
    """Audit log entry."""
    id: str
    timestamp: datetime.datetime
    event_type: str
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    tool_name: Optional[str] = None
    action: str
    result: str
    details: Optional[dict] = None
    risk_level: str = "low"


class AuditLogResponse(BaseModel):
    """Audit log response."""
    entries: list[AuditLogEntry]
    total: int
    page: int
    page_size: int


class PermissionRuleResponse(BaseModel):
    """Permission rule."""
    id: str
    name: str
    tool_pattern: str
    action: str
    source: str
    scope: str
    priority: int
    enabled: bool
    rate_limit: Optional[int] = None
    budget_limit: Optional[int] = None


class RateLimitStatusResponse(BaseModel):
    """Rate limit status."""
    tool_name: str
    current: int
    max: int
    remaining: int
    reset_at: datetime.datetime


class BudgetStatusResponse(BaseModel):
    """Budget status."""
    session_id: str
    current_tokens: int
    max_tokens: int
    remaining: int
    percent_used: float
    reset_at: datetime.datetime


class InjectionDetectionResponse(BaseModel):
    """Injection detection result."""
    detected: bool
    matches: list[dict]
    overall_severity: str
    recommended_action: str
    sanitized_input: Optional[str] = None


class SecurityStatsResponse(BaseModel):
    """Security statistics."""
    total_audit_entries: int
    permission_denials: int
    injection_attempts: int
    rate_limit_hits: int
    budget_exceeded: int


# ─────────────────────────────────────────────────────────────────────────────
# Audit Logging Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/audit", response_model=AuditLogResponse)
async def get_audit_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    tool_name: Optional[str] = Query(None, description="Filter by tool name"),
    start_date: Optional[datetime.datetime] = Query(None),
    end_date: Optional[datetime.datetime] = Query(None),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Get audit log entries.
    
    Returns paginated audit log with optional filtering.
    """
    # TODO: Implement audit log retrieval from database
    return AuditLogResponse(
        entries=[],
        total=0,
        page=page,
        page_size=page_size,
    )


@router.post("/audit")
async def create_audit_entry(
    entry: AuditLogEntry,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Create a new audit log entry.
    """
    # TODO: Implement audit entry creation
    return {"created": True, "id": entry.id}


# ─────────────────────────────────────────────────────────────────────────────
# Permission Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/permissions", response_model=list[PermissionRuleResponse])
async def get_permission_rules(
    tool_name: Optional[str] = Query(None, description="Filter by tool name"),
    enabled_only: bool = Query(True),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Get permission rules.
    
    Returns list of permission rules, optionally filtered by tool.
    """
    # TODO: Implement permission rule retrieval
    return []


@router.post("/permissions")
async def create_permission_rule(
    rule: PermissionRuleResponse,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Create a new permission rule.
    """
    # TODO: Implement permission rule creation
    return {"created": True, "id": rule.id}


@router.put("/permissions/{rule_id}")
async def update_permission_rule(
    rule_id: str,
    rule: PermissionRuleResponse,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Update an existing permission rule.
    """
    # TODO: Implement permission rule update
    return {"updated": True}


@router.delete("/permissions/{rule_id}")
async def delete_permission_rule(
    rule_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Delete a permission rule.
    """
    # TODO: Implement permission rule deletion
    return {"deleted": True}


# ─────────────────────────────────────────────────────────────────────────────
# Rate Limit Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/rate-limits", response_model=list[RateLimitStatusResponse])
async def get_rate_limits(
    tool_name: Optional[str] = Query(None, description="Get limit for specific tool"),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Get current rate limit status.
    
    Returns current usage and limits for tools.
    """
    # TODO: Implement rate limit status retrieval
    return []


@router.post("/rate-limits/{tool_name}/reset")
async def reset_rate_limit(
    tool_name: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Reset rate limit for a tool.
    """
    # TODO: Implement rate limit reset
    return {"reset": True, "tool": tool_name}


# ─────────────────────────────────────────────────────────────────────────────
# Budget Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/budgets", response_model=list[BudgetStatusResponse])
async def get_budgets(
    session_id: Optional[str] = Query(None, description="Get budget for specific session"),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Get current budget status.
    
    Returns token usage and limits for sessions.
    """
    # TODO: Implement budget status retrieval
    return []


@router.post("/budgets/{session_id}/reset")
async def reset_budget(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Reset budget for a session.
    """
    # TODO: Implement budget reset
    return {"reset": True, "session": session_id}


# ─────────────────────────────────────────────────────────────────────────────
# Injection Detection Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/injection/check", response_model=InjectionDetectionResponse)
async def check_injection(
    input_text: str = Field(..., description="Input text to check"),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Check input for prompt injection attempts.
    """
    # TODO: Implement injection detection
    return InjectionDetectionResponse(
        detected=False,
        matches=[],
        overall_severity="low",
        recommended_action="allow",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Stats Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=SecurityStatsResponse)
async def get_security_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Get security statistics.
    
    Returns counts of various security events.
    """
    # TODO: Implement security stats collection
    return SecurityStatsResponse(
        total_audit_entries=0,
        permission_denials=0,
        injection_attempts=0,
        rate_limit_hits=0,
        budget_exceeded=0,
    )


# ─────────────────────────────────────────────────────────────────────────────
# SonarQube Analysis Endpoint
# ─────────────────────────────────────────────────────────────────────────────

class SonarAnalysisRequest(BaseModel):
    """Request for SonarQube analysis."""
    project_key: str
    project_name: str | None = None
    server_url: str = "http://localhost:9000"
    token: str | None = None
    sources: list[str] = Field(default=["."])
    exclusions: list[str] = Field(default=[])


class SonarIssue(BaseModel):
    """A SonarQube issue."""
    key: str
    rule: str
    severity: str
    type: str
    message: str
    component: str
    line: int | None = None
    status: str


class SonarMetrics(BaseModel):
    """SonarQube metrics."""
    lines: int = 0
    coverage: float = 0.0
    bugs: int = 0
    vulnerabilities: int = 0
    code_smells: int = 0
    duplications: float = 0.0
    maintainability_rating: str = "E"
    security_rating: str = "E"
    reliability_rating: str = "E"


class SonarAnalysisResponse(BaseModel):
    """Response from SonarQube analysis."""
    success: bool
    project_key: str
    issues: list[SonarIssue] = []
    metrics: SonarMetrics = SonarMetrics()
    quality_gate_status: str = "PASSED"
    duration_ms: int = 0
    error: str | None = None


@router.post(
    "/sonarqube/analyze",
    response_model=SonarAnalysisResponse,
    summary="Run SonarQube code analysis",
)
async def run_sonar_analysis(
    request: SonarAnalysisRequest,
    current_user: User = Depends(get_current_user),
) -> SonarAnalysisResponse:
    """
    Run SonarQube analysis on the project.

    Requires SonarQube Community Edition to be running.
    Returns issues, metrics, and quality gate status.
    """
    import time
    import httpx

    start_time = time.time()

    try:
        # Check if SonarQube is available
        async with httpx.AsyncClient(timeout=10.0) as client:
            ping_response = await client.get(f"{request.server_url}/api/system/ping")
            if ping_response.status_code != 200:
                return SonarAnalysisResponse(
                    success=False,
                    project_key=request.project_key,
                    error=f"SonarQube not available at {request.server_url}",
                    duration_ms=int((time.time() - start_time) * 1000),
                )

        # Get issues
        issues: list[SonarIssue] = []
        page = 1
        page_size = 100

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                params = {
                    "componentKeys": request.project_key,
                    "ps": str(page_size),
                    "p": str(page),
                    "resolved": "false",
                }
                headers = {}
                if request.token:
                    import base64
                    headers["Authorization"] = f"Basic {base64.b64encode(f'{request.token}:'.encode()).decode()}"

                response = await client.get(
                    f"{request.server_url}/api/issues/search",
                    params=params,
                    headers=headers,
                )

                if response.status_code != 200:
                    break

                data = response.json()
                for issue in data.get("issues", []):
                    issues.append(SonarIssue(
                        key=issue.get("key", ""),
                        rule=issue.get("rule", ""),
                        severity=issue.get("severity", "INFO"),
                        type=issue.get("type", "CODE_SMELL"),
                        message=issue.get("message", ""),
                        component=issue.get("component", ""),
                        line=issue.get("line"),
                        status=issue.get("status", "OPEN"),
                    ))

                if len(issues) >= data.get("total", 0) or len(data.get("issues", [])) == 0:
                    break
                page += 1

        # Get metrics
        metrics = SonarMetrics()
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {}
            if request.token:
                import base64
                headers["Authorization"] = f"Basic {base64.b64encode(f'{request.token}:'.encode()).decode()}"

            metric_keys = "lines,coverage,bugs,vulnerabilities,code_smells,duplicated_lines_density,maintainability_rating,security_rating,reliability_rating"
            response = await client.get(
                f"{request.server_url}/api/measures/component",
                params={"component": request.project_key, "metricKeys": metric_keys},
                headers=headers,
            )

            if response.status_code == 200:
                data = response.json()
                measures = data.get("component", {}).get("measures", [])
                measure_map = {m["metric"]: m.get("value", "0") for m in measures}

                metrics = SonarMetrics(
                    lines=int(measure_map.get("lines", "0")),
                    coverage=float(measure_map.get("coverage", "0")),
                    bugs=int(measure_map.get("bugs", "0")),
                    vulnerabilities=int(measure_map.get("vulnerabilities", "0")),
                    code_smells=int(measure_map.get("code_smells", "0")),
                    duplications=float(measure_map.get("duplicated_lines_density", "0")),
                    maintainability_rating=measure_map.get("maintainability_rating", "E"),
                    security_rating=measure_map.get("security_rating", "E"),
                    reliability_rating=measure_map.get("reliability_rating", "E"),
                )

        # Get quality gate status
        quality_gate_status = "PASSED"
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {}
            if request.token:
                import base64
                headers["Authorization"] = f"Basic {base64.b64encode(f'{request.token}:'.encode()).decode()}"

            response = await client.get(
                f"{request.server_url}/api/qualitygates/project_status",
                params={"projectKey": request.project_key},
                headers=headers,
            )

            if response.status_code == 200:
                data = response.json()
                status = data.get("projectStatus", {}).get("status", "OK")
                if status == "OK":
                    quality_gate_status = "PASSED"
                elif status == "ERROR":
                    quality_gate_status = "FAILED"
                else:
                    quality_gate_status = "WARN"

        duration_ms = int((time.time() - start_time) * 1000)

        return SonarAnalysisResponse(
            success=True,
            project_key=request.project_key,
            issues=issues,
            metrics=metrics,
            quality_gate_status=quality_gate_status,
            duration_ms=duration_ms,
        )

    except Exception as e:
        logger.error(f"SonarQube analysis failed: {e}")
        return SonarAnalysisResponse(
            success=False,
            project_key=request.project_key,
            error=str(e),
            duration_ms=int((time.time() - start_time) * 1000),
        )
