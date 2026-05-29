"""Self-hosted deployment mode tests."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings


def test_selfhosted_app_mounts_only_local_and_health_routes(monkeypatch):
    """Verify that cloud routers are not registered in self-hosted mode."""
    monkeypatch.setenv("PAKALON_MODE", "selfhosted")
    get_settings.cache_clear()

    try:
        from app.main import create_app

        app = create_app()
        paths = {getattr(route, "path", "") for route in app.routes}

        assert "/health" in paths
        assert "/local/health" in paths
        assert "/local/models" in paths
        assert "/local/providers" in paths
        assert "/local/chat" in paths
        assert "/models" not in paths
        assert not any(path.startswith("/auth") for path in paths)
        assert not any(path.startswith("/billing") for path in paths)
        assert not any(path.startswith("/usage") for path in paths)
        assert not any(path.startswith("/dashboard") for path in paths)
        assert not any(path.startswith("/automations") for path in paths)
    finally:
        monkeypatch.delenv("PAKALON_MODE", raising=False)
        get_settings.cache_clear()


def test_selfhosted_mode_gate_blocks_cloud_endpoints(monkeypatch):
    """Verify the defense-in-depth middleware blocks non-local endpoints."""
    monkeypatch.setenv("PAKALON_MODE", "selfhosted")
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("JWT_SECRET", "test-secret-for-ci-only")
    get_settings.cache_clear()

    try:
        from app.main import create_app

        app = create_app()

        # These should be allowed
        allowed = ["/health", "/local/health", "/local/models", "/local/providers"]
        # These should be blocked by the mode-gate middleware
        blocked = ["/auth/me", "/models", "/billing/subscription", "/usage", "/dashboard/stats"]

        for path in allowed:
            result = _get_sync(app, path)
            assert result.status_code in (200, 404), f"Expected allowed path {path} to return 200/404, got {result.status_code}"

        for path in blocked:
            result = _get_sync(app, path)
            assert result.status_code == 403, f"Expected {path} to be blocked (403), got {result.status_code}"
    finally:
        monkeypatch.delenv("PAKALON_MODE", raising=False)
        monkeypatch.delenv("ENVIRONMENT", raising=False)
        monkeypatch.delenv("JWT_SECRET", raising=False)
        get_settings.cache_clear()


def _get_sync(app, path: str):
    """Synchronous HTTP GET for testing."""
    import asyncio

    async def _async_get():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path)

    return asyncio.get_event_loop().run_until_complete(_async_get())


def test_selfhosted_config_normalizes_mode_variants(monkeypatch):
    """Verify that different mode spellings all resolve to 'selfhosted'."""
    variants = ["selfhosted", "self-hosted", "local"]
    for variant in variants:
        monkeypatch.setenv("PAKALON_MODE", variant)
        get_settings.cache_clear()
        try:
            settings = get_settings()
            assert settings.pakalon_mode == "selfhosted", f"Mode '{variant}' should normalize to 'selfhosted'"
        finally:
            monkeypatch.delenv("PAKALON_MODE", raising=False)
            get_settings.cache_clear()


def test_selfhosted_uses_sqlite(monkeypatch):
    """Verify that self-hosted mode uses SQLite, not PostgreSQL."""
    monkeypatch.setenv("PAKALON_MODE", "selfhosted")
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("JWT_SECRET", "test-secret-for-ci-only")
    get_settings.cache_clear()

    try:
        from app.database import resolve_effective_database_url

        url = resolve_effective_database_url()
        assert url.startswith("sqlite+"), f"Expected SQLite URL, got: {url}"
    finally:
        monkeypatch.delenv("PAKALON_MODE", raising=False)
        monkeypatch.delenv("ENVIRONMENT", raising=False)
        monkeypatch.delenv("JWT_SECRET", raising=False)
        get_settings.cache_clear()

