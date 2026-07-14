"""Tests for the OpenRouter model refresh cron."""
from __future__ import annotations

from pathlib import Path

import pytest

from robomp.bridge.store import BridgeStore
from robomp.tasks.refresh_models import (
    fetch_openrouter_catalog,
    normalize_catalog,
    run_refresh,
)


def test_normalize_filters_and_tags_free() -> None:
    raw = [
        {"id": "anthropic/claude-sonnet-4", "name": "Sonnet 4", "context_length": 200_000, "pricing": {"prompt": "0.000003", "completion": "0.000015"}},
        {"id": "meta-llama/llama-3.1-8b:free", "name": "Llama 3.1 8B (free)", "context_length": 8000, "pricing": {"prompt": "0", "completion": "0"}},
        {"id": "", "name": "Empty ID, should be dropped"},
        {"id": "openai/gpt-4o", "name": "GPT-4o", "context_length": 128_000, "pricing": {"prompt": "0.0000025", "completion": "0.00001"}},
    ]
    out = normalize_catalog(raw)
    assert len(out) == 3
    assert out[0]["id"] == "openai/gpt-4o"  # sorted desc by id
    assert out[1]["id"] == "meta-llama/llama-3.1-8b:free"
    assert out[1]["tier"] == "free"
    assert out[2]["id"] == "anthropic/claude-sonnet-4"
    assert out[2]["tier"] == "pro"
    # Provider is the first segment of the id
    assert out[0]["provider"] == "openai"
    assert out[2]["provider"] == "anthropic"


def test_run_refresh_replaces_cache(tmp_path: Path) -> None:
    db = tmp_path / "bridge.sqlite"
    store = BridgeStore(sqlite_path=db)
    store.close()
    result = run_refresh(
        bridge_db=db,
        api_key=None,  # still works; OpenRouter allows unauthenticated reads
    )
    # The function falls back to fetching live; if no network the cache
    # will be empty and result.new_count == 0. Either is acceptable —
    # we only assert the contract: the call returns a RefreshResult
    # and the store stays in a consistent state.
    assert result.fetched_at
    store = BridgeStore(sqlite_path=db)
    try:
        cached = store.list_model_cache()
        assert len(cached) == result.new_count
    finally:
        store.close()


def test_fetch_returns_empty_on_network_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import urllib.error

    def _boom(*_args, **_kwargs):
        raise urllib.error.URLError("no network")

    import robomp.tasks.refresh_models as mod
    monkeypatch.setattr(mod.urllib.request, "urlopen", _boom)
    assert fetch_openrouter_catalog() == []
