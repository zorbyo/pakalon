"""Tests for the security orchestrator."""
from __future__ import annotations

from pathlib import Path

import pytest

from robomp.security import (
    Finding,
    tools_for_tier,
    run_all,
)


def test_tools_for_tier_free_excludes_pro() -> None:
    free = tools_for_tier("sast", "free")
    pro = tools_for_tier("sast", "pro")
    assert "semgrep" not in free
    assert "sonarqube" not in free
    assert "gitleaks" not in free
    assert "semgrep" in pro
    assert "sonarqube" in pro


def test_tools_for_tier_dast() -> None:
    free = tools_for_tier("dast", "free")
    pro = tools_for_tier("dast", "pro")
    # Free: sqlmap, wapiti, xsstrike; Pro adds owasp-zap, nikto
    assert "sqlmap" in free
    assert "owasp-zap" not in free
    assert "owasp-zap" in pro
    assert "nikto" in pro


def test_run_all_returns_5_subagents(tmp_path: Path) -> None:
    outputs = run_all(tmp_path, tier="free", target_url="http://localhost:3000")
    assert len(outputs) == 5
    roles = [o.role for o in outputs]
    assert roles == ["SAST", "DAST", "CodeReview", "CICD", "Pentest"]


def test_run_all_status_field(tmp_path: Path) -> None:
    outputs = run_all(tmp_path, tier="free", target_url="http://localhost:3000")
    # No tools found on PATH in the test env → all tools are "errors"
    # but the orchestrator still marks them completed/partial.
    for o in outputs:
        assert o.status in ("completed", "partial", "failed")
        assert o.started_at <= o.completed_at
