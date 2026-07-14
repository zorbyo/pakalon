"""Auditor agent bridge endpoint.

The auditor is a read-only LLM call that:
  1. Reads `.pakalon-agents/ai-agents/phase-1/*.md` (14 planning files).
  2. Reads the project tree.
  3. Diffs requirements vs. implementation, producing a table of
     COMPLETE | PARTIAL | MISSING per requirement.
  4. Writes `.pakalon-agents/ai-agents/phase-3/auditor.md`.

The CLI calls `POST /agent/auditor` with the project hash + a
request to iterate. The bridge runs the LLM (or, in offline mode,
falls back to a deterministic stub) and returns the report.

Loop control (HIL ask / YOLO auto-loop) stays on the CLI. The bridge
is a thin compute layer.
"""
from __future__ import annotations

import logging
from typing import Annotated, Awaitable, Callable, Literal, NamedTuple

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, NonNegativeInt

from robomp.bridge.auth import JwtConfig, require_user
from robomp.bridge.store import BridgeStore, UserRow

log = logging.getLogger(__name__)

MAX_ITERATIONS = 10  # spec §273 - YOLO hard cap


AuditorStatus = Literal["clean", "partial", "missing", "failed"]


class AuditorRequest(BaseModel):
	project_hash: str = Field(..., min_length=1, max_length=64)
	project_dir: str | None = None  # absolute path on the CLI host; not used on the bridge
	iteration: NonNegativeInt = 0
	mode: Literal["hil", "yolo"] = "hil"
	max_iterations: NonNegativeInt = 5


class AuditorIteration(BaseModel):
	iteration: int
	status: AuditorStatus
	missing_count: NonNegativeInt
	partial_count: NonNegativeInt
	complete_count: NonNegativeInt


class AuditorResponse(BaseModel):
	user_id: str
	project_hash: str
	iteration: AuditorIteration
	report_md: str
	next_action: Literal["ask", "remediate", "done"]
	question: str | None = None
	options: list[str] | None = None


# LLM abstraction
LLMCallable = Callable[[str, str], Awaitable[str]]


class _Counts(NamedTuple):
	complete: int
	partial: int
	missing: int


def auditor_router(
	store: BridgeStore,
	jwt_cfg: JwtConfig,
	llm_call: LLMCallable | None = None,
) -> APIRouter:
	router = APIRouter(prefix="/agent", tags=["agent"])

	@router.post("/auditor", response_model=AuditorResponse)
	async def run_auditor(
	    req: AuditorRequest,
	    user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> AuditorResponse:
		if req.iteration > req.max_iterations:
			raise HTTPException(
				status.HTTP_400_BAD_REQUEST,
				f"iteration {req.iteration} exceeds max {req.max_iterations}",
			)
		if req.max_iterations > MAX_ITERATIONS:
			raise HTTPException(
				status.HTTP_400_BAD_REQUEST,
				f"max_iterations cannot exceed {MAX_ITERATIONS}",
			)

		report_md, counts = await _run_auditor_iteration(
			llm_call=llm_call,
			iteration=req.iteration,
		)

		status_label: AuditorStatus
		if counts.missing == 0 and counts.partial == 0:
			status_label = "clean"
			next_action: Literal["ask", "remediate", "done"] = "done"
			question = None
			options = None
		else:
			status_label = "partial" if counts.complete > 0 else "missing"
			if req.mode == "yolo":
				next_action = "remediate"
				question = None
				options = None
			else:
				next_action = "ask"
				question = (
					f"{counts.missing} missing and {counts.partial} partial "
					"features found. How should I proceed?"
				)
				options = [
					"Implement all missing and partial features",
					"Do nothing - proceed to phase 4",
					"Implement only the core features",
				]

		store.save_auditor_report(
			user_id=user.user_id,
			project_hash=req.project_hash,
			iteration=req.iteration,
			report_md=report_md,
			status=status_label,
		)

		return AuditorResponse(
			user_id=user.user_id,
			project_hash=req.project_hash,
			iteration=AuditorIteration(
				iteration=req.iteration,
				status=status_label,
				missing_count=counts.missing,
				partial_count=counts.partial,
				complete_count=counts.complete,
			),
			report_md=report_md,
			next_action=next_action,
			question=question,
			options=options,
		)

	@router.get("/auditor/latest")
	async def latest_report(
	    project_hash: str,
	    user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> dict[str, str | int]:
		row = store.latest_auditor(user.user_id, project_hash)
		if row is None:
			raise HTTPException(status.HTTP_404_NOT_FOUND, "no auditor report yet")
		iteration, report_md, status_label = row
		return {
			"iteration": iteration,
			"status": status_label,
			"report_md": report_md,
		}

	return router


async def _run_auditor_iteration(
	llm_call: LLMCallable | None,
	iteration: int,
) -> tuple[str, _Counts]:
	"""Return (report_md, counts). The LLM call is the bridge's job;
	in offline / test mode a deterministic stub is used."""
	system_prompt = (
		"You are the Pakalon auditor. Compare the user's phase-1 "
		"requirements to the current codebase. Produce a markdown "
		"report with a table of COMPLETE | PARTIAL | MISSING features."
	)
	user_prompt = f"Run iteration {iteration} of the auditor."

	if llm_call is None:
		# Offline / no-LLM stub. Produces a well-formed report with all
		# features MISSING so the HIL flow proceeds and the YOLO flow
		# dispatches remediators. Real bridges override this.
		report = _stub_report(iteration)
		counts = _Counts(complete=0, partial=0, missing=5)
		return report, counts

	raw = await llm_call(system_prompt, user_prompt)
	counts = _parse_counts(raw)
	return raw, counts


def _stub_report(iteration: int) -> str:
	# Use chr(10) for newlines to avoid Python source-escape ambiguity.
	nl = chr(10)
	rows = [
		"| Feature | Status | Notes |",
		"|---------|--------|-------|",
		"| Login | MISSING | not yet implemented |",
		"| Dashboard | MISSING | not yet implemented |",
		"| User profile | MISSING | not yet implemented |",
		"| Settings | MISSING | not yet implemented |",
		"| Logout | MISSING | not yet implemented |",
	]
	recs = [
		"- Begin phase 3 subagent 1 to scaffold the frontend.",
		"- Begin phase 3 subagent 2 to scaffold the backend.",
	]
	body = nl.join(rows) + nl + nl + "## Recommendations" + nl + nl + nl.join(recs)
	return f"# Auditor Report (iteration {iteration})" + nl + nl + "## Feature Completeness" + nl + nl + body + nl


def _parse_counts(report_md: str) -> _Counts:
	complete = report_md.lower().count("| complete")
	partial = report_md.lower().count("| partial")
	missing = report_md.lower().count("| missing")
	return _Counts(complete=complete, partial=partial, missing=missing)


def _dep(store: BridgeStore, jwt_cfg: JwtConfig):
	def _resolve(
	    authorization: Annotated[str | None, Header()] = None,
	) -> UserRow:
		return require_user(authorization=authorization, store=store, jwt_cfg=jwt_cfg)
	return _resolve
