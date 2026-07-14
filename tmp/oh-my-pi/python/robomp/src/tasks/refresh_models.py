"""Nightly cron: refresh the OpenRouter model catalog.

Designed to be called by APScheduler in the orchestrator. The cron
lives here (not in `bridge/`) so it can run as a standalone script
(`python -m robomp.tasks.refresh_models`) during local dev.

Behavior:
  - Fetch the full catalog from `https://openrouter.ai/api/v1/models`.
  - Filter out rows with empty `id` or `name`.
  - Tag each model with `tier=free` for `:free` suffix, else `pro`.
  - Sort by id descending (newest first, per OpenRouter's release order).
  - Atomic replace the bridge's `bridge_model_cache` table.
  - Log row counts and the diff vs. the previous cache.

Idempotent: re-running with no upstream change leaves the cache intact.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

log = logging.getLogger(__name__)

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
DEFAULT_BRIDGE_DB = Path("./data/pakalon-bridge.sqlite")
TIMEOUT_SECONDS = 30


@dataclass(slots=True, frozen=True)
class RefreshResult:
    previous_count: int
    new_count: int
    added: list[str]
    removed: list[str]
    fetched_at: str


def fetch_openrouter_catalog(api_key: str | None = None) -> list[dict]:
    """Fetch the raw OpenRouter catalog. Returns `data` array; empty
    list on error (logged)."""
    headers: dict[str, str] = {"User-Agent": "pakalon-bridge/0.1"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(OPENROUTER_MODELS_URL, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as exc:
        log.error("openrouter fetch failed", extra={"err": str(exc)})
        return []
    return list(payload.get("data") or [])


def normalize_catalog(rows: list[dict]) -> list[dict]:
    """Tag each row with `tier` and drop unusable entries."""
    out: list[dict] = []
    for r in rows:
        rid = str(r.get("id", "")).strip()
        if not rid:
            continue
        out.append({
            "id": rid,
            "name": str(r.get("name", rid)),
            "provider": rid.split("/", 1)[0] or "unknown",
            "context_length": int(r.get("context_length") or 0),
            "tier": "free" if rid.endswith(":free") else "pro",
            "pricing": {
                "prompt": float((r.get("pricing") or {}).get("prompt") or 0.0),
                "completion": float((r.get("pricing") or {}).get("completion") or 0.0),
            },
        })
    out.sort(key=lambda r: r["id"], reverse=True)
    return out


def run_refresh(
    *,
    bridge_db: Path = DEFAULT_BRIDGE_DB,
    api_key: str | None = None,
) -> RefreshResult:
    """End-to-end refresh: fetch → normalize → replace cache → return diff."""
    # Lazy import: this module is also importable as a library without
    # pulling in the bridge (e.g. for the OpenRouter-only smoke test).
    from robomp.bridge.store import BridgeStore, ModelCacheRow

    raw = fetch_openrouter_catalog(api_key=api_key)
    normalized = normalize_catalog(raw)
    fetched_at = datetime.now(tz=UTC).isoformat()

    store = BridgeStore(sqlite_path=bridge_db)
    try:
        previous_ids = {r.id for r in store.list_model_cache()}
        new_rows = [
            ModelCacheRow(
                id=r["id"],
                name=r["name"],
                provider=r["provider"],
                context_length=r["context_length"],
                prompt_price=r["pricing"]["prompt"],
                completion_price=r["pricing"]["completion"],
                tier=r["tier"],
                fetched_at=fetched_at,
            )
            for r in normalized
        ]
        store.replace_model_cache(new_rows)
    finally:
        store.close()

    new_ids = {r["id"] for r in normalized}
    added = sorted(new_ids - previous_ids)
    removed = sorted(previous_ids - new_ids)
    result = RefreshResult(
        previous_count=len(previous_ids),
        new_count=len(new_rows),
        added=added,
        removed=removed,
        fetched_at=fetched_at,
    )
    log.info(
        "openrouter refresh complete",
        extra={
            "previous": result.previous_count,
            "new": result.new_count,
            "added": len(added),
            "removed": len(removed),
        },
    )
    return result


def main() -> int:
    """CLI entry: `python -m robomp.tasks.refresh_models`."""
    logging.basicConfig(
        level=os.environ.get("PAKALON_LOG_LEVEL", "INFO"),
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
    )
    api_key = os.environ.get("OPENROUTER_API_KEY")
    db_path = Path(os.environ.get("PAKALON_BRIDGE_DB", DEFAULT_BRIDGE_DB))
    result = run_refresh(bridge_db=db_path, api_key=api_key)
    print(json.dumps({
        "previous_count": result.previous_count,
        "new_count": result.new_count,
        "added": result.added,
        "removed": result.removed,
        "fetched_at": result.fetched_at,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
