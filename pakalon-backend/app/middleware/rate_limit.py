"""Database-backed rate limiting middleware."""
import logging
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

import json
import jwt
from app.config import get_settings

logger = logging.getLogger(__name__)

# Route-specific overrides: (method, path_prefix) → requests_per_minute
ROUTE_LIMITS: dict[tuple[str, str], int] = {
    ("POST", "/auth/devices"): 10,        # prevent device code spam
    ("POST", "/auth/confirm"): 20,        # confirm code endpoint
    ("POST", "/billing"): 30,             # checkout
    ("POST", "/webhooks"): 200,           # webhooks can be high volume
    ("POST", "/sessions"): 50,            # session creation
    ("GET", "/sessions"): 5000,           # CLI session polling/listing - increased to prevent 429 during retry loops
}

# Plan-based limits for AI proxy endpoints (T-BE-22)
# Keyed by (method, path_prefix) → { plan → req/min }
AI_PLAN_LIMITS: dict[tuple[str, str], dict[str, int]] = {
    ("POST", "/ai/chat"): {"free": 60, "pro": 300, "default": 60},
}

DEFAULT_LIMIT = 100  # requests per minute per IP


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding window rate limiter backed by the database."""

    def __init__(self, app, redis_url: str | None = None) -> None:
        super().__init__(app)
        self._settings = get_settings()

    def _get_limit(self, method: str, path: str, plan: str | None = None) -> int:
        # Check plan-based AI limits first (T-BE-22)
        for (m, prefix), plan_limits in AI_PLAN_LIMITS.items():
            if method == m and path.startswith(prefix):
                effective_plan = plan or "free"
                return plan_limits.get(effective_plan, plan_limits["default"])
        for (m, prefix), limit in ROUTE_LIMITS.items():
            if method == m and path.startswith(prefix):
                return limit
        return DEFAULT_LIMIT

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        method = request.method

        # Skip rate limiting for health check
        if path == "/health":
            return await call_next(request)

        # Extract user_id from JWT if present
        user_id = None
        user_plan = None
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                payload = jwt.decode(token, options={"verify_signature": False})
                user_id = payload.get("sub")
                user_plan = payload.get("plan")  # T-BE-22: plan claim for rate limit
            except Exception:
                pass

        # Extract model_id from path or body if applicable
        model_id = None
        if path.startswith("/models/") and "/context" in path:
            parts = path.split("/")
            if len(parts) >= 3:
                model_id = parts[2]
        elif method == "POST" and path == "/sessions":
            try:
                body = await request.body()
                if body:
                    data = json.loads(body)
                    model_id = data.get("model_id")
                # Put the body back so the route handler can read it
                async def receive():
                    return {"type": "http.request", "body": body}
                request._receive = receive
            except Exception:
                pass

        limit = self._get_limit(method, path, plan=user_plan)
        
        # Build a more specific key if we have user/model info
        if user_id and model_id:
            key = f"rl:user:{user_id}:model:{model_id}:{method}:{path}"
        elif user_id:
            key = f"rl:user:{user_id}:{method}:{path}"
        else:
            key = f"rl:ip:{client_ip}:{method}:{path}"

        try:
            from app.database import AsyncSessionLocal  # noqa: PLC0415
            from app.services.rate_limit import check_rate_limit, rate_limit_headers  # noqa: PLC0415

            async with AsyncSessionLocal() as session:
                allowed, remaining, retry_after = await check_rate_limit(
                    session,
                    user_id or client_ip,
                    user_plan or "free",
                    route_key=f"{method}:{path}",
                    limit_override=limit,
                )
                if not allowed:
                    return JSONResponse(
                        status_code=429,
                        content={"detail": f"Rate limit exceeded: {limit} req/min"},
                        headers=rate_limit_headers(remaining, limit, retry_after),
                    )
                await session.commit()
        except Exception as exc:
            logger.warning("Rate limiter error (skipping): %s", exc)

        return await call_next(request)
