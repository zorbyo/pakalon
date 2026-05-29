"""Health check router — database probe only."""
import logging
from importlib.metadata import PackageNotFoundError, version
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_health_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_session():
        yield session


def _app_version() -> str:
    try:
        return version("pakalon-backend")
    except PackageNotFoundError:
        return "0.1.0"


@router.get("/health", tags=["health"])
async def health(session: AsyncSession | None = Depends(get_health_session)) -> JSONResponse:
    """
    Deep health check — verifies app and DB are reachable.

    Returns HTTP 200 on success, or HTTP 503 if database is unavailable.
    """
    settings = get_settings()
    if settings.is_selfhosted:
        return JSONResponse(
            status_code=200,
            content={
                "status": "ok",
                "service": "pakalon-backend",
                "version": _app_version(),
                "mode": "selfhosted",
                "db": "skipped",
            },
        )

    db_status = "ok"

    # DB probe
    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:
        logger.error("Health check DB probe failed: %s", exc)
        db_status = "error"

    overall = "ok" if db_status == "ok" else "degraded"
    http_code = 200 if db_status == "ok" else 503

    return JSONResponse(
        status_code=http_code,
        content={
            "status": overall,
            "service": "pakalon-backend",
            "version": _app_version(),
            "db": db_status,
        },
    )
