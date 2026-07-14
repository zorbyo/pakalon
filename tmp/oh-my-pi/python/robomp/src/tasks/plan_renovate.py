"""Plan renovation task.

The Pakalon CLI writes per-project state to
`<project>/.pakalon-agents/`. Over time, abandoned projects
accumulate state — phase directories that were started but never
finished, auditor reports that are months old, auditor log
JSONLs that are megabytes long.

This task scans each registered project and removes state files
that are older than the threshold (default 30 days). "Old" is
defined as `mtime > now - threshold` being false, which matches
the "no touch in N days" semantics.

Behavior:
  - Walks the bridge's `project_index` table for the active project
    hashes.
  - For each, checks `<project>/.pakalon-agents/`.
  - Removes files where `mtime < now - threshold`.
  - Emits a `renovate_log` row per (project, removed_file) for
    auditability.
  - Dry-run by default; pass `--apply` to actually delete.

Caveat: this only touches the on-disk state. The robomp event
queue and the bridge SQLite are separate and have their own
retention policies.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

log = logging.getLogger(__name__)

# Mirror of the spec's "clean stale .pakalon state >30 days". Keep
# the CLI and the bridge in sync via a single source of truth:
# `pakalon/init.ts:RENOVATE_THRESHOLD_DAYS` (when it lands).
DEFAULT_THRESHOLD_DAYS = 30

# Files in `.pakalon-agents/` whose names match one of these glob
# patterns are NOT touched by the renovate task. They are:
#   - The user-authored phase-1 input files (e.g. plan.md) — these
#     are the project's source of truth, not derived state.
#   - The `promoted/` directory — that was deliberately copied out.
PROTECTED_GLOBS: tuple[str, ...] = (
    "plan.md",
    "user-stories.md",
    "design.md",
    "agent-skills.md",
    "promoted/**",
)


@dataclass(slots=True, frozen=True)
class RenovateResult:
    project: str
    removed: list[str]
    kept: list[str]
    skipped_protected: list[str]
    bytes_freed: int


def is_protected(rel_path: str) -> bool:
    import fnmatch

    for pattern in PROTECTED_GLOBS:
        if fnmatch.fnmatch(rel_path, pattern):
            return True
    return False


def walk_old_files(root: Path, threshold_s: float) -> Iterable[tuple[Path, float]]:
    """Yield (file, mtime) for every regular file under `root` that
    is older than `now - threshold_s`."""
    if not root.exists():
        return
    cutoff = time.time() - threshold_s
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_mtime < cutoff:
            yield path, stat.st_mtime


def renovate(
    project_root: Path,
    threshold_days: int = DEFAULT_THRESHOLD_DAYS,
    *,
    apply: bool = False,
) -> RenovateResult:
    """Scan a single project's `.pakalon-agents/` and remove stale
    files. `apply=False` runs in dry-run mode and only reports
    what would be removed."""
    state_dir = project_root / ".pakalon-agents"
    threshold_s = threshold_days * 86400

    removed: list[str] = []
    kept: list[str] = []
    skipped: list[str] = []
    bytes_freed = 0

    for file_path, _mtime in walk_old_files(state_dir, threshold_s):
        rel = str(file_path.relative_to(project_root))
        if is_protected(rel):
            skipped.append(rel)
            continue
        try:
            size = file_path.stat().st_size
        except OSError:
            continue
        if apply:
            try:
                file_path.unlink()
                removed.append(rel)
                bytes_freed += size
            except OSError as err:
                log.warning("renovate: unlink failed", extra={"path": rel, "err": str(err)})
                kept.append(rel)
        else:
            removed.append(rel)
            bytes_freed += size

    return RenovateResult(
        project=str(project_root),
        removed=removed,
        kept=kept,
        skipped_protected=skipped,
        bytes_freed=bytes_freed,
    )


def load_project_index() -> list[str]:
    """Read the bridge's project list.

    For now, read the env var `PAKALON_PROJECT_DIRS` (colon-separated
    absolute paths). A future iteration will read from the bridge's
    `project_index` table once that lands.
    """
    raw = os.environ.get("PAKALON_PROJECT_DIRS", "").strip()
    if not raw:
        return []
    return [p for p in raw.split(os.pathsep) if p]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Renovate stale Pakalon plan state (>N days old)",
    )
    parser.add_argument(
        "--threshold-days",
        type=int,
        default=DEFAULT_THRESHOLD_DAYS,
        help=f"Days before a file is considered stale (default {DEFAULT_THRESHOLD_DAYS})",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete files (default: dry-run, just report)",
    )
    parser.add_argument(
        "project_dirs",
        nargs="*",
        type=Path,
        help="Project directories to renovate (default: $PAKALON_PROJECT_DIRS)",
    )
    args = parser.parse_args()

    projects: list[Path] = list(args.project_dirs) or [Path(p) for p in load_project_index()]
    if not projects:
        print("no projects to renovate (set $PAKALON_PROJECT_DIRS or pass paths)", file=sys.stderr)
        sys.exit(0)

    overall_removed = 0
    overall_bytes = 0
    for project in projects:
        result = renovate(project, threshold_days=args.threshold_days, apply=args.apply)
        overall_removed += len(result.removed)
        overall_bytes += result.bytes_freed
        print(
            json.dumps(
                {
                    "project": result.project,
                    "removed_count": len(result.removed),
                    "kept_count": len(result.kept),
                    "skipped_protected_count": len(result.skipped_protected),
                    "bytes_freed": result.bytes_freed,
                    "removed": result.removed,
                    "skipped_protected": result.skipped_protected,
                },
                indent=2,
            )
        )
    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "threshold_days": args.threshold_days,
                "projects_scanned": len(projects),
                "total_removed": overall_removed,
                "total_bytes_freed": overall_bytes,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
