"""Skills service — reusable composable workflow bundles.

Provides CRUD for automation skills that can be composed into workflows,
similar to Cursor Skills / Codex Skills / OpenClaw Skills.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_skill import AutomationSkill

logger = logging.getLogger(__name__)


# Built-in skills that ship with Pakalon
BUILTIN_SKILLS: list[dict[str, Any]] = [
    {
        "slug": "code-review",
        "name": "Code Review",
        "description": "Review code changes for quality, security, and best practices",
        "category": "development",
        "icon": "rate_review",
        "prompt_template": (
            "Review the following code changes for:\n"
            "1. Security vulnerabilities\n"
            "2. Performance issues\n"
            "3. Code style and best practices\n"
            "4. Potential bugs\n\n"
            "Code diff:\n{{diff}}\n\n"
            "Provide a structured review with severity levels."
        ),
        "config_schema": {
            "fields": [
                {"key": "diff", "label": "Code Diff", "type": "textarea", "required": True},
                {
                    "key": "severity_threshold",
                    "label": "Min Severity",
                    "type": "select",
                    "options": ["info", "warning", "error"],
                    "default": "warning",
                },
            ]
        },
        "node_type": "action.skill.code_review",
        "node_config": {"category": "action", "color": "#34d399"},
        "required_connectors": ["github"],
        "tags": ["code", "review", "security"],
    },
    {
        "slug": "summarize",
        "name": "Summarize Content",
        "description": "Summarize text, documents, or data into a concise format",
        "category": "productivity",
        "icon": "summarize",
        "prompt_template": (
            "Summarize the following content concisely:\n\n{{content}}\n\n"
            "Provide:\n1. Key points (bullet list)\n2. Overall summary (2-3 sentences)\n3. Action items (if any)"
        ),
        "config_schema": {
            "fields": [
                {
                    "key": "content",
                    "label": "Content to Summarize",
                    "type": "textarea",
                    "required": True,
                },
                {
                    "key": "max_length",
                    "label": "Max Summary Length",
                    "type": "number",
                    "default": 500,
                },
            ]
        },
        "node_type": "action.skill.summarize",
        "node_config": {"category": "action", "color": "#34d399"},
        "required_connectors": [],
        "tags": ["summary", "productivity"],
    },
    {
        "slug": "sentiment-analysis",
        "name": "Sentiment Analysis",
        "description": "Analyze text sentiment and extract emotional tone",
        "category": "analysis",
        "icon": "psychology",
        "prompt_template": (
            "Analyze the sentiment of the following text:\n\n{{text}}\n\n"
            "Return:\n1. Overall sentiment (positive/negative/neutral)\n2. Confidence score (0-1)\n"
            "3. Key emotional indicators\n4. Suggested response tone"
        ),
        "config_schema": {
            "fields": [
                {"key": "text", "label": "Text to Analyze", "type": "textarea", "required": True},
            ]
        },
        "node_type": "action.skill.sentiment",
        "node_config": {"category": "action", "color": "#34d399"},
        "required_connectors": [],
        "tags": ["analysis", "sentiment", "nlp"],
    },
    {
        "slug": "data-extract",
        "name": "Extract Structured Data",
        "description": "Extract structured data from unstructured text",
        "category": "data",
        "icon": "data_extraction",
        "prompt_template": (
            "Extract structured data from the following text according to this schema:\n"
            "Schema: {{schema}}\n\n"
            "Text:\n{{text}}\n\n"
            "Return valid JSON matching the schema."
        ),
        "config_schema": {
            "fields": [
                {"key": "text", "label": "Input Text", "type": "textarea", "required": True},
                {
                    "key": "schema",
                    "label": "Output Schema (JSON)",
                    "type": "json",
                    "required": True,
                },
            ]
        },
        "node_type": "action.skill.extract",
        "node_config": {"category": "action", "color": "#34d399"},
        "required_connectors": [],
        "tags": ["data", "extraction", "json"],
    },
    {
        "slug": "risk-score",
        "name": "Risk Assessment",
        "description": "Score the risk level of changes, decisions, or events",
        "category": "analysis",
        "icon": "security",
        "prompt_template": (
            "Assess the risk level of the following:\n\n{{subject}}\n\n"
            "Context:\n{{context}}\n\n"
            "Return:\n1. Risk score (0-10)\n2. Risk level (low/medium/high/critical)\n"
            "3. Risk factors identified\n4. Recommended actions"
        ),
        "config_schema": {
            "fields": [
                {
                    "key": "subject",
                    "label": "Subject to Assess",
                    "type": "textarea",
                    "required": True,
                },
                {"key": "context", "label": "Additional Context", "type": "textarea"},
            ]
        },
        "node_type": "action.skill.risk_score",
        "node_config": {"category": "action", "color": "#34d399"},
        "required_connectors": [],
        "tags": ["risk", "security", "assessment"],
    },
    {
        "slug": "auto-triage",
        "name": "Issue Triage",
        "description": "Automatically categorize and prioritize issues or tickets",
        "category": "development",
        "icon": "category",
        "prompt_template": (
            "Triage the following issue:\n\nTitle: {{title}}\nDescription: {{description}}\n\n"
            "Return:\n1. Category (bug/feature/question/other)\n2. Priority (P0-P3)\n"
            "3. Suggested assignee team\n4. Related components\n5. Suggested labels"
        ),
        "config_schema": {
            "fields": [
                {"key": "title", "label": "Issue Title", "type": "text", "required": True},
                {
                    "key": "description",
                    "label": "Issue Description",
                    "type": "textarea",
                    "required": True,
                },
            ]
        },
        "node_type": "action.skill.triage",
        "node_config": {"category": "action", "color": "#34d399"},
        "required_connectors": [],
        "tags": ["triage", "issues", "automation"],
    },
]


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


async def seed_builtin_skills(session: AsyncSession) -> int:
    """Insert built-in skills if they don't exist. Returns count created."""
    created = 0
    for skill_data in BUILTIN_SKILLS:
        row = await session.execute(
            select(AutomationSkill).where(AutomationSkill.slug == skill_data["slug"])
        )
        existing = row.scalar_one_or_none()
        if existing is None:
            skill = AutomationSkill(
                user_id=None,
                is_builtin=True,
                is_public=True,
                **skill_data,
            )
            session.add(skill)
            created += 1
    if created:
        await session.flush()
    return created


