"""Pydantic schemas for automation workflows and OAuth connectors."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AutomationTemplateResponse(BaseModel):
    key: str
    name: str
    description: str
    recommended_connectors: list[str]
    default_cron: str
    prompt_hint: str


class AutomationCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    prompt: str = Field(..., min_length=5)
    model_id: str | None = Field(default=None, max_length=255)
    required_connectors: list[str] | None = None
    schedule_cron: str | None = Field(default=None, max_length=100)
    schedule_timezone: str = Field(default="UTC", max_length=64)
    template_key: str | None = Field(default=None, max_length=100)


class AutomationUpdateRequest(BaseModel):
    enabled: bool | None = None
    schedule_cron: str | None = Field(default=None, max_length=100)
    schedule_timezone: str | None = Field(default=None, max_length=64)


class ConnectorToggleRequest(BaseModel):
    enabled: bool


class OAuthStartResponse(BaseModel):
    provider: str
    auth_url: str


class AutomationConnectorResponse(BaseModel):
    provider: str
    display_name: str
    category: str
    logo_domain: str | None = None
    logo_url: str | None = None
    oauth_supported: bool
    enabled: bool = False
    connected: bool = False
    connection_status: str = "available"
    account_label: str | None = None
    scopes: list[str] = []
    coming_soon: bool = False


class AutomationResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    prompt: str
    model_id: str | None = None
    template_key: str | None = None
    inferred_config: dict[str, Any] = {}
    required_connectors: list[str] = []
    workflow_json: dict[str, Any] | None = None
    workflow_version: int = 1
    is_visual: bool = False
    schedule_cron: str | None = None
    schedule_timezone: str = "UTC"
    enabled: bool
    webhook_id: str | None = None
    trigger_type: str = "cron"
    trigger_config: dict[str, Any] | None = None
    last_run_at: datetime | None = None
    last_status: str | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime
    missing_connectors: list[str] = []

    model_config = {"from_attributes": True}


class AutomationListResponse(BaseModel):
    automations: list[AutomationResponse]
    templates: list[AutomationTemplateResponse]


class AutomationLogResponse(BaseModel):
    id: str
    automation_id: str
    trigger_type: str
    status: str
    summary: str | None = None
    details: dict[str, Any] = {}
    started_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class AutomationLogsListResponse(BaseModel):
    logs: list[AutomationLogResponse]


class CronJobResponse(BaseModel):
    automation_id: str
    automation_name: str
    schedule_cron: str
    schedule_timezone: str
    enabled: bool
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_status: str | None = None


class CronJobsListResponse(BaseModel):
    cron_jobs: list[CronJobResponse]


class ConnectorCatalogResponse(BaseModel):
    connected: list[AutomationConnectorResponse]
    available: list[AutomationConnectorResponse]


class AutomationRunResponse(BaseModel):
    queued: bool
    automation_id: str
    message: str


# ---------------------------------------------------------------------------
# Visual Workflow Editor Schemas
# ---------------------------------------------------------------------------


class WorkflowNode(BaseModel):
    id: str
    type: str
    position: dict[str, float] = {"x": 0, "y": 0}
    data: dict[str, Any] = {}


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    source_handle: str | None = None
    target_handle: str | None = None


class WorkflowJson(BaseModel):
    nodes: list[WorkflowNode] = []
    edges: list[WorkflowEdge] = []
    viewport: dict[str, Any] | None = None


class WorkflowSaveRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    workflow_json: WorkflowJson
    trigger_type: str | None = None
    trigger_config: dict[str, Any] | None = None
    required_connectors: list[str] | None = None
    change_summary: str | None = None


class WorkflowTemplateUseRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)


# ---------------------------------------------------------------------------
# Execution Schemas
# ---------------------------------------------------------------------------


class AutomationExecutionResponse(BaseModel):
    id: str
    automation_id: str
    user_id: str
    status: str
    trigger_type: str
    trigger_data: dict[str, Any] = {}
    execution_data: dict[str, Any] = {}
    workflow_snapshot: dict[str, Any] | None = None
    error_message: str | None = None
    duration_ms: int | None = None
    started_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class AutomationExecutionListResponse(BaseModel):
    executions: list[AutomationExecutionResponse]


class AutomationNodeLogResponse(BaseModel):
    id: str
    execution_id: str
    automation_id: str
    node_id: str
    node_name: str | None = None
    node_type: str
    status: str
    level: str
    message: str | None = None
    input_data: dict[str, Any] | None = None
    output_data: dict[str, Any] | None = None
    error_message: str | None = None
    retry_count: int = 0
    duration_ms: int | None = None
    sort_order: int = 0
    started_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class AutomationNodeLogsListResponse(BaseModel):
    node_logs: list[AutomationNodeLogResponse]


# ---------------------------------------------------------------------------
# Version Schemas
# ---------------------------------------------------------------------------


class AutomationVersionResponse(BaseModel):
    id: str
    automation_id: str
    version: int
    workflow_json: dict[str, Any]
    change_summary: str | None = None
    created_by: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AutomationVersionsListResponse(BaseModel):
    versions: list[AutomationVersionResponse]


# ---------------------------------------------------------------------------
# Webhook Trigger Schemas
# ---------------------------------------------------------------------------


class WebhookTriggerResponse(BaseModel):
    received: bool
    automation_id: str
    execution_id: str | None = None
    message: str


# ---------------------------------------------------------------------------
# Template Schemas (Extended)
# ---------------------------------------------------------------------------


class AutomationTemplateDetailResponse(BaseModel):
    key: str
    name: str
    description: str
    category: str = "general"
    recommended_connectors: list[str] = []
    default_cron: str = ""
    prompt_hint: str = ""
    workflow_json: dict[str, Any] | None = None
    tags: list[str] = []


class AutomationTemplateListResponse(BaseModel):
    templates: list[AutomationTemplateDetailResponse]


# ---------------------------------------------------------------------------
# Agent Memory Schemas
# ---------------------------------------------------------------------------


class MemoryGetResponse(BaseModel):
    key: str
    value: dict[str, Any] | None = None
    found: bool
    access_count: int = 0
    updated_at: datetime | None = None


class MemorySetRequest(BaseModel):
    key: str = Field(..., min_length=1, max_length=255)
    value: dict[str, Any]
    value_type: str = Field(default="json", max_length=32)
    expires_in_seconds: int | None = None


class MemoryListResponse(BaseModel):
    entries: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Inbox Schemas
# ---------------------------------------------------------------------------


class InboxItemResponse(BaseModel):
    id: str
    automation_id: str
    execution_id: str | None = None
    title: str
    body: str | None = None
    severity: str
    category: str
    result_data: dict[str, Any] = {}
    action_url: str | None = None
    is_read: bool
    is_archived: bool
    is_starred: bool
    created_at: datetime
    read_at: datetime | None = None

    model_config = {"from_attributes": True}


class InboxListResponse(BaseModel):
    items: list[InboxItemResponse]
    counts: dict[str, int] = {}


class InboxCountsResponse(BaseModel):
    total: int
    unread: int
    starred: int


# ---------------------------------------------------------------------------
# Skill Schemas
# ---------------------------------------------------------------------------


class SkillResponse(BaseModel):
    id: str
    name: str
    slug: str
    description: str
    category: str
    icon: str
    prompt_template: str
    config_schema: dict[str, Any] = {}
    node_type: str
    node_config: dict[str, Any] = {}
    required_connectors: list[str] = []
    is_builtin: bool
    is_public: bool
    version: int
    usage_count: int
    tags: list[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class SkillListResponse(BaseModel):
    skills: list[SkillResponse]


class SkillCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    slug: str = Field(..., min_length=2, max_length=100)
    description: str = Field(..., min_length=5)
    prompt_template: str = Field(..., min_length=10)
    category: str = Field(default="custom", max_length=50)
    config_schema: dict[str, Any] | None = None
    tags: list[str] = []


# ---------------------------------------------------------------------------
# Audit Log Schemas
# ---------------------------------------------------------------------------


class AuditLogResponse(BaseModel):
    id: str
    automation_id: str | None = None
    execution_id: str | None = None
    action: str
    resource_type: str
    resource_id: str | None = None
    details: dict[str, Any] = {}
    ip_address: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogListResponse(BaseModel):
    logs: list[AuditLogResponse]


# ---------------------------------------------------------------------------
# External Trigger Schedule Schemas
# ---------------------------------------------------------------------------


class TriggerScheduleCreateRequest(BaseModel):
    automation_id: str
    trigger_provider: str = Field(..., min_length=1, max_length=50)
    trigger_event: str = Field(..., min_length=1, max_length=100)
    trigger_config: dict[str, Any] = {}


class TriggerScheduleResponse(BaseModel):
    id: str
    automation_id: str
    trigger_provider: str
    trigger_event: str
    trigger_config: dict[str, Any] = {}
    is_active: bool
    last_triggered_at: datetime | None = None
    trigger_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class TriggerScheduleListResponse(BaseModel):
    schedules: list[TriggerScheduleResponse]


# ---------------------------------------------------------------------------
# Rate Limit Schemas
# ---------------------------------------------------------------------------


class RateLimitStatusResponse(BaseModel):
    user_id: str
    current_minute_count: int
    limit_per_minute: int
    remaining: int
    window_start: int
    window_size: int
