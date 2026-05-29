"""Deployment-mode dependencies and guards."""

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.config import get_settings

# Endpoints that are always allowed, regardless of mode.
_ALWAYS_ALLOWED = {
    "/health",
    "/local/health",
    "/local/sync",
    "/local/providers",
    "/local/models",
    "/local/chat",
    "/docs",
    "/redoc",
    "/openapi.json",
}


def _is_allowed_in_selfhosted(path: str) -> bool:
    """Return True if the given path is allowed in self-hosted mode."""
    if path in _ALWAYS_ALLOWED:
        return True
    # Allow any /local/* endpoint (future-proofing)
    if path.startswith("/local/"):
        return True
    return False


class SelfHostedModeGate(BaseHTTPMiddleware):
    """Block all non-local endpoints when running in self-hosted mode.

    This is a defense-in-depth safety net. Even if a cloud router is
    accidentally registered in self-hosted mode, this middleware rejects
    the request before it reaches the handler.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:  # noqa: PLR6301
        settings = get_settings()
        if not settings.is_selfhosted:
            return await call_next(request)

        path = request.url.path.rstrip("/") or "/"
        if _is_allowed_in_selfhosted(path):
            return await call_next(request)

        return JSONResponse(
            status_code=403,
            content={
                "detail": (
                    "This endpoint is not available in self-hosted mode. "
                    "Self-hosted Pakalon uses local Ollama/LM Studio providers via /local/* endpoints."
                )
            },
        )


async def require_cloud_mode(request: Request) -> None:  # noqa: ARG001
    """Dependency: reject cloud-only endpoints when the backend runs in self-hosted mode."""
    settings = get_settings()
    if settings.is_selfhosted:
        raise HTTPException(
            status_code=403,
            detail=(
                "This endpoint is not available in self-hosted mode. "
                "Self-hosted Pakalon uses the CLI with local Ollama/LM Studio providers."
            ),
        )

