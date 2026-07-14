import asyncio
import os
import shlex
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(title="Pakalon Python Bridge", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AgentRequest(BaseModel):
    prompt: str
    context: dict[str, Any] = Field(default_factory=dict)


class PenpotStatusRequest(BaseModel):
    url: str = "http://localhost:3449"


class WorkRequest(BaseModel):
    command: str
    cwd: str | None = None
    env: dict[str, str] = Field(default_factory=dict)


class WorkResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "agents": ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"],
    }


@app.post("/agent/{phase}")
async def call_agent(phase: int, body: AgentRequest) -> dict[str, Any]:
    return {
        "result": f"Stub LangGraph response for phase {phase}: {body.prompt[:120]}",
        "artifacts": [f"phase-{phase}-artifact.txt"],
    }


@app.post("/penpot/status")
async def penpot_status(body: PenpotStatusRequest) -> dict[str, Any]:
    return {
        "connected": True,
        "url": body.url,
        "message": "Stub Penpot bridge status",
    }


@app.post("/penpot/sync/start")
async def penpot_sync_start() -> dict[str, Any]:
    return {
        "started": True,
        "message": "Stub Penpot sync started",
    }


@app.post("/penpot/sync/stop")
async def penpot_sync_stop() -> dict[str, Any]:
    return {
        "stopped": True,
        "message": "Stub Penpot sync stopped",
    }


@app.post("/work", response_model=WorkResponse)
async def execute_work(body: WorkRequest) -> WorkResponse:
    """Execute a shell command and return the result."""
    cwd = body.cwd or os.getcwd()
    env = os.environ.copy()
    env.update(body.env)

    try:
        process = await asyncio.create_subprocess_shell(
            body.command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=env,
        )
        stdout, stderr = await process.communicate()
        return WorkResponse(
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
            exit_code=process.returncode or 0,
        )
    except Exception as e:
        return WorkResponse(
            stdout="",
            stderr=str(e),
            exit_code=1,
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=7432)