async def list_skills(
    session: AsyncSession,
    *,
    user_id: str | None = None,
    category: str | None = None,
    include_public: bool = True,
) -> list[AutomationSkill]:
    """List available skills."""
    conditions = []
    if user_id:
        from sqlalchemy import or_

        conditions.append(
            or_(AutomationSkill.user_id == user_id, AutomationSkill.is_public.is_(True))
        )
    elif include_public:
        conditions.append(AutomationSkill.is_public.is_(True))

    if category:
        conditions.append(AutomationSkill.category == category)

    query = select(AutomationSkill)
    for cond in conditions:
        query = query.where(cond)
    query = query.order_by(AutomationSkill.is_builtin.desc(), AutomationSkill.usage_count.desc())

    rows = await session.execute(query)
    return list(rows.scalars())


async def get_skill(skill_id: str, session: AsyncSession) -> AutomationSkill | None:
    """Get a skill by ID."""
    return await session.get(AutomationSkill, skill_id)


async def get_skill_by_slug(slug: str, session: AsyncSession) -> AutomationSkill | None:
    """Get a skill by slug."""
    row = await session.execute(select(AutomationSkill).where(AutomationSkill.slug == slug))
    return row.scalar_one_or_none()


async def increment_usage(skill_id: str, session: AsyncSession) -> None:
    """Increment the usage count for a skill."""
    skill = await session.get(AutomationSkill, skill_id)
    if skill:
        skill.usage_count += 1
        await session.flush()


async def create_custom_skill(
    *,
    user_id: str,
    name: str,
    slug: str,
    description: str,
    prompt_template: str,
    category: str = "custom",
    config_schema: dict[str, Any] | None = None,
    tags: list[str] | None = None,
    session: AsyncSession,
) -> AutomationSkill:
    """Create a user-defined custom skill."""
    skill = AutomationSkill(
        user_id=user_id,
        name=name,
        slug=f"custom-{slug}",
        description=description,
        category=category,
        icon="extension",
        prompt_template=prompt_template,
        config_schema=config_schema or {},
        node_type=f"action.skill.custom.{slug}",
        node_config={"category": "action", "color": "#34d399"},
        required_connectors=[],
        is_builtin=False,
        is_public=False,
        tags=tags or [],
    )
    session.add(skill)
    await session.flush()
    return skill
