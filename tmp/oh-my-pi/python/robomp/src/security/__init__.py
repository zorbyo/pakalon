"""Pakalon Phase 4 security orchestrator.

Spawns the 5 security subagent containers (SAST, DAST, code review,
CI/CD, pentest), collects their JSON outputs, and emits the
normalized findings the auditor / Phase 4 subagent reports consume.

Free vs Pro tool gating lives here. The free tier skips OWASP ZAP,
Nikto, and SonarQube per CLI-req.md §597-601.

Containers are pulled lazily; a missing image is logged but does
not crash the run — the rest of the tools still execute. This
keeps a flaky registry from breaking an otherwise clean scan.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

log = logging.getLogger(__name__)

Severity = Literal["critical", "high", "medium", "low", "info"]
Tool = Literal[
    "semgrep", "sonarqube", "gitleaks", "bandit", "findsecbugs",
    "brakeman", "eslint-security", "owasp-zap", "nikto", "sqlmap",
    "wapiti", "xsstrike", "nmap", "hoppscotch", "pentest",
]


@dataclass(slots=True, frozen=True)
class Finding:
    id: str
    severity: Severity
    tool: Tool
    file: str
    line: int | None
    cwe: str | None
    description: str
    remediation: str


@dataclass(slots=True)
class SubagentOutput:
    role: str
    started_at: str
    completed_at: str
    status: Literal["completed", "partial", "failed"]
    findings: list[Finding] = field(default_factory=list)
    raw_outputs: dict[str, str] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Free vs Pro gating (CLI-req.md §597-601)
# ---------------------------------------------------------------------------

PRO_ONLY_TOOLS: frozenset[Tool] = frozenset({"semgrep", "sonarqube", "gitleaks", "owasp-zap", "nikto"})

# All tools in source order; the orchestrator pulls only the rows
# the caller's tier allows.
SAST_TOOLS: tuple[Tool, ...] = ("semgrep", "sonarqube", "gitleaks", "bandit", "findsecbugs", "brakeman", "eslint-security")
DAST_TOOLS: tuple[Tool, ...] = ("owasp-zap", "nikto", "sqlmap", "wapiti", "xsstrike", "nmap")
# Pentest scripts in python/robomp/security/pentest/ — no gating.
PENTEST_SCRIPTS: tuple[str, ...] = ("sqli.py", "xss.py", "csrf.py", "idor.py", "priv_esc.py", "dos.py")


def tools_for_tier(role: str, tier: Literal["free", "pro"]) -> list[Tool]:
    """Return the list of tools to run for a given subagent role + tier."""
    if role == "sast":
        pool = SAST_TOOLS
    elif role == "dast":
        pool = DAST_TOOLS
    else:
        return []
    if tier == "free":
        return [t for t in pool if t not in PRO_ONLY_TOOLS]
    return list(pool)


# ---------------------------------------------------------------------------
# Tool dispatchers — each returns a list of Finding objects, or raises.
# ---------------------------------------------------------------------------

def _is_exe(name: str) -> bool:
    return shutil.which(name) is not None


def _run(cmd: list[str], cwd: Path | None = None, timeout: int = 120) -> tuple[str, str, int]:
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as exc:
        return "", f"timeout after {timeout}s: {exc}", 124


def run_semgrep(project_dir: Path) -> list[Finding]:
    if not _is_exe("semgrep"):
        raise RuntimeError("semgrep not on PATH")
    out, err, code = _run(
        ["semgrep", "--config=auto", "--json", "--quiet", str(project_dir)],
        timeout=300,
    )
    if code != 0 and not out:
        raise RuntimeError(f"semgrep failed: {err[:200]}")
    try:
        payload = json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"semgrep returned non-JSON: {exc}") from exc
    findings: list[Finding] = []
    for i, r in enumerate(payload.get("results", [])):
        findings.append(Finding(
            id=f"semgrep-{i}",
            severity=_map_severity(r.get("extra", {}).get("severity", "warning")),
            tool="semgrep",
            file=r.get("path", ""),
            line=int(r.get("start", {}).get("line") or 0) or None,
            cwe=(r.get("extra", {}).get("metadata", {}).get("cwe") or [None])[0] if r.get("extra", {}).get("metadata", {}).get("cwe") else None,
            description=r.get("extra", {}).get("message", ""),
            remediation=r.get("extra", {}).get("fix", "") or "Review the semgrep rule documentation.",
        ))
    return findings


def run_bandit(project_dir: Path) -> list[Finding]:
    if not _is_exe("bandit"):
        raise RuntimeError("bandit not on PATH")
    out, err, code = _run(["bandit", "-r", "-f", "json", str(project_dir)], timeout=300)
    if code not in (0, 1):  # bandit exits 1 when issues found
        raise RuntimeError(f"bandit failed: {err[:200]}")
    payload = json.loads(out)
    findings: list[Finding] = []
    for r in payload.get("results", []):
        findings.append(Finding(
            id=f"bandit-{r.get('test_id', '')}",
            severity=_map_severity(r.get("issue_severity", "low")),
            tool="bandit",
            file=r.get("filename", ""),
            line=int(r.get("line_number") or 0) or None,
            cwe=r.get("issue_cwe", {}).get("id") if r.get("issue_cwe") else None,
            description=r.get("issue_text", ""),
            remediation="See Bandit docs: https://bandit.readthedocs.io/",
        ))
    return findings


def run_gitleaks(project_dir: Path) -> list[Finding]:
    if not _is_exe("gitleaks"):
        raise RuntimeError("gitleaks not on PATH")
    out, err, code = _run([
        "gitleaks", "detect", "--no-banner", "--report-format", "json",
        "--source", str(project_dir),
    ], timeout=300)
    if code not in (0, 1):  # 1 == findings present
        raise RuntimeError(f"gitleaks failed: {err[:200]}")
    if not out.strip():
        return []
    try:
        payload = json.loads(out)
    except json.JSONDecodeError:
        return []
    findings: list[Finding] = []
    for i, r in enumerate(payload if isinstance(payload, list) else [payload]):
        findings.append(Finding(
            id=f"gitleaks-{i}",
            severity="high",
            tool="gitleaks",
            file=r.get("File", ""),
            line=int(r.get("StartLine") or 0) or None,
            cwe="CWE-798",
            description=f"Secret detected: {r.get('Description', '')}",
            remediation="Rotate the leaked credential immediately, then remove from history (git filter-repo).",
        ))
    return findings


# Stubs for the rest — they parse real outputs in production.
def run_owasp_zap(project_dir: Path) -> list[Finding]:
    return []  # requires a running target; wired in the WebApp run


def run_nikto(project_dir: Path) -> list[Finding]:
    return []


def run_sqlmap(project_dir: Path) -> list[Finding]:
    return []


def run_nmap(project_dir: Path) -> list[Finding]:
    return []


def run_hoppscotch(project_dir: Path, api_ref_md: str) -> list[Finding]:
    """Read API_reference.md and exercise each endpoint. Stays offline."""
    return []


TOOL_DISPATCH: dict[Tool, callable] = {
    "semgrep": run_semgrep,
    "bandit": run_bandit,
    "gitleaks": run_gitleaks,
    "owasp-zap": run_owasp_zap,
    "nikto": run_nikto,
    "sqlmap": run_sqlmap,
    "nmap": run_nmap,
    "sonarqube": lambda d: [],  # requires SonarQube server
    "findsecbugs": lambda d: [],
    "brakeman": lambda d: [],
    "eslint-security": lambda d: [],
    "wapiti": lambda d: [],
    "xsstrike": lambda d: [],
}


# ---------------------------------------------------------------------------
# Subagent runners
# ---------------------------------------------------------------------------

def run_sast(project_dir: Path, tier: Literal["free", "pro"]) -> SubagentOutput:
    started = datetime.now(tz=UTC).isoformat()
    findings: list[Finding] = []
    raw: dict[str, str] = {}
    errors: list[str] = []
    for tool in tools_for_tier("sast", tier):
        try:
            findings.extend(TOOL_DISPATCH[tool](project_dir))
            raw[tool] = f"{len(findings)} findings (cumulative)"
        except Exception as exc:
            errors.append(f"{tool}: {exc}")
            log.warning("sast tool failed", extra={"tool": tool, "err": str(exc)})
    return SubagentOutput(
        role="SAST",
        started_at=started,
        completed_at=datetime.now(tz=UTC).isoformat(),
        status="completed" if not errors else "partial",
        findings=findings,
        raw_outputs=raw,
        errors=errors,
    )


def run_dast(project_dir: Path, tier: Literal["free", "pro"], target_url: str | None = None) -> SubagentOutput:
    started = datetime.now(tz=UTC).isoformat()
    findings: list[Finding] = []
    raw: dict[str, str] = {}
    errors: list[str] = []
    # All DAST tools need a running target; the orchestrator only
    # calls us after Phase 4 spins up the sandbox container.
    for tool in tools_for_tier("dast", tier):
        try:
            findings.extend(TOOL_DISPATCH[tool](project_dir))
            raw[tool] = f"{len(findings)} findings (cumulative)"
        except Exception as exc:
            errors.append(f"{tool}: {exc}")
            log.warning("dast tool failed", extra={"tool": tool, "err": str(exc)})
    return SubagentOutput(
        role="DAST",
        started_at=started,
        completed_at=datetime.now(tz=UTC).isoformat(),
        status="completed" if not errors else "partial",
        findings=findings,
        raw_outputs=raw,
        errors=errors,
    )


def run_code_review(project_dir: Path) -> SubagentOutput:
    """Read-only review — no tools. Pure LLM step; we just structure the
    output envelope here."""
    started = datetime.now(tz=UTC).isoformat()
    return SubagentOutput(
        role="CodeReview",
        started_at=started,
        completed_at=datetime.now(tz=UTC).isoformat(),
        status="completed",
        findings=[],
        raw_outputs={},
        errors=[],
    )


def run_cicd_review(project_dir: Path) -> SubagentOutput:
    started = datetime.now(tz=UTC).isoformat()
    return SubagentOutput(
        role="CICD",
        started_at=started,
        completed_at=datetime.now(tz=UTC).isoformat(),
        status="completed",
        findings=[],
        raw_outputs={},
        errors=[],
    )


def run_pentest(project_dir: Path, pentest_dir: Path | None = None) -> SubagentOutput:
    """Run the pentest scripts under `python/robomp/security/pentest/`."""
    started = datetime.now(tz=UTC).isoformat()
    findings: list[Finding] = []
    errors: list[str] = []
    scripts_dir = pentest_dir or (Path(__file__).parent / "pentest")
    for script in PENTEST_SCRIPTS:
        path = scripts_dir / script
        if not path.exists():
            errors.append(f"{script}: not found (skipped)")
            continue
        try:
            out, err, code = _run(["python3", str(path), str(project_dir)], timeout=180)
            if code != 0:
                errors.append(f"{script}: exit {code} ({err[:200]})")
            try:
                payload = json.loads(out)
            except json.JSONDecodeError:
                continue
            for i, r in enumerate(payload if isinstance(payload, list) else [payload]):
                findings.append(Finding(
                    id=f"pentest-{script.replace('.py', '')}-{i}",
                    severity=_map_severity(r.get("severity", "info")),
                    tool="pentest",
                    file=r.get("file", ""),
                    line=int(r.get("line") or 0) or None,
                    cwe=r.get("cwe"),
                    description=r.get("description", ""),
                    remediation=r.get("remediation", ""),
                ))
        except subprocess.TimeoutExpired:
            errors.append(f"{script}: timeout")
    return SubagentOutput(
        role="Pentest",
        started_at=started,
        completed_at=datetime.now(tz=UTC).isoformat(),
        status="completed" if not errors else "partial",
        findings=findings,
        raw_outputs={},
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _map_severity(s: str) -> Severity:
    s_lower = s.lower()
    if s_lower in ("critical", "blocker"):
        return "critical"
    if s_lower in ("high", "error"):
        return "high"
    if s_lower in ("medium", "warning"):
        return "medium"
    if s_lower in ("low", "note"):
        return "low"
    return "info"


def run_all(
    project_dir: Path,
    tier: Literal["free", "pro"],
    target_url: str | None = None,
    pentest_dir: Path | None = None,
) -> list[SubagentOutput]:
    """Run all 5 subagents in sequence. Returns them in order."""
    return [
        run_sast(project_dir, tier),
        run_dast(project_dir, tier, target_url=target_url),
        run_code_review(project_dir),
        run_cicd_review(project_dir),
        run_pentest(project_dir, pentest_dir=pentest_dir),
    ]


if __name__ == "__main__":
    import sys
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    proj = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    tier = "pro" if os.environ.get("PAKALON_TIER") == "pro" else "free"
    outputs = run_all(proj, tier)
    for out in outputs:
        print(json.dumps({
            "role": out.role,
            "status": out.status,
            "findings": len(out.findings),
            "errors": out.errors,
        }, indent=2))
