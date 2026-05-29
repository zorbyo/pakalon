"""Workflow execution engine - parses, orchestrates, and executes automation workflows."""

from __future__ import annotations

import logging
import time
import re
import base64
import hashlib
from datetime import datetime, timezone
from typing import Any, cast

import httpx
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.automation import Automation
from app.models.automation_connector import AutomationConnector
from app.models.automation_execution import AutomationExecution
from app.models.automation_node_log import AutomationNodeLog
logger = logging.getLogger(__name__)


ERROR_CATEGORIES: dict[str, str] = {
    "401": "auth_error",
    "403": "auth_error",
    "429": "rate_limit",
    "502": "api_error",
    "503": "api_error",
    "504": "timeout",
}


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    from app.config import get_settings  # noqa: PLC0415

    seed = (get_settings().jwt_secret or "pakalon-automation-default-secret").encode("utf-8")
    digest = hashlib.sha256(seed).digest()
    fernet = Fernet(base64.urlsafe_b64encode(digest))
    return fernet.decrypt(value.encode("utf-8")).decode("utf-8")


def _encrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    from app.config import get_settings  # noqa: PLC0415

    seed = (get_settings().jwt_secret or "pakalon-automation-default-secret").encode("utf-8")
    digest = hashlib.sha256(seed).digest()
    fernet = Fernet(base64.urlsafe_b64encode(digest))
    return fernet.encrypt(value.encode("utf-8")).decode("utf-8")


def _categorize_error(error: str) -> str:
    """Categorize an error message into a structured category."""
    error_lower = error.lower()
    if any(
        word in error_lower for word in ["unauthorized", "unauthorised", "401", "403", "token", "oauth", "invalid grant"]
    ):
        return "auth_error"
    if any(word in error_lower for word in ["rate limit", "429", "too many requests"]):
        return "rate_limit"
    if any(word in error_lower for word in ["timeout", "timed out", "504"]):
        return "timeout"
    if any(word in error_lower for word in ["502", "503", "service unavailable", "bad gateway"]):
        return "api_error"
    if any(word in error_lower for word in ["not found", "404", "not configured", "missing"]):
        return "config_error"
    return "unknown"


# ---------------------------------------------------------------------------
# Workflow Parser
# ---------------------------------------------------------------------------


class WorkflowParser:
    """Parses workflow JSON into an executable node queue."""

    def __init__(self, workflow_json: dict[str, Any]):
        self.nodes: dict[str, dict[str, Any]] = {}
        self.edges: list[dict[str, Any]] = []
        self.adjacency: dict[str, list[str]] = {}
        self._parse(workflow_json)

    def _parse(self, workflow_json: dict[str, Any]) -> None:
        raw_nodes = workflow_json.get("nodes", [])
        raw_edges = workflow_json.get("edges", [])

        for node in raw_nodes:
            node_id = node.get("id", "")
            self.nodes[node_id] = node

        for edge in raw_edges:
            source = edge.get("source", "")
            target = edge.get("target", "")
            self.edges.append(edge)
            self.adjacency.setdefault(source, []).append(target)

    def get_start_nodes(self) -> list[str]:
        """Return nodes with no incoming edges (triggers)."""
        targets = {e.get("target") for e in self.edges}
        return [nid for nid in self.nodes if nid not in targets]

    def get_children(self, node_id: str) -> list[str]:
        """Return nodes that follow the given node."""
        return self.adjacency.get(node_id, [])

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        return self.nodes.get(node_id)

    def build_execution_order(self, start_node_id: str | None = None) -> list[str]:
        """BFS-based execution order from triggers (or a specific start)."""
        if start_node_id:
            starts = [start_node_id]
        else:
            starts = self.get_start_nodes()
        if not starts:
            # Fallback: just use all nodes in position order
            sorted_nodes = sorted(
                self.nodes.values(),
                key=lambda n: (
                    n.get("position", {}).get("y", 0),
                    n.get("position", {}).get("x", 0),
                ),
            )
            return [n["id"] for n in sorted_nodes]

        visited: set[str] = set()
        queue: list[str] = list(starts)
        order: list[str] = []

        while queue:
            node_id = queue.pop(0)
            if node_id in visited or node_id not in self.nodes:
                continue
            visited.add(node_id)
            order.append(node_id)
            for child in self.get_children(node_id):
                if child not in visited:
                    queue.append(child)

        return order


