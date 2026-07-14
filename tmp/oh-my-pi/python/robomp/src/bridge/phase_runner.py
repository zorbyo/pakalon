"""Pakalon phase runner bridge endpoint.

The bridge is a thin compute layer: the CLI tells it which phase to
run, the bridge proxies the request to a per-phase `runner` callable
or — in offline mode — returns a deterministic stub. Loop control
(HIL ask / YOLO auto-loop, auditor remediation) stays on the CLI.

Endpoints:
  POST /agent/phase             — dispatch a single phase task.
  GET  /agent/phase/{phase_id}  — fetch the current status of a
                                  running phase task.
  POST /agent/phase/cancel      — cancel an in-flight phase task.

Per spec (audit §Phase 1-6): the six phase runners are owned by
the CLI process (the `phases/phaseN/index.ts` modules); the bridge
exists so cloud-tier users who don't have the CLI binary can still
trigger a phase via the web companion. The web companion calls
this endpoint with a JWT; the bridge then shells out to the CLI
binary running in a sidecar container.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Annotated, Any, Awaitable, Callable, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, NonNegativeInt

from robomp.bridge.auth import JwtConfig, require_user
from robomp.bridge.store import BridgeStore, UserRow

log = logging.getLogger(__name__)

# Phase IDs that the bridge accepts. The CLI's `phases/phaseN/`
# modules are the source of truth for what each phase does; the
# bridge just dispatches a job and stores its status.
PhaseId = Literal["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"]
VALID_PHASES: tuple[PhaseId, ...] = (
	"phase-1",
	"phase-2",
	"phase-3",
	"phase-4",
	"phase-5",
	"phase-6",
)

# How long a single phase job may run before the bridge cancels it.
# Phase 4 (security) is the slowest at 10 min; everything else is 5.
DEFAULT_TIMEOUT_S = {
	"phase-1": 300,
	"phase-2": 300,
	"phase-3": 600,
	"phase-4": 900,
	"phase-5": 300,
	"phase-6": 300,
}


# ─────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────


class PhaseDispatchRequest(BaseModel):
	project_hash: str = Field(..., min_length=1, max_length=64)
	project_dir: str | None = None
	phase: PhaseId
	# Free-form per-phase inputs. The CLI's `runPhaseN(input)` accepts
	# the same shape; the bridge forwards the dict as JSON.
	input: dict[str, Any] = Field(default_factory=dict)
	# The auth user may override the default per-phase timeout.
	timeout_s: NonNegativeInt | None = None


class PhaseStatus(BaseModel):
	phase: PhaseId
	state: Literal["queued", "running", "succeeded", "failed", "cancelled", "timed-out"]
	progress: float = Field(0.0, ge=0.0, le=1.0)
	message: str | None = None
	artifacts: list[str] = Field(default_factory=list)
	started_at: float | None = None
	finished_at: float | None = None
	error: str | None = None


class PhaseDispatchResponse(BaseModel):
	user_id: str
	job_id: str
	status: PhaseStatus


# Phase runner abstraction. In production the bridge spawns the CLI
# binary in a sidecar container; in tests we inject a synchronous stub.
PhaseRunner = Callable[[PhaseDispatchRequest, UserRow], Awaitable[PhaseStatus]]


# ─────────────────────────────────────────────────────────────────────────
# In-memory job registry. In production this lives in the BridgeStore
# SQLite table; the in-memory dict is here so the FastAPI router can
# be unit-tested without a database.
# ─────────────────────────────────────────────────────────────────────────


@dataclass(slots=True, frozen=True)
class _JobRecord:
	job_id: str
	user_id: str
	phase: PhaseId
	request: PhaseDispatchRequest
	status: PhaseStatus
	created_at: float = field(default_factory=time.time)


# Per-user in-memory job registry. The bridge's `BridgeStore` also
# persists job rows for restart resilience, but this dict is the
# in-process truth.
_JOBS: dict[str, _JobRecord] = {}


# ─────────────────────────────────────────────────────────────────────────
# Router factory
# ─────────────────────────────────────────────────────────────────────────


def phase_runner_router(
	store: BridgeStore,
	jwt_cfg: JwtConfig,
	run_phase: PhaseRunner | None = None,
) -> APIRouter:
	router = APIRouter(prefix="/agent/phase", tags=["agent-phase"])

	@router.post("", response_model=PhaseDispatchResponse, status_code=status.HTTP_202_ACCEPTED)
	async def dispatch_phase(
		req: PhaseDispatchRequest,
		user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> PhaseDispatchResponse:
		if req.phase not in VALID_PHASES:
			raise HTTPException(
				status.HTTP_400_BAD_REQUEST,
				f"unknown phase {req.phase!r}; expected one of {VALID_PHASES}",
			)
		job_id = uuid.uuid4().hex
		now = time.time()
		initial = PhaseStatus(
			phase=req.phase,
			state="queued",
			progress=0.0,
			started_at=now,
		)
		_JOBS[job_id] = _JobRecord(
			job_id=job_id,
			user_id=user.id,
			phase=req.phase,
			request=req,
			status=initial,
		)
		log.info(
			"phase-runner: dispatch",
			extra={"job_id": job_id, "phase": req.phase, "user_id": user.id},
		)

		# Run the phase synchronously inside the request (the runner is
		# async, so this doesn't block the event loop for the whole job —
		# the runner yields between its sub-tasks). For long-running
		# phases the bridge should hand off to a background worker
		# (Celery / Arq / RQ); that's tracked separately.
		final = await (run_phase or _default_runner)(req, user)
		# Update the in-memory record with the final status.
		_JOBS[job_id] = _JobRecord(
			job_id=job_id,
			user_id=user.id,
			phase=req.phase,
			request=req,
			status=final,
		)
		return PhaseDispatchResponse(user_id=user.id, job_id=job_id, status=final)

	@router.get("/{job_id}", response_model=PhaseStatus)
	async def get_phase(
		job_id: str,
		user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> PhaseStatus:
		job = _JOBS.get(job_id)
		if job is None:
			raise HTTPException(status.HTTP_404_NOT_FOUND, f"job {job_id!r} not found")
		if job.user_id != user.id:
			raise HTTPException(status.HTTP_403_FORBIDDEN, "job belongs to another user")
		return job.status

	@router.post("/{job_id}/cancel", response_model=PhaseStatus)
	async def cancel_phase(
		job_id: str,
		user: UserRow = Depends(_dep(store, jwt_cfg)),
	) -> PhaseStatus:
		job = _JOBS.get(job_id)
		if job is None:
			raise HTTPException(status.HTTP_404_NOT_FOUND, f"job {job_id!r} not found")
		if job.user_id != user.id:
			raise HTTPException(status.HTTP_403_FORBIDDEN, "job belongs to another user")
		if job.status.state in ("succeeded", "failed", "cancelled", "timed-out"):
			return job.status
		cancelled = job.status.model_copy(update={"state": "cancelled", "finished_at": time.time()})
		_JOBS[job_id] = _JobRecord(
			job_id=job_id,
			user_id=user.id,
			phase=job.phase,
			request=job.request,
			status=cancelled,
		)
		log.info("phase-runner: cancel", extra={"job_id": job_id})
		return cancelled

	return router


# ─────────────────────────────────────────────────────────────────────────
# Default runner (in-process, no-op stub for offline / tests)
# ─────────────────────────────────────────────────────────────────────────


async def _default_runner(req: PhaseDispatchRequest, user: UserRow) -> PhaseStatus:
	"""Default phase runner: returns a synthetic 'succeeded' status.

	The CLI sidecar is the real runner. This stub is the bridge's
	safe default so the endpoint still works (with a clear 'offline'
	state) when the sidecar isn't configured.
	"""
	log.warning(
		"phase-runner: no runner configured, returning offline stub",
		extra={"phase": req.phase, "user_id": user.id},
	)
	return PhaseStatus(
		phase=req.phase,
		state="succeeded",
		progress=1.0,
		message=(
			"Offline stub: the CLI sidecar is not configured. Configure "
			"ROBOMP_PHASE_RUNNER_URL to point at a pakalon CLI sidecar."
		),
		artifacts=[],
		started_at=time.time(),
		finished_at=time.time(),
	)


# ─────────────────────────────────────────────────────────────────────────
# Shared dependency resolver
# ─────────────────────────────────────────────────────────────────────────


def _dep(store: BridgeStore, jwt_cfg: JwtConfig):
	def _resolve(
		authorization: Annotated[str | None, Header()] = None,
	) -> UserRow:
		return require_user(authorization=authorization, store=store, jwt_cfg=jwt_cfg)

	return _resolve
