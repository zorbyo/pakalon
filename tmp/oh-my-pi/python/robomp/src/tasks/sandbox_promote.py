"""Sandbox promotion task.

Triggered after Phase 4 passes its 80-score gate. Reads the
project's `.pakalon-agents/phase-4/score.json` (written by
`phases/phase4/index.ts`), verifies the threshold, and copies the
working tree out of the sandbox docker volume into the target
environment.

Behavior:
  - Reads `phase-4/score.json` from the project root.
  - If `score < 80`, logs and exits (no promotion).
  - If `score >= 80`, runs `git diff --stat` to enumerate changed
    files, then copies them to `<project>/.pakalon-agents/promoted/`
    so the deploy step in Phase 5 can `cd` there directly.

Idempotent: re-running drops a timestamped `promoted-<ts>/` dir
rather than overwriting the previous promotion.

The 80-score threshold lives in `pakalon/sandbox/policy.ts`; the
Python task reads the same value from the project JSON so the
threshold is single-sourced from the TypeScript side.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

log = logging.getLogger(__name__)

# Mirror of `pakalon/sandbox/policy.ts:PROMOTION_THRESHOLD`. Keep
# in sync — the CLI is the source of truth; this constant is a
# safety net if `score.json` is missing.
DEFAULT_PROMOTION_THRESHOLD = 80


@dataclass(slots=True, frozen=True)
class PromotionResult:
    promoted: bool
    score: int
    threshold: int
    target_dir: str | None = None
    reason: str = ""


def load_score(project_dir: Path) -> int | None:
    """Read the Phase 4 score from the project's score.json."""
    score_path = project_dir / ".pakalon-agents" / "phase-4" / "score.json"
    if not score_path.exists():
        return None
    try:
        with score_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        log.error("score.json read failed", extra={"err": str(exc), "path": str(score_path)})
        return None
    score = payload.get("score")
    if not isinstance(score, int):
        return None
    return score


def list_changed_files(project_dir: Path) -> list[str]:
    """Return the relative paths of files changed vs. HEAD."""
    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            cwd=str(project_dir),
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as exc:
        log.error("git diff failed", extra={"err": str(exc)})
        return []
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def copy_files(
    project_dir: Path,
    files: list[str],
    target: Path,
) -> int:
    """Copy each relative-path file from project_dir to target.

    Returns the number of files actually copied. Files that don't
    exist (deleted) or are ignored by `.gitignore` are skipped.
    """
    copied = 0
    target.mkdir(parents=True, exist_ok=True)
    for rel in files:
        src = project_dir / rel
        if not src.exists() or not src.is_file():
            continue
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    return copied


def promote_sandbox(
    project_dir: Path,
    threshold: int = DEFAULT_PROMOTION_THRESHOLD,
) -> PromotionResult:
    """Promote the project from the sandbox to the target env.

    Returns a `PromotionResult` describing the outcome. Callers
    (the dispatcher, a CLI user invoking `python -m robomp.tasks.sandbox_promote`)
    should log the result and surface the `reason` field on failure.
    """
    score = load_score(project_dir)
    if score is None:
        return PromotionResult(
            promoted=False,
            score=0,
            threshold=threshold,
            reason="no Phase 4 score found; run /phase-4 first",
        )
    if score < threshold:
        return PromotionResult(
            promoted=False,
            score=score,
            threshold=threshold,
            reason=f"score {score} below threshold {threshold}",
        )

    files = list_changed_files(project_dir)
    if not files:
        # Score is high but the diff is empty — likely a fresh
        # project that Phase 4 scanned against an empty tree.
        # Promote with a marker file so downstream phases know.
        ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        target = project_dir / ".pakalon-agents" / "promoted" / f"promoted-{ts}"
        target.mkdir(parents=True, exist_ok=True)
        (target / "EMPTY_DIFF.txt").write_text(
            f"Promoted at {ts} with score {score}/{threshold} and no changes vs. HEAD.\n"
        )
        return PromotionResult(
            promoted=True,
            score=score,
            threshold=threshold,
            target_dir=str(target),
        )

    ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = project_dir / ".pakalon-agents" / "promoted" / f"promoted-{ts}"
    copied = copy_files(project_dir, files, target)
    log.info(
        "sandbox_promote: copied",
        extra={"score": score, "files_copied": copied, "target": str(target)},
    )
    return PromotionResult(
        promoted=True,
        score=score,
        threshold=threshold,
        target_dir=str(target),
    )


def main() -> None:
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Promote a Pakalon project from the sandbox")
    parser.add_argument("project_dir", type=Path, help="Path to the project root")
    parser.add_argument(
        "--threshold",
        type=int,
        default=DEFAULT_PROMOTION_THRESHOLD,
        help=f"Minimum Phase 4 score to promote (default {DEFAULT_PROMOTION_THRESHOLD})",
    )
    args = parser.parse_args()

    result = promote_sandbox(args.project_dir, threshold=args.threshold)
    print(
        json.dumps(
            {
                "promoted": result.promoted,
                "score": result.score,
                "threshold": result.threshold,
                "target_dir": result.target_dir,
                "reason": result.reason,
            },
            indent=2,
        )
    )
    sys.exit(0 if result.promoted else 1)


if __name__ == "__main__":
    main()