# ---------------------------------------------------------------------------
# Node Executor
# ---------------------------------------------------------------------------


class NodeExecutor:
    """Executes individual workflow nodes based on their type."""

    def __init__(self, connectors: dict[str, AutomationConnector], context: dict[str, Any]):
        self.connectors = connectors
        self.context = context

    async def execute(self, node: dict[str, Any]) -> dict[str, Any]:
        node_type = node.get("type", "")
        data = node.get("data", {})

        if node_type.startswith("trigger."):
            return await self._execute_trigger(node_type, data)
        elif node_type.startswith("action."):
            return await self._execute_action(node_type, data)
        elif node_type.startswith("logic."):
            return await self._execute_logic(node_type, data)
        else:
            return {"status": "skipped", "message": f"Unknown node type: {node_type}"}

    async def _execute_trigger(self, node_type: str, data: dict[str, Any]) -> dict[str, Any]:
        trigger_kind = node_type.replace("trigger.", "")

        if trigger_kind == "schedule":
            return {
                "status": "completed",
                "timestamp": _now().isoformat(),
                "cron": data.get("cron", ""),
                "timezone": data.get("timezone", "UTC"),
            }
        elif trigger_kind == "manual":
            return {
                "status": "completed",
                "timestamp": _now().isoformat(),
                "trigger_data": self.context.get("trigger_data", {}),
            }
        elif trigger_kind == "webhook":
            return {
                "status": "completed",
                "timestamp": _now().isoformat(),
                "payload": self.context.get("trigger_data", {}),
            }
        elif trigger_kind == "github":
            return {
                "status": "completed",
                "timestamp": _now().isoformat(),
                "event": data.get("event", "push"),
                "payload": self.context.get("trigger_data", {}),
            }
        elif trigger_kind == "slack":
            return {
                "status": "completed",
                "timestamp": _now().isoformat(),
                "event": data.get("event", "message"),
                "payload": self.context.get("trigger_data", {}),
            }
        else:
            return {"status": "completed", "timestamp": _now().isoformat()}

    async def _execute_action(self, node_type: str, data: dict[str, Any]) -> dict[str, Any]:
        action_kind = node_type.replace("action.", "")

        if action_kind == "http_request":
            return await self._action_http_request(data)
        elif action_kind == "slack.send_message":
            return await self._action_slack_message(data)
        elif action_kind == "github.create_issue":
            return await self._action_github_create_issue(data)
        elif action_kind == "github.create_review":
            return await self._action_github_create_review(data)
        elif action_kind == "notion.query_database":
            return await self._action_notion_query_database(data)
        elif action_kind == "notion.create_page":
            return await self._action_notion_create_page(data)
        elif action_kind == "notion.append_block":
            return await self._action_notion_append_block(data)
        elif action_kind == "code_execution":
            return await self._action_code_execution(data)
        elif action_kind == "transform":
            return await self._action_transform(data)
        elif action_kind == "delay":
            return await self._action_delay(data)
        elif action_kind == "log":
            return self._action_log(data)
        else:
            return {"status": "completed", "message": f"Action {action_kind} executed (stub)"}

    async def _execute_logic(self, node_type: str, data: dict[str, Any]) -> dict[str, Any]:
        logic_kind = node_type.replace("logic.", "")

        if logic_kind == "condition":
            return self._logic_condition(data)
        elif logic_kind == "filter":
            return self._logic_filter(data)
        elif logic_kind == "switch":
            return self._logic_switch(data)
        elif logic_kind == "loop":
            return self._logic_loop(data)
        else:
            return {"status": "completed", "message": f"Logic {logic_kind} evaluated (stub)"}

    # --- Action implementations ---

    async def _action_http_request(self, data: dict[str, Any]) -> dict[str, Any]:
        url = self._resolve_template(data.get("url", ""))
        method = data.get("method", "GET").upper()
        headers = data.get("headers", {})
        body = data.get("body")
        timeout = data.get("timeout", 30000) / 1000

        # Resolve template variables in headers
        resolved_headers = {}
        for k, v in (headers or {}).items():
            resolved_headers[k] = self._resolve_template(str(v))

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                kwargs: dict[str, Any] = {"method": method, "url": url, "headers": resolved_headers}
                if body and method in ("POST", "PUT", "PATCH"):
                    if isinstance(body, dict):
                        resolved_body = self._resolve_dict_templates(body)
                        kwargs["json"] = resolved_body
                    else:
                        kwargs["content"] = self._resolve_template(str(body))

                response = await client.request(**kwargs)
                try:
                    resp_body = response.json()
                except Exception:
                    resp_body = response.text[:2000]

                return {
                    "status": "completed" if response.is_success else "failed",
                    "status_code": response.status_code,
                    "body": resp_body,
                    "headers": dict(response.headers),
                }
        except Exception as exc:
            return {"status": "failed", "error": str(exc)}

    async def _action_slack_message(self, data: dict[str, Any]) -> dict[str, Any]:
        connector = self.connectors.get("slack")
        if not connector or not connector.access_token_encrypted:
            return {"status": "failed", "error": "Slack connector not configured"}

        token = _decrypt_secret(connector.access_token_encrypted)
        channel = self._resolve_template(data.get("channel", "#general"))
        message = self._resolve_template(data.get("message", ""))

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://slack.com/api/chat.postMessage",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    json={"channel": channel, "text": message},
                )
                resp.raise_for_status()
                payload = resp.json()
                if not payload.get("ok"):
                    return {"status": "failed", "error": payload.get("error", "Slack API error")}
                return {"status": "completed", "channel": channel, "ts": payload.get("ts")}
        except Exception as exc:
            return {"status": "failed", "error": str(exc)}

    async def _action_github_create_issue(self, data: dict[str, Any]) -> dict[str, Any]:
        connector = self.connectors.get("github")
        if not connector or not connector.access_token_encrypted:
            return {"status": "failed", "error": "GitHub connector not configured"}

        token = _decrypt_secret(connector.access_token_encrypted)
        repo = self._resolve_template(data.get("repo", ""))
        title = self._resolve_template(data.get("title", ""))
        body = self._resolve_template(data.get("body", ""))

        if not repo:
            return {"status": "failed", "error": "Repository not specified"}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"https://api.github.com/repos/{repo}/issues",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/vnd.github+json",
                    },
                    json={"title": title, "body": body},
                )
                resp.raise_for_status()
                result = resp.json()
                return {
                    "status": "completed",
                    "issue_number": result.get("number"),
                    "url": result.get("html_url"),
                }
        except Exception as exc:
            return {"status": "failed", "error": str(exc)}

    async def _action_github_create_review(self, data: dict[str, Any]) -> dict[str, Any]:
        connector = self.connectors.get("github")
        if not connector or not connector.access_token_encrypted:
            return {"status": "failed", "error": "GitHub connector not configured"}

        token = _decrypt_secret(connector.access_token_encrypted)
        repo = self._resolve_template(data.get("repo", ""))
        pr_number = data.get("pr_number")
        body = self._resolve_template(data.get("body", ""))
        event = data.get("event", "COMMENT")

        if not repo or not pr_number:
            return {"status": "failed", "error": "Repository and PR number required"}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"https://api.github.com/repos/{repo}/pulls/{pr_number}/reviews",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/vnd.github+json",
                    },
                    json={"body": body, "event": event},
                )
                resp.raise_for_status()
                result = resp.json()
                return {"status": "completed", "review_id": result.get("id")}
        except Exception as exc:
            return {"status": "failed", "error": str(exc)}

    async def _action_notion_query_database(self, data: dict[str, Any]) -> dict[str, Any]:
        connector = self.connectors.get("notion")
        if not connector or not connector.access_token_encrypted:
            return {"status": "failed", "error": "Notion connector not configured"}

        token = _decrypt_secret(connector.access_token_encrypted)
        database_id = self._resolve_template(data.get("database_id", ""))
        filter_params = data.get("filter", {})

        if not database_id:
            return {"status": "failed", "error": "Notion database ID not specified"}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"https://api.notion.com/v1/databases/{database_id}/query",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "Notion-Version": "2022-06-28",
                    },
                    json=filter_params if filter_params else {"page_size": 100},
                )
                resp.raise_for_status()
                result = resp.json()
                return {
                    "status": "completed",
                    "result_count": len(result.get("results", [])),
                    "results": result.get("results", []),
                }
        except Exception as exc:
            return {"status": "failed", "error": str(exc)}

    async def _action_notion_create_page(self, data: dict[str, Any]) -> dict[str, Any]:
        connector = self.connectors.get("notion")
        if not connector or not connector.access_token_encrypted:
            return {"status": "failed", "error": "Notion connector not configured"}

        token = _decrypt_secret(connector.access_token_encrypted)
        parent_type = data.get("parent_type", "database")
        parent_id = self._resolve_template(data.get("parent_id", ""))
        title = self._resolve_template(data.get("title", "Untitled"))
        properties_data = data.get("properties", {})
        children = data.get("children", [])

        if not parent_id:
            return {"status": "failed", "error": "Notion parent ID not specified"}

        try:
            notion_properties = {}
            if parent_type == "database":
                notion_properties = {"title": [{"type": "text", "text": {"content": title}}]}
                for key, value in properties_data.items():
                    if isinstance(value, list):
                        notion_properties[key] = value

            body: dict[str, Any] = {"parent": {parent_type + "_id": parent_id}, "properties": notion_properties}
            if children:
                children_payload: list[dict[str, Any]] = []
                for c in children:
                    if isinstance(c, str):
                        children_payload.append(
                            {
                                "object": "block",
                                "type": "paragraph",
                                "paragraph": {
                                    "rich_text": [
                                        {"type": "text", "text": {"content": c}}
                                    ]
                                },
                            }
                        )
                    else:
                        children_payload.append(cast(dict[str, Any], c))
                body["children"] = children_payload

            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://api.notion.com/v1/pages",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "Notion-Version": "2022-06-28",
                    },
                    json=body,
                )
                resp.raise_for_status()
                result = resp.json()
                return {"status": "completed", "page_id": result.get("id"), "url": result.get("url")}
        except Exception as exc:
            return {"status": "failed", "error": str(exc)}

    async def _action_notion_append_block(self, data: dict[str, Any]) -> dict[str, Any]:
        connector = self.connectors.get("notion")
        if not connector or not connector.access_token_encrypted:
            return {"status": "failed", "error": "Notion connector not configured"}

        token = _decrypt_secret(connector.access_token_encrypted)
        block_id = self._resolve_template(data.get("block_id", ""))
        children = data.get("children", [])

        if not block_id:
            return {"status": "failed", "error": "Notion block ID not specified"}

        try:
            body = {
                "children": [
                    {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": c}}]}}
                    if isinstance(c, str) else c
                    for c in children
                ]
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.patch(
                    f"https://api.notion.com/v1/blocks/{block_id}/children",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "Notion-Version": "2022-06-28",
                    },
                    json=body,
                )
                resp.raise_for_status()
                result = resp.json()
                return {"status": "completed", "block_count": len(result.get("results", []))}
        except Exception as exc:
            return {"status": "failed", "error": str(exc)}

    async def _action_code_execution(self, data: dict[str, Any]) -> dict[str, Any]:
        code = data.get("code", "")
        language = data.get("language", "javascript")
        return {
            "status": "completed",
            "message": f"Code execution stub for {language}",
            "code_length": len(code),
            "output": {"note": "E2B sandbox execution to be integrated"},
        }

    async def _action_transform(self, data: dict[str, Any]) -> dict[str, Any]:
        transform_type = data.get("transform_type", "passthrough")
        expression = data.get("expression", "")

        if transform_type == "json_path":
            return {"status": "completed", "result": self._resolve_template(expression)}
        elif transform_type == "map":
            items = self._resolve_template(data.get("items", "[]"))
            return {"status": "completed", "result": items}
        else:
            return {"status": "completed", "result": self.context.get("previous_output", {})}

    async def _action_delay(self, data: dict[str, Any]) -> dict[str, Any]:
        duration_ms = data.get("duration_ms", 1000)
        duration_sec = min(duration_ms / 1000, 300)
        await self._sleep(duration_sec)
        return {"status": "completed", "waited_ms": duration_ms}

    async def _sleep(self, seconds: float) -> None:
        import asyncio

        await asyncio.sleep(seconds)

    def _action_log(self, data: dict[str, Any]) -> dict[str, Any]:
        message = self._resolve_template(data.get("message", ""))
        level = data.get("level", "info")
        logger.log(getattr(logging, level.upper(), logging.INFO), "Workflow log: %s", message)
        return {"status": "completed", "message": message, "level": level}

    # --- Logic implementations ---

    def _logic_condition(self, data: dict[str, Any]) -> dict[str, Any]:
        condition = data.get("condition", "")
        resolved = self._resolve_template(condition)
        try:
            result = bool(eval(resolved, {"__builtins__": {}}, self.context))
        except Exception:
            result = False
        return {
            "status": "completed",
            "condition_met": result,
            "branch": "true" if result else "false",
        }

    def _logic_filter(self, data: dict[str, Any]) -> dict[str, Any]:
        items = self.context.get("previous_output", [])
        if not isinstance(items, list):
            items = [items]
        condition = data.get("condition", "True")
        filtered = []
        for item in items:
            try:
                if eval(condition, {"__builtins__": {}}, {"item": item}):
                    filtered.append(item)
            except Exception:
                pass
        return {"status": "completed", "filtered_count": len(filtered), "items": filtered}

    def _logic_switch(self, data: dict[str, Any]) -> dict[str, Any]:
        value = self._resolve_template(data.get("value", ""))
        cases = data.get("cases", {})
        matched = cases.get(str(value), data.get("default_case", "default"))
        return {"status": "completed", "matched_case": matched, "value": value}

    def _logic_loop(self, data: dict[str, Any]) -> dict[str, Any]:
        items = self._resolve_template(data.get("items", "[]"))
        if isinstance(items, list):
            return {"status": "completed", "iteration_count": len(items), "items": items}
        return {"status": "completed", "iteration_count": 0, "items": []}

    # --- Template resolution ---

    def _resolve_template(self, template: str) -> Any:
        """Resolve {{variable}} templates from context."""
        if not isinstance(template, str):
            return template

        pattern = re.compile(r"\{\{([^}]+)\}\}")

        def replacer(match: re.Match[str]) -> str:
            path = match.group(1).strip()
            value = self._get_nested_value(path)
            return str(value) if value is not None else match.group(0)

        resolved = pattern.sub(replacer, template)

        # Try to parse as JSON if the whole string was a template
        if resolved.startswith("{") or resolved.startswith("["):
            try:
                import json

                return json.loads(resolved)
            except Exception:
                pass

        return resolved

    def _resolve_dict_templates(self, d: dict[str, Any]) -> dict[str, Any]:
        result = {}
        for k, v in d.items():
            if isinstance(v, str):
                result[k] = self._resolve_template(v)
            elif isinstance(v, dict):
                result[k] = self._resolve_dict_templates(v)
            elif isinstance(v, list):
                result[k] = [self._resolve_template(i) if isinstance(i, str) else i for i in v]
            else:
                result[k] = v
        return result

    def _get_nested_value(self, path: str) -> Any:
        """Get a nested value from context using dot notation."""
        parts = path.split(".")
        current = self.context
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
                current = current[int(part)]
            elif part == "length" and isinstance(current, (list, str)):
                return len(current)
            else:
                return None
        return current


# ---------------------------------------------------------------------------
# Workflow Orchestrator
# ---------------------------------------------------------------------------


class WorkflowOrchestrator:
    """Orchestrates full workflow execution from start to finish."""

    def __init__(
        self, automation: Automation, execution: AutomationExecution, session: AsyncSession
    ):
        self.automation = automation
        self.execution = execution
        self.session = session
        self.context: dict[str, Any] = {"trigger_data": execution.trigger_data or {}}
        self.node_results: dict[str, dict[str, Any]] = {}
        self.connectors: dict[str, AutomationConnector] = {}

    async def run(self) -> dict[str, Any]:
        start_time = time.monotonic()

        try:
            workflow_json = self.automation.workflow_json or self.automation.inferred_config
            if not workflow_json or not workflow_json.get("nodes"):
                return await self._run_legacy(start_time)

            parser = WorkflowParser(workflow_json)
            execution_order = parser.build_execution_order()

            await self._load_connectors()
            executor = NodeExecutor(self.connectors, self.context)

            node_count = 0
            for idx, node_id in enumerate(execution_order):
                node = parser.get_node(node_id)
                if not node:
                    continue

                node_count += 1
                node_log = AutomationNodeLog(
                    execution_id=self.execution.id,
                    automation_id=self.automation.id,
                    node_id=node_id,
                    node_name=node.get("data", {}).get("label", node_id),
                    node_type=node.get("type", "unknown"),
                    status="running",
                    sort_order=idx,
                    input_data=node.get("data", {}),
                )
                self.session.add(node_log)
                await self.session.flush()

                node_start = time.monotonic()
                try:
                    # Get retry config from node data
                    node_data = node.get("data", {})
                    retry_config = node_data.get("retry", {})
                    max_retries = (
                        retry_config.get("max_attempts", 1) if isinstance(retry_config, dict) else 1
                    )
                    backoff_base = (
                        retry_config.get("backoff_base", 2) if isinstance(retry_config, dict) else 2
                    )

                    # Execute with retry and exponential backoff
                    result = await self._execute_with_retry(
                        executor, node, max_retries, backoff_base, node_log
                    )

                    # Self-verification: check if result looks valid
                    if result.get("status") == "completed":
                        verify_result = self._verify_output(node, result)
                        if not verify_result["valid"]:
                            result["status"] = "verification_failed"
                            result["verification_note"] = verify_result["reason"]
                            node_log.level = "warning"

                    node_log.status = result.get("status", "completed")
                    node_log.output_data = result
                    if result.get("status") == "failed":
                        node_log.level = "error"
                    elif result.get("status") == "verification_failed":
                        node_log.level = "warning"
                    if result.get("error"):
                        node_log.error_message = result["error"]
                        node_log.error_category = _categorize_error(result["error"])
                    self.node_results[node_id] = result

                    self.context[f"node_{node_id}"] = result
                    self.context["previous_output"] = result

                except Exception as exc:
                    node_log.status = "failed"
                    node_log.level = "error"
                    node_log.error_message = str(exc)
                    node_log.error_category = _categorize_error(str(exc))
                    logger.exception("Node %s failed", node_id)
                    self.node_results[node_id] = {"status": "failed", "error": str(exc)}

                node_log.duration_ms = int((time.monotonic() - node_start) * 1000)
                node_log.completed_at = _now()

            duration_ms = int((time.monotonic() - start_time) * 1000)
            failed_nodes = [
                nid for nid, r in self.node_results.items() if r.get("status") == "failed"
            ]

            return {
                "summary": f"Executed {node_count} nodes, {len(failed_nodes)} failed",
                "node_count": node_count,
                "failed_nodes": failed_nodes,
                "duration_ms": duration_ms,
                "status": "failed" if failed_nodes else "success",
            }

        except Exception as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.exception("Workflow execution failed")
            return {
                "summary": f"Workflow failed: {exc}",
                "status": "failed",
                "error": str(exc),
                "duration_ms": duration_ms,
            }

    async def _execute_with_retry(
        self,
        executor: NodeExecutor,
        node: dict[str, Any],
        max_retries: int,
        backoff_base: float,
        node_log: AutomationNodeLog,
    ) -> dict[str, Any]:
        """Execute a node with exponential backoff retry logic."""
        import asyncio

        last_result: dict[str, Any] = {"status": "failed", "error": "Not executed"}
        attempt = 0

        while attempt < max_retries:
            attempt += 1
            try:
                result = await executor.execute(node)

                if result.get("status") == "completed":
                    if attempt > 1:
                        result["_retry_info"] = {
                            "attempts": attempt,
                            "succeeded_on": attempt,
                        }
                    return result

                last_result = result

                # Don't retry if it's a configuration error
                if result.get("status") == "failed" and "not configured" in result.get("error", ""):
                    return result

            except Exception as exc:
                last_result = {"status": "failed", "error": str(exc)}

            # Wait before retry (exponential backoff)
            if attempt < max_retries:
                wait_time = min(backoff_base**attempt, 60)  # Cap at 60 seconds
                node_log.retry_count = attempt
                logger.info(
                    "Node %s attempt %d/%d failed, retrying in %.1fs",
                    node.get("id", "?"),
                    attempt,
                    max_retries,
                    wait_time,
                )
                await asyncio.sleep(wait_time)

        last_result["_retry_info"] = {
            "attempts": attempt,
            "all_failed": True,
        }
        return last_result

    def _verify_output(self, node: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        """Self-verification: check if the node output looks valid.

        Similar to Cursor's self-verification where agents verify their
        own output before posting.
        """
        node_type = node.get("type", "")
        data = node.get("data", {})

        # HTTP request verification
        if node_type == "action.http_request":
            status_code = result.get("status_code")
            if status_code and status_code >= 400:
                return {
                    "valid": False,
                    "reason": f"HTTP request returned error status {status_code}",
                }

        # Slack message verification
        if node_type == "action.slack.send_message":
            if not result.get("ts") and not result.get("channel"):
                return {
                    "valid": False,
                    "reason": "Slack message delivery not confirmed",
                }

        # GitHub issue/PR verification
        if node_type in ("action.github.create_issue", "action.github.create_review"):
            if (
                not result.get("issue_number")
                and not result.get("review_id")
                and not result.get("url")
            ):
                return {
                    "valid": False,
                    "reason": "GitHub action did not return a valid resource ID",
                }

        # Code execution verification
        if node_type == "action.code_execution":
            output = result.get("output")
            if output is None:
                return {
                    "valid": False,
                    "reason": "Code execution produced no output",
                }

        # Custom verification rule from node config
        verify_rule = data.get("verify")
        if verify_rule:
            expected_field = verify_rule.get("expected_field")
            if expected_field and expected_field not in result:
                return {
                    "valid": False,
                    "reason": f"Expected field '{expected_field}' not found in output",
                }

            min_status = verify_rule.get("min_status_code", 200)
            max_status = verify_rule.get("max_status_code", 399)
            status_code = result.get("status_code")
            if status_code and not (min_status <= status_code <= max_status):
                return {
                    "valid": False,
                    "reason": f"Status code {status_code} outside expected range [{min_status}, {max_status}]",
                }

        return {"valid": True, "reason": "Output verified"}

    async def _run_legacy(self, start_time: float) -> dict[str, Any]:
        """Fallback for legacy non-visual automations using the old execution logic."""
        import importlib

        automations = importlib.import_module("app.services.automations")

        result = await automations._execute_automation(self.automation, self.session)
        duration_ms = int((time.monotonic() - start_time) * 1000)
        result["duration_ms"] = duration_ms
        return result

    async def _load_connectors(self) -> None:
        rows = await self.session.execute(
            select(AutomationConnector).where(
                AutomationConnector.user_id == self.automation.user_id
            )
        )
        self.connectors = {row.provider: row for row in rows.scalars()}
        # Try to refresh tokens that are expiring
        for provider in self.connectors:
            await self._maybe_refresh_token(provider)

    async def _maybe_refresh_token(self, provider: str) -> None:
        """Attempt to refresh an expired OAuth token before execution."""
        connector = self.connectors.get(provider)
        if not connector or not connector.refresh_token_encrypted:
            return

        # Only attempt refresh if token is expired or about to expire
        if connector.expires_at and connector.expires_at > _now():
            return  # Token still valid

        refresh_token = _decrypt_secret(connector.refresh_token_encrypted)
        if not refresh_token:
            return

        try:
            if provider == "slack":
                from app.config import get_settings  # noqa: PLC0415

                settings = get_settings()
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.post(
                        "https://slack.com/api/oauth.v2.access",
                        data={
                            "client_id": settings.slack_oauth_client_id,
                            "client_secret": settings.slack_oauth_client_secret,
                            "refresh_token": refresh_token,
                            "grant_type": "refresh_token",
                        },
                    )
                    if resp.is_success:
                        data = resp.json()
                        if data.get("ok"):
                            connector.access_token_encrypted = _encrypt_secret(data.get("access_token"))
                            if data.get("refresh_token"):
                                connector.refresh_token_encrypted = _encrypt_secret(data.get("refresh_token"))
                            connector.updated_at = _now()
                            logger.info("Refreshed token for %s connector", provider)
        except Exception as exc:
            logger.warning("Token refresh failed for %s: %s", provider, exc)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def execute_workflow(
    automation_id: str,
    trigger_type: str = "manual",
    trigger_data: dict[str, Any] | None = None,
) -> AutomationExecution:
    """Execute a workflow and record the full execution."""
    async with AsyncSessionLocal() as session:
        automation = await session.get(Automation, automation_id)
        if automation is None or not automation.enabled:
            raise ValueError(f"Automation {automation_id} not found or not enabled")

        execution = AutomationExecution(
            automation_id=automation.id,
            user_id=automation.user_id,
            status="running",
            trigger_type=trigger_type,
            trigger_data=trigger_data or {},
            workflow_snapshot=automation.workflow_json,
        )
        session.add(execution)
        await session.flush()

        orchestrator = WorkflowOrchestrator(automation, execution, session)
        result = await orchestrator.run()

        execution.status = result.get("status", "completed")
        execution.execution_data = result
        execution.duration_ms = result.get("duration_ms")
        execution.error_message = result.get("error")
        execution.completed_at = _now()

        automation.last_status = execution.status
        automation.last_error = execution.error_message
        automation.last_run_at = execution.completed_at

        await session.commit()
        return execution


async def get_execution(
    execution_id: str, user_id: str, session: AsyncSession
) -> AutomationExecution | None:
    row = await session.execute(
        select(AutomationExecution).where(
            AutomationExecution.id == execution_id,
            AutomationExecution.user_id == user_id,
        )
    )
    return row.scalar_one_or_none()


async def list_executions(
    automation_id: str, user_id: str, session: AsyncSession, limit: int = 50
) -> list[AutomationExecution]:
    rows = await session.execute(
        select(AutomationExecution)
        .where(
            AutomationExecution.automation_id == automation_id,
            AutomationExecution.user_id == user_id,
        )
        .order_by(AutomationExecution.started_at.desc())
        .limit(limit)
    )
    return list(rows.scalars())


async def get_node_logs(execution_id: str, session: AsyncSession) -> list[AutomationNodeLog]:
    rows = await session.execute(
        select(AutomationNodeLog)
        .where(AutomationNodeLog.execution_id == execution_id)
        .order_by(AutomationNodeLog.sort_order)
    )
    return list(rows.scalars())
