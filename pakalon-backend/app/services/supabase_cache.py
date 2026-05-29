"""Supabase Edge Function helper for cache-like workflows."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def call_edge_function(function_name: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None

    url = f"{settings.supabase_url.rstrip('/')}/functions/v1/{function_name}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            if resp.content:
                return resp.json()
            return {}
    except Exception as exc:
        logger.debug("Supabase edge function %s unavailable: %s", function_name, exc)
        return None
