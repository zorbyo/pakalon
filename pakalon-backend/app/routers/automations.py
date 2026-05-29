"""Automation workflows, connectors, cron jobs, and logs."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import get_current_user
from app.models.automation import Automation
from app.models.automation_connector import AutomationConnector
from app.models.automation_execution import AutomationExecution
from app.models.automation_log import AutomationLog
from app.models.automation_version import AutomationVersion
from app.models.user import User
from app.services.model_registry import get_models_for_plan, pick_auto_model
from app.schemas.automations import (
    AuditLogListResponse,
    AuditLogResponse,
    AutomationCreateRequest,
    AutomationExecutionListResponse,
    AutomationExecutionResponse,
    AutomationListResponse,
    AutomationLogsListResponse,
    AutomationNodeLogsListResponse,
    AutomationNodeLogResponse,
    AutomationLogResponse,
    AutomationTemplateResponse,
    AutomationTemplateDetailResponse,
    AutomationResponse,
    AutomationRunResponse,
    AutomationTemplateListResponse,
    AutomationUpdateRequest,
    AutomationVersionResponse,
    AutomationVersionsListResponse,
    ConnectorCatalogResponse,
    ConnectorToggleRequest,
    CronJobResponse,
    CronJobsListResponse,
    InboxCountsResponse,
    InboxItemResponse,
    InboxListResponse,
    MemoryGetResponse,
    MemoryListResponse,
    MemorySetRequest,
    OAuthStartResponse,
    RateLimitStatusResponse,
    SkillCreateRequest,
    SkillListResponse,
    SkillResponse,
    TriggerScheduleCreateRequest,
    TriggerScheduleListResponse,
    TriggerScheduleResponse,
    WebhookTriggerResponse,
    WorkflowSaveRequest,
    WorkflowTemplateUseRequest,
)
from app.services import automation_executor
import app.services.automations as automation_svc
from app.services.supabase_cache import call_edge_function



logger = logging.getLogger(__name__)
router = APIRouter(prefix="/automations", tags=["automations"])


async def _get_owned_automation(
    automation_id: str, current_user: User, session: AsyncSession
) -> Automation:
    automation = await session.get(Automation, automation_id)
    if automation is None or automation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Automation not found")
    return automation


@router.get(
    "", response_model=AutomationListResponse, summary="List automations and starter templates"
)
async def list_automations(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationListResponse:
    automations = await automation_svc.list_automations_for_user(current_user.id, session)
    connectors = await automation_svc.list_connectors_for_user(current_user.id, session)
    connected_providers = {connector.provider for connector in connectors if connector.enabled}

    def _base_payload(a: Automation) -> dict[str, Any]:
        return AutomationResponse.model_validate(a).model_dump(exclude={"missing_connectors"})

    return AutomationListResponse(
        automations=[
            AutomationResponse(
                **_base_payload(automation),
                missing_connectors=[
                    provider
                    for provider in (automation.required_connectors or [])
                    if provider not in connected_providers
                ],
            )
            for automation in automations
        ],
        templates=[AutomationTemplateResponse.model_validate(t) for t in automation_svc.get_templates()],
    )


@router.post(
    "",
    response_model=AutomationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new automation workflow",
)
async def create_automation(
    body: AutomationCreateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    models_for_plan = await get_models_for_plan(current_user.plan, session)
    available_model_ids = {
        model_id
        for model_id in (
            (item.get("id") or item.get("model_id") or item.get("name")) for item in models_for_plan
        )
        if isinstance(model_id, str) and model_id
    }

    selected_model_id = body.model_id
    if not selected_model_id:
        auto_model = pick_auto_model(current_user.plan, models_for_plan)
        if auto_model:
            candidate = auto_model.get("id") or auto_model.get("model_id") or auto_model.get("name")
            if isinstance(candidate, str) and candidate:
                selected_model_id = candidate

    if selected_model_id and current_user.plan == "free" and not selected_model_id.endswith(":free"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Free plan users can only select models ending with :free",
        )

    if selected_model_id and available_model_ids and selected_model_id not in available_model_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Model '{selected_model_id}' is not available for your plan",
        )

    automation = await automation_svc.create_automation(
        user_id=current_user.id,
        name=body.name,
        prompt=body.prompt,
        model_id=selected_model_id,
        required_connectors_override=body.required_connectors,
        schedule_cron=body.schedule_cron,
        schedule_timezone=body.schedule_timezone,
        template_key=body.template_key,
        session=session,
    )
    if not body.template_key:
        try:
            workflow = await automation_svc.generate_workflow_from_prompt(
                prompt=body.prompt,
                automation_name=body.name,
                schedule_cron=body.schedule_cron or automation.schedule_cron,
                required_connectors=body.required_connectors or automation.required_connectors,
            )
            if workflow and workflow.get("nodes"):
                automation.workflow_json = workflow
                automation.is_visual = True
                await session.flush()
        except Exception:
            pass  # Fall back to inferred config
    connectors = await automation_svc.list_connectors_for_user(current_user.id, session)
    connected_providers = {connector.provider for connector in connectors if connector.enabled}
    base_payload = AutomationResponse.model_validate(automation).model_dump(
        exclude={"missing_connectors"}
    )
    return AutomationResponse(
        **base_payload,
        missing_connectors=[
            provider
            for provider in (automation.required_connectors or [])
            if provider not in connected_providers
        ],
    )


@router.get(
    "/connectors/{provider}/resources",
    summary="List available resources for a connected provider (repos, channels, pages)",
)
async def list_connector_resources(
    provider: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await session.execute(
        select(AutomationConnector).where(
            AutomationConnector.user_id == current_user.id,
            AutomationConnector.provider == provider,
            AutomationConnector.enabled.is_(True),
        )
    )
    connector = row.scalar_one_or_none()
    if not connector or connector.connection_status != "connected":
        raise HTTPException(status_code=404, detail=f"{provider} is not connected")

    resources = await automation_svc.get_connector_resources(
        provider=provider,
        user_id=current_user.id,
        connector=connector,
    )
    return {"provider": provider, "resources": resources}


@router.patch(
    "/{automation_id}",
    response_model=AutomationResponse,
    summary="Update automation enabled state or schedule",
)
async def update_automation(
    automation_id: str,
    body: AutomationUpdateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)
    await automation_svc.update_automation(
        automation,
        enabled=body.enabled,
        schedule_cron=body.schedule_cron,
        schedule_timezone=body.schedule_timezone,
    )
    return AutomationResponse.model_validate(automation)


@router.delete(
    "/{automation_id}", response_model=AutomationRunResponse, summary="Delete an automation"
)
async def delete_automation(
    automation_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationRunResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)
    await automation_svc.delete_automation(automation, session)
    return AutomationRunResponse(
        queued=True, automation_id=automation_id, message="Automation deleted"
    )


@router.post(
    "/{automation_id}/run",
    response_model=AutomationRunResponse,
    summary="Run an automation immediately",
)
async def run_automation_now(
    automation_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationRunResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)
    await automation_svc.run_automation_job(automation.id, trigger_type="manual")
    return AutomationRunResponse(
        queued=True, automation_id=automation.id, message="Automation run completed"
    )


@router.get(
    "/connectors",
    response_model=ConnectorCatalogResponse,
    summary="List connected apps and available connector catalog",
)
async def list_connectors(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ConnectorCatalogResponse:
    payload = await automation_svc.build_connector_view(current_user.id, session)
    return ConnectorCatalogResponse.model_validate(payload)


@router.post(
    "/connectors/{provider}/oauth/start",
    response_model=OAuthStartResponse,
    summary="Start OAuth flow for a connector",
)
async def start_connector_oauth(
    provider: str,
    current_user: User = Depends(get_current_user),
    _: AsyncSession = Depends(get_session),
) -> OAuthStartResponse:
    try:
        meta = automation_svc._get_provider_meta(provider)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not meta["oauth_supported"]:
        raise HTTPException(status_code=400, detail=f"OAuth is not yet available for {provider}")

    state_token = uuid.uuid4().hex
    await call_edge_function(
        "automation-oauth-state",
        {"user_id": current_user.id, "provider": provider, "state": state_token},
    )
    auth_url = await automation_svc.build_oauth_url(provider, current_user.id, state_token)
    return OAuthStartResponse(provider=provider, auth_url=auth_url)


@router.post(
    "/connectors/{provider}/toggle",
    response_model=ConnectorCatalogResponse,
    summary="Enable or disable a connector",
)
async def toggle_connector(
    provider: str,
    body: ConnectorToggleRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ConnectorCatalogResponse:
    row = await session.execute(
        select(AutomationConnector).where(
            AutomationConnector.user_id == current_user.id,
            AutomationConnector.provider == provider,
        )
    )
    connector = row.scalar_one_or_none()
    if connector is None:
        raise HTTPException(status_code=404, detail="Connector not found")
    await automation_svc.toggle_connector(connector, body.enabled)
    payload = await automation_svc.build_connector_view(current_user.id, session)
    return ConnectorCatalogResponse.model_validate(payload)


@router.get("/oauth/{provider}/callback", include_in_schema=False)
async def connector_oauth_callback(
    provider: str,
    code: str = Query(...),
    state: str = Query(...),
    session: AsyncSession = Depends(get_session),
):
    payload = await call_edge_function("automation-oauth-state-lookup", {"state": state})
    if payload is None:
        raise HTTPException(status_code=400, detail="OAuth state is invalid or expired")

    if payload.get("provider") != provider:
        raise HTTPException(status_code=400, detail="OAuth provider mismatch")

    token_payload = await automation_svc.exchange_oauth_code(provider, code)
    await automation_svc.upsert_connector(
        user_id=payload["user_id"],
        provider=provider,
        token_payload=token_payload,
        session=session,
    )

    from app.config import get_settings  # noqa: PLC0415

    redirect_url = (
        f"{get_settings().frontend_url.rstrip('/')}/dashboard/automations/connectors"
        f"?oauth=success&provider={provider}"
    )
    return RedirectResponse(url=redirect_url, status_code=302)


@router.get("/cron-jobs", response_model=CronJobsListResponse, summary="List automation cron jobs")
async def list_cron_jobs(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CronJobsListResponse:
    automations = await automation_svc.list_automations_for_user(current_user.id, session)
    cron_jobs = []
    for automation in automations:
        if not automation.schedule_cron:
            continue
        job = automation_svc.scheduler.get_job(f"automation:{automation.id}")
        cron_jobs.append(
            CronJobResponse(
                automation_id=automation.id,
                automation_name=automation.name,
                schedule_cron=automation.schedule_cron,
                schedule_timezone=automation.schedule_timezone,
                enabled=automation.enabled,
                next_run_at=job.next_run_time if job else None,
                last_run_at=automation.last_run_at,
                last_status=automation.last_status,
            )
        )
    return CronJobsListResponse(cron_jobs=cron_jobs)


@router.get(
    "/logs", response_model=AutomationLogsListResponse, summary="List automation execution logs"
)
async def list_automation_logs(
    automation_id: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationLogsListResponse:
    query = select(AutomationLog).where(AutomationLog.user_id == current_user.id)
    if automation_id:
        query = query.where(AutomationLog.automation_id == automation_id)
    query = query.order_by(AutomationLog.started_at.desc()).limit(200)
    rows = await session.execute(query)
    return AutomationLogsListResponse(logs=[AutomationLogResponse.model_validate(log) for log in rows.scalars()])


# ---------------------------------------------------------------------------
# Visual Workflow Editor Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/{automation_id}/workflow",
    response_model=AutomationResponse,
    summary="Get workflow with full JSON definition",
)
async def get_workflow(
    automation_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)
    return AutomationResponse.model_validate(automation)


@router.put(
    "/{automation_id}/workflow",
    response_model=AutomationResponse,
    summary="Save workflow from visual editor",
)
async def save_workflow(
    automation_id: str,
    body: WorkflowSaveRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)

    # Save current version before updating
    if automation.workflow_json:
        max_version = automation.workflow_version
        version = AutomationVersion(
            automation_id=automation.id,
            version=max_version,
            workflow_json=automation.workflow_json,
            change_summary=body.change_summary or "Auto-saved before update",
            created_by=current_user.id,
        )
        session.add(version)

    # Update workflow
    workflow_data = body.workflow_json.model_dump()
    automation.workflow_json = workflow_data
    automation.workflow_version = (automation.workflow_version or 1) + 1
    automation.is_visual = True

    if body.name is not None:
        automation.name = body.name
    if body.description is not None:
        automation.description = body.description
    if body.trigger_type is not None:
        automation.trigger_type = body.trigger_type
    if body.trigger_config is not None:
        automation.trigger_config = body.trigger_config
    if body.required_connectors is not None:
        automation.required_connectors = body.required_connectors

    automation.updated_at = automation_svc._now()

    # Infer required connectors from nodes
    nodes = workflow_data.get("nodes", [])
    inferred_connectors = set(automation.required_connectors or [])
    for node in nodes:
        node_type = node.get("type", "")
        if "slack" in node_type:
            inferred_connectors.add("slack")
        if "github" in node_type:
            inferred_connectors.add("github")
    automation.required_connectors = sorted(inferred_connectors)

    await session.flush()
    return AutomationResponse.model_validate(automation)


@router.post(
    "/{automation_id}/workflow/auto-save",
    response_model=AutomationResponse,
    summary="Auto-save workflow from visual editor",
)
async def auto_save_workflow(
    automation_id: str,
    body: WorkflowSaveRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)

    workflow_data = body.workflow_json.model_dump()
    automation.workflow_json = workflow_data
    automation.is_visual = True

    if body.name is not None:
        automation.name = body.name
    if body.description is not None:
        automation.description = body.description

    automation.updated_at = automation_svc._now()
    await session.flush()
    return AutomationResponse.model_validate(automation)


# ---------------------------------------------------------------------------
# Execution Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/{automation_id}/executions",
    response_model=AutomationExecutionListResponse,
    summary="List workflow executions",
)
async def list_executions(
    automation_id: str,
    limit: int = Query(default=50, le=200),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationExecutionListResponse:
    await _get_owned_automation(automation_id, current_user, session)
    executions = await automation_executor.list_executions(
        automation_id, current_user.id, session, limit
    )
    return AutomationExecutionListResponse(
        executions=[AutomationExecutionResponse.model_validate(e) for e in executions]
    )


@router.get(
    "/{automation_id}/executions/{execution_id}",
    response_model=AutomationExecutionResponse,
    summary="Get execution details",
)
async def get_execution(
    automation_id: str,
    execution_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationExecutionResponse:
    await _get_owned_automation(automation_id, current_user, session)
    execution = await automation_executor.get_execution(execution_id, current_user.id, session)
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    return AutomationExecutionResponse.model_validate(execution)


@router.get(
    "/executions/{execution_id}/node-logs",
    response_model=AutomationNodeLogsListResponse,
    summary="Get node-level logs for an execution",
)
async def get_execution_node_logs(
    execution_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationNodeLogsListResponse:
    # Verify the execution belongs to the user
    row = await session.execute(
        select(AutomationExecution).where(
            AutomationExecution.id == execution_id,
            AutomationExecution.user_id == current_user.id,
        )
    )
    execution = row.scalar_one_or_none()
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found")

    node_logs = await automation_executor.get_node_logs(execution_id, session)
    return AutomationNodeLogsListResponse(
        node_logs=[AutomationNodeLogResponse.model_validate(nl) for nl in node_logs]
    )


# ---------------------------------------------------------------------------
# Version Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/{automation_id}/versions",
    response_model=AutomationVersionsListResponse,
    summary="List workflow versions",
)
async def list_versions(
    automation_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationVersionsListResponse:
    await _get_owned_automation(automation_id, current_user, session)
    rows = await session.execute(
        select(AutomationVersion)
        .where(AutomationVersion.automation_id == automation_id)
        .order_by(AutomationVersion.version.desc())
    )
    versions = list(rows.scalars())
    return AutomationVersionsListResponse(
        versions=[AutomationVersionResponse.model_validate(v) for v in versions]
    )


@router.post(
    "/{automation_id}/versions/{version}/rollback",
    response_model=AutomationResponse,
    summary="Rollback to a previous version",
)
async def rollback_version(
    automation_id: str,
    version: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)

    row = await session.execute(
        select(AutomationVersion).where(
            AutomationVersion.automation_id == automation_id,
            AutomationVersion.version == version,
        )
    )
    version_row = row.scalar_one_or_none()
    if version_row is None:
        raise HTTPException(status_code=404, detail="Version not found")

    # Save current state as a new version first
    if automation.workflow_json:
        current_version = AutomationVersion(
            automation_id=automation.id,
            version=automation.workflow_version,
            workflow_json=automation.workflow_json,
            change_summary=f"Auto-saved before rollback to v{version}",
            created_by=current_user.id,
        )
        session.add(current_version)

    automation.workflow_json = version_row.workflow_json
    automation.workflow_version = version_row.version
    automation.updated_at = automation_svc._now()
    await session.flush()
    return AutomationResponse.model_validate(automation)


# ---------------------------------------------------------------------------
# Webhook Trigger Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/webhooks/{webhook_id}",
    response_model=WebhookTriggerResponse,
    summary="Trigger workflow via webhook (no auth required)",
)
async def webhook_trigger(
    webhook_id: str,
    body: dict[str, Any] = Body(default={}),
    session: AsyncSession = Depends(get_session),
) -> WebhookTriggerResponse:
    row = await session.execute(select(Automation).where(Automation.webhook_id == webhook_id))
    automation = row.scalar_one_or_none()
    if automation is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    if not automation.enabled:
        raise HTTPException(status_code=400, detail="Automation is disabled")

    try:
        execution = await automation_executor.execute_workflow(
            automation_id=automation.id,
            trigger_type="webhook",
            trigger_data=body,
        )
        return WebhookTriggerResponse(
            received=True,
            automation_id=automation.id,
            execution_id=execution.id,
            message="Webhook triggered successfully",
        )
    except Exception as exc:
        logger.exception("Webhook trigger failed for %s", webhook_id)
        return WebhookTriggerResponse(
            received=True,
            automation_id=automation.id,
            message=f"Trigger received but execution failed: {exc}",
        )


@router.get("/{automation_id}/webhook-url", summary="Get or generate webhook URL for an automation")
async def get_webhook_url(
    automation_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    automation = await _get_owned_automation(automation_id, current_user, session)

    if not automation.webhook_id:
        automation.webhook_id = uuid.uuid4().hex[:24]
        automation.trigger_type = "webhook"
        await session.flush()

    from app.config import get_settings  # noqa: PLC0415

    settings = get_settings()
    webhook_url = (
        f"{settings.backend_public_url.rstrip('/')}/automations/webhooks/{automation.webhook_id}"
    )
    return {"webhook_id": automation.webhook_id, "webhook_url": webhook_url}


# ---------------------------------------------------------------------------
# Template Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/templates",
    response_model=AutomationTemplateListResponse,
    summary="List all available workflow templates",
)
async def list_templates() -> AutomationTemplateListResponse:
    templates = automation_svc.get_template_details()
    return AutomationTemplateListResponse(
        templates=[AutomationTemplateDetailResponse.model_validate(template) for template in templates]
    )


@router.post(
    "/templates/{template_key}/use",
    response_model=AutomationResponse,
    summary="Create a workflow from a template",
)
async def use_template(
    template_key: str,
    body: WorkflowTemplateUseRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    template = automation_svc.get_template_by_key(template_key)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    automation = Automation(
        user_id=current_user.id,
        name=body.name,
        description=template.get("description", ""),
        prompt=template.get("prompt_hint", ""),
        template_key=template_key,
        workflow_json=template.get("workflow_json"),
        is_visual=True,
        required_connectors=template.get("recommended_connectors", []),
        schedule_cron=template.get("default_cron"),
        enabled=False,
        last_status="draft",
    )
    session.add(automation)
    await session.flush()
    return AutomationResponse.model_validate(automation)


# ---------------------------------------------------------------------------
# Import / Export Endpoints
# ---------------------------------------------------------------------------


@router.get("/{automation_id}/export", summary="Export workflow as JSON")
async def export_workflow(
    automation_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)
    export_data = {
        "name": automation.name,
        "description": automation.description,
        "model_id": automation.model_id,
        "trigger_type": automation.trigger_type,
        "trigger_config": automation.trigger_config,
        "workflow_json": automation.workflow_json,
        "required_connectors": automation.required_connectors,
        "schedule_cron": automation.schedule_cron,
        "schedule_timezone": automation.schedule_timezone,
        "exported_at": automation_svc._now().isoformat(),
        "version": automation.workflow_version,
    }
    return JSONResponse(content=export_data)


@router.post(
    "/import",
    response_model=AutomationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Import workflow from JSON",
)
async def import_workflow(
    body: dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    automation = Automation(
        user_id=current_user.id,
        name=body.get("name", "Imported Workflow"),
        description=body.get("description"),
        prompt=body.get("description", "Imported workflow"),
        model_id=body.get("model_id"),
        workflow_json=body.get("workflow_json"),
        is_visual=True,
        trigger_type=body.get("trigger_type", "manual"),
        trigger_config=body.get("trigger_config"),
        required_connectors=body.get("required_connectors", []),
        schedule_cron=body.get("schedule_cron"),
        schedule_timezone=body.get("schedule_timezone", "UTC"),
        enabled=False,
        last_status="draft",
    )
    session.add(automation)
    await session.flush()
    return AutomationResponse.model_validate(automation)


# ---------------------------------------------------------------------------
# Enhanced Run Endpoint (uses execution engine for visual workflows)
# ---------------------------------------------------------------------------


@router.post(
    "/{automation_id}/execute",
    response_model=AutomationExecutionResponse,
    summary="Execute a visual workflow and return execution details",
)
async def execute_visual_workflow(
    automation_id: str,
    trigger_data: dict[str, Any] = Body(default={}),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AutomationExecutionResponse:
    automation = await _get_owned_automation(automation_id, current_user, session)

    # Check rate limits
    from app.services.automation_audit_svc import rate_limiter  # noqa: PLC0415

    user_allowed, _ = rate_limiter.check_user_limit(current_user.id)
    if not user_allowed:
        raise HTTPException(
            status_code=429, detail="User rate limit exceeded (60 executions/minute)"
        )

    auto_allowed, _ = rate_limiter.check_automation_limit(automation.id)
    if not auto_allowed:
        raise HTTPException(
            status_code=429, detail="Automation rate limit exceeded (30 executions/minute)"
        )

    execution = await automation_executor.execute_workflow(
        automation_id=automation.id,
        trigger_type="manual",
        trigger_data=trigger_data,
    )

    # Log audit trail
    from app.services.automation_audit_svc import log_action  # noqa: PLC0415

    await log_action(
        user_id=current_user.id,
        action="workflow.executed",
        resource_type="automation",
        automation_id=automation.id,
        execution_id=execution.id,
        session=session,
    )

    # Create inbox item for failed executions
    if execution.status == "failed":
        from app.services.automation_inbox_svc import create_inbox_item  # noqa: PLC0415

        await create_inbox_item(
            user_id=current_user.id,
            automation_id=automation.id,
            execution_id=execution.id,
            title=f"Workflow '{automation.name}' failed",
            body=execution.error_message,
            severity="error",
            category="execution_error",
            result_data=execution.execution_data or {},
            session=session,
        )

    return AutomationExecutionResponse.model_validate(execution)


# ---------------------------------------------------------------------------
# Trigger.dev Webhook Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/triggerdev/callback", summary="Receive Trigger.dev scheduled task callbacks (no auth)"
)
async def trigger_dev_callback(
    body: dict[str, Any] = Body(default={}),
) -> dict[str, Any]:
    """Handle incoming webhook from Trigger.dev when a scheduled task fires.

    Trigger.dev sends a POST with the original payload when the cron fires.
    We extract the automation_id and execute the workflow.
    """
    from app.services.scheduler_manager import automation_scheduler  # noqa: PLC0415

    result = await automation_scheduler.handle_trigger_dev_callback(body)
    return result


@router.get("/scheduler/status", summary="Get scheduler backend status and health")
async def scheduler_status(
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Return information about which scheduler backend is active and its health."""
    from app.services.scheduler_manager import automation_scheduler  # noqa: PLC0415
    from app.services.trigger_dev import trigger_dev  # noqa: PLC0415

    status = automation_scheduler.health()

    if automation_scheduler.using_trigger_dev:
        status["triggerdev_health"] = await trigger_dev.health_check()

    return status


# ---------------------------------------------------------------------------
# Agent Memory Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/{automation_id}/memory",
    response_model=MemoryListResponse,
    summary="List all memory entries for a workflow",
)
async def list_memory(
    automation_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MemoryListResponse:
    await _get_owned_automation(automation_id, current_user, session)
    from app.services import automation_memory_svc  # noqa: PLC0415

    entries = await automation_memory_svc.list_memory(automation_id, session)
    return MemoryListResponse(
        entries=[
            {
                "key": e.memory_key,
                "value": e.memory_value,
                "value_type": e.value_type,
                "access_count": e.access_count,
                "last_accessed_at": e.last_accessed_at,
                "updated_at": e.updated_at,
            }
            for e in entries
        ]
    )


@router.get(
    "/{automation_id}/memory/{key}",
    response_model=MemoryGetResponse,
    summary="Get a specific memory entry",
)
async def get_memory(
    automation_id: str,
    key: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MemoryGetResponse:
    await _get_owned_automation(automation_id, current_user, session)
    from app.services import automation_memory_svc  # noqa: PLC0415

    value = await automation_memory_svc.get_memory(automation_id, key, session)
    return MemoryGetResponse(key=key, value=value, found=value is not None)


@router.put("/{automation_id}/memory", summary="Set a memory entry for a workflow")
async def set_memory(
    automation_id: str,
    body: MemorySetRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await _get_owned_automation(automation_id, current_user, session)
    from app.services import automation_memory_svc  # noqa: PLC0415

    memory = await automation_memory_svc.set_memory(
        automation_id=automation_id,
        user_id=current_user.id,
        key=body.key,
        value=body.value,
        session=session,
        value_type=body.value_type,
        expires_in_seconds=body.expires_in_seconds,
    )
    return {"key": memory.memory_key, "value": memory.memory_value, "updated": True}


@router.delete("/{automation_id}/memory/{key}", summary="Delete a memory entry")
async def delete_memory(
    automation_id: str,
    key: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await _get_owned_automation(automation_id, current_user, session)
    from app.services import automation_memory_svc  # noqa: PLC0415

    deleted = await automation_memory_svc.delete_memory(automation_id, key, session)
    return {"key": key, "deleted": deleted}


@router.post("/{automation_id}/memory/clear", summary="Clear all memory for a workflow")
async def clear_memory(
    automation_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await _get_owned_automation(automation_id, current_user, session)
    from app.services import automation_memory_svc  # noqa: PLC0415

    count = await automation_memory_svc.clear_memory(automation_id, session)
    return {"cleared": count}


# ---------------------------------------------------------------------------
# Inbox Endpoints
# ---------------------------------------------------------------------------


@router.get("/inbox", response_model=InboxListResponse, summary="Get user's automation inbox")
async def get_inbox(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InboxListResponse:
    from app.services import automation_inbox_svc  # noqa: PLC0415

    items = await automation_inbox_svc.list_inbox(
        current_user.id, session, unread_only=unread_only, limit=limit, offset=offset
    )
    counts = await automation_inbox_svc.get_inbox_counts(current_user.id, session)
    return InboxListResponse(
        items=[InboxItemResponse.model_validate(item) for item in items],
        counts=counts,
    )


@router.get("/inbox/counts", response_model=InboxCountsResponse, summary="Get inbox counts")
async def get_inbox_counts(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InboxCountsResponse:
    from app.services import automation_inbox_svc  # noqa: PLC0415

    counts = await automation_inbox_svc.get_inbox_counts(current_user.id, session)
    return InboxCountsResponse(**counts)


@router.post("/inbox/{item_id}/read", summary="Mark inbox item as read")
async def mark_inbox_read(
    item_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from app.services import automation_inbox_svc  # noqa: PLC0415

    result = await automation_inbox_svc.mark_read(item_id, current_user.id, session)
    return {"marked": result}


@router.post("/inbox/read-all", summary="Mark all inbox items as read")
async def mark_all_inbox_read(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from app.services import automation_inbox_svc  # noqa: PLC0415

    count = await automation_inbox_svc.mark_all_read(current_user.id, session)
    return {"marked_count": count}


@router.post("/inbox/{item_id}/archive", summary="Archive inbox item")
async def archive_inbox_item(
    item_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from app.services import automation_inbox_svc  # noqa: PLC0415

    result = await automation_inbox_svc.archive_item(item_id, current_user.id, session)
    return {"archived": result}


@router.post("/inbox/{item_id}/star", summary="Toggle star on inbox item")
async def star_inbox_item(
    item_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from app.services import automation_inbox_svc  # noqa: PLC0415

    starred = await automation_inbox_svc.toggle_star(item_id, current_user.id, session)
    return {"starred": starred}


# ---------------------------------------------------------------------------
# Skills Endpoints
# ---------------------------------------------------------------------------


@router.get("/skills", response_model=SkillListResponse, summary="List available automation skills")
async def list_skills(
    category: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SkillListResponse:
    from app.services import automation_skills_svc  # noqa: PLC0415

    # Seed built-in skills on first access
    await automation_skills_svc.seed_builtin_skills(session)

    skills = await automation_skills_svc.list_skills(
        session, user_id=current_user.id, category=category
    )
    return SkillListResponse(skills=[SkillResponse.model_validate(s) for s in skills])


@router.get("/skills/{skill_id}", response_model=SkillResponse, summary="Get a specific skill")
async def get_skill(
    skill_id: str,
    session: AsyncSession = Depends(get_session),
) -> SkillResponse:
    from app.services import automation_skills_svc  # noqa: PLC0415

    skill = await automation_skills_svc.get_skill(skill_id, session)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return SkillResponse.model_validate(skill)


@router.post(
    "/skills",
    response_model=SkillResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom skill",
)
async def create_skill(
    body: SkillCreateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SkillResponse:
    from app.services import automation_skills_svc  # noqa: PLC0415

    skill = await automation_skills_svc.create_custom_skill(
        user_id=current_user.id,
        name=body.name,
        slug=body.slug,
        description=body.description,
        prompt_template=body.prompt_template,
        category=body.category,
        config_schema=body.config_schema,
        tags=body.tags,
        session=session,
    )
    return SkillResponse.model_validate(skill)


# ---------------------------------------------------------------------------
# Audit Log Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/audit-logs",
    response_model=AuditLogListResponse,
    summary="Get audit logs for user's automations",
)
async def get_audit_logs(
    automation_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AuditLogListResponse:
    from app.services import automation_audit_svc  # noqa: PLC0415

    logs = await automation_audit_svc.get_audit_logs(
        current_user.id,
        session,
        automation_id=automation_id,
        action=action,
        limit=limit,
        offset=offset,
    )
    return AuditLogListResponse(logs=[AuditLogResponse.model_validate(entry) for entry in logs])


# ---------------------------------------------------------------------------
# External Trigger Schedule Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/trigger-schedules",
    response_model=TriggerScheduleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an external trigger schedule",
)
async def create_trigger_schedule(
    body: TriggerScheduleCreateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TriggerScheduleResponse:
    await _get_owned_automation(body.automation_id, current_user, session)
    from app.models.automation_inbox import AutomationSchedule  # noqa: PLC0415

    schedule = AutomationSchedule(
        automation_id=body.automation_id,
        user_id=current_user.id,
        trigger_provider=body.trigger_provider,
        trigger_event=body.trigger_event,
        trigger_config=body.trigger_config,
    )
    session.add(schedule)
    await session.flush()
    return TriggerScheduleResponse.model_validate(schedule)


@router.get(
    "/trigger-schedules",
    response_model=TriggerScheduleListResponse,
    summary="List trigger schedules",
)
async def list_trigger_schedules(
    automation_id: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TriggerScheduleListResponse:
    from app.models.automation_inbox import AutomationSchedule  # noqa: PLC0415

    query = select(AutomationSchedule).where(AutomationSchedule.user_id == current_user.id)
    if automation_id:
        query = query.where(AutomationSchedule.automation_id == automation_id)
    rows = await session.execute(query.order_by(AutomationSchedule.created_at.desc()))
    schedules = list(rows.scalars())
    return TriggerScheduleListResponse(
        schedules=[TriggerScheduleResponse.model_validate(s) for s in schedules]
    )


@router.delete("/trigger-schedules/{schedule_id}", summary="Delete a trigger schedule")
async def delete_trigger_schedule(
    schedule_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from app.models.automation_inbox import AutomationSchedule  # noqa: PLC0415

    row = await session.execute(
        select(AutomationSchedule).where(
            AutomationSchedule.id == schedule_id,
            AutomationSchedule.user_id == current_user.id,
        )
    )
    schedule = row.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await session.delete(schedule)
    return {"deleted": True}


# ---------------------------------------------------------------------------
# GitHub Webhook Receiver (no auth — called by GitHub)
# ---------------------------------------------------------------------------


@router.post("/events/github", summary="Receive GitHub webhook events (no auth)")
async def github_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Receive GitHub webhook events and route to matching automations."""
    from app.services.automation_triggers_svc import handle_github_event, verify_github_signature  # noqa: PLC0415

    body = await request.body()
    event_type = request.headers.get("X-GitHub-Event", "")
    signature = request.headers.get("X-Hub-Signature-256")

    if not verify_github_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    action = payload.get("action")
    results = await handle_github_event(
        event_type=event_type, action=action, payload=payload, session=session
    )
    return {"received": True, "event": event_type, "triggered": results}


# ---------------------------------------------------------------------------
# Slack Webhook Receiver (no auth — called by Slack)
# ---------------------------------------------------------------------------


@router.post("/events/slack", summary="Receive Slack webhook events (no auth)")
async def slack_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Receive Slack Events API callbacks and route to matching automations."""
    from app.services.automation_triggers_svc import handle_slack_event  # noqa: PLC0415

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Handle Slack URL verification challenge
    if payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge", "")}

    event_type = payload.get("event", {}).get("type", "")
    event_data = payload.get("event", {})
    team_id = payload.get("team_id")

    results = await handle_slack_event(
        event_type=event_type,
        event_data=event_data,
        team_id=team_id,
        session=session,
    )
    return {"received": True, "event": event_type, "triggered": results}


# ---------------------------------------------------------------------------
# Generic Event Receiver (Linear, PagerDuty, Jira, etc.)
# ---------------------------------------------------------------------------


@router.post("/events/{provider}", summary="Receive events from external providers (no auth)")
async def generic_webhook(
    provider: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Receive webhooks from Linear, PagerDuty, Jira, or other providers."""
    from app.services.automation_triggers_svc import handle_generic_event  # noqa: PLC0415

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = (
        payload.get("type") or payload.get("event_type") or payload.get("webhookEvent") or "unknown"
    )

    results = await handle_generic_event(
        provider=provider,
        event_type=event_type,
        payload=payload,
        session=session,
    )
    return {"received": True, "provider": provider, "event": event_type, "triggered": results}


# ---------------------------------------------------------------------------
# Rate Limit Status
# ---------------------------------------------------------------------------


@router.get(
    "/rate-limit", response_model=RateLimitStatusResponse, summary="Get current rate limit status"
)
async def get_rate_limit_status(
    current_user: User = Depends(get_current_user),
) -> RateLimitStatusResponse:
    from app.services.automation_audit_svc import rate_limiter  # noqa: PLC0415

    usage = rate_limiter.get_usage(current_user.id)
    limit = 60
    remaining = max(0, limit - usage["current_minute_count"])
    return RateLimitStatusResponse(
        user_id=current_user.id,
        current_minute_count=usage["current_minute_count"],
        limit_per_minute=limit,
        remaining=remaining,
        window_start=usage["window_start"],
        window_size=usage["window_size"],
    )
