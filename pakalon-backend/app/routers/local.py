"""Local endpoints for self-hosted deployments — proxies to Ollama and LM Studio."""

import logging
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/local", tags=["local"])

# Default local provider URLs
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_LMSTUDIO_URL = "http://localhost:1234"


class LocalModel(BaseModel):
    """A model discovered from a local provider."""

    id: str
    name: str
    provider: Literal["ollama", "lmstudio"]
    base_url: str
    context_window: int = 32768
    parameters: str | None = None
    quantization: str | None = None
    family: str | None = None


class LocalProviderStatus(BaseModel):
    """Status of a single local provider."""

    name: Literal["ollama", "lmstudio"]
    base_url: str
    enabled: bool
    available: bool
    model_count: int = 0
    error: str | None = None


class ProviderConfigs(BaseModel):
    """Configuration for local providers from environment/config."""

    ollama_url: str
    ollama_enabled: bool
    lmstudio_url: str
    lmstudio_enabled: bool


def get_provider_config() -> ProviderConfigs:
    """Get local provider configuration from settings or defaults."""
    settings = get_settings()

    return ProviderConfigs(
        ollama_url=settings.local_ollama_url or DEFAULT_OLLAMA_URL,
        ollama_enabled=settings.local_ollama_enabled,
        lmstudio_url=settings.local_lmstudio_url or DEFAULT_LMSTUDIO_URL,
        lmstudio_enabled=settings.local_lmstudio_enabled,
    )


async def discover_ollama_models(base_url: str) -> list[LocalModel]:
    """Discover models from Ollama's /api/tags endpoint."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{base_url.rstrip('/')}/api/tags")
            if response.status_code != 200:
                logger.warning(f"Ollama discovery failed: HTTP {response.status_code}")
                return []

            data = response.json()
            models = []
            for model in data.get("models", []):
                details = model.get("details", {})
                models.append(
                    LocalModel(
                        id=f"ollama:{model['name']}",
                        name=model["name"],
                        provider="ollama",
                        base_url=base_url,
                        context_window=details.get("context_length", 32768),
                        parameters=details.get("parameter_size"),
                        quantization=details.get("quantization_level"),
                        family=details.get("family"),
                    )
                )
            return models
    except Exception as e:
        logger.warning(f"Ollama discovery failed: {e}")
        return []


async def discover_lmstudio_models(base_url: str) -> list[LocalModel]:
    """Discover models from LM Studio's /v1/models endpoint."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{base_url.rstrip('/')}/v1/models")
            if response.status_code != 200:
                logger.warning(f"LM Studio discovery failed: HTTP {response.status_code}")
                return []

            data = response.json()
            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")
                context_length = model.get("max_context_length") or model.get("context_length", 32768)
                # Infer parameters from model ID (e.g., "7b", "13b", "70b")
                import re
                param_match = re.search(r"(\d+(?:\.\d+)?b)", model_id, re.IGNORECASE)
                parameters = param_match.group(1).upper() if param_match else None

                models.append(
                    LocalModel(
                        id=f"lmstudio:{model_id}",
                        name=model_id,
                        provider="lmstudio",
                        base_url=base_url,
                        context_window=context_length,
                        parameters=parameters,
                        family=model.get("owned_by"),
                    )
                )
            return models
    except Exception as e:
        logger.warning(f"LM Studio discovery failed: {e}")
        return []


async def check_provider_health(base_url: str) -> tuple[bool, str | None]:
    """Check if a provider is reachable and return (available, error)."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Try Ollama endpoint first
            response = await client.get(f"{base_url.rstrip('/')}/api/tags")
            if response.status_code == 200:
                return True, None
            # If Ollama endpoint fails, try LM Studio OpenAI-compatible endpoint
            response = await client.get(f"{base_url.rstrip('/')}/v1/models")
            if response.status_code == 200:
                return True, None
            return False, f"HTTP {response.status_code}"
    except Exception as e:
        return False, str(e)


# ─────────────────────────────────────────────────────────────────────────────
# Router Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/health")
async def local_health() -> dict[str, str]:
    """Self-hosted health check endpoint."""
    settings = get_settings()
    return {
        "mode": settings.pakalon_mode,
        "status": "ok",
        "service": "pakalon-backend",
    }


@router.post("/sync")
async def local_sync(payload: dict[str, Any]) -> dict[str, Any]:
    """Echo back sync payload (for CLI connectivity verification)."""
    return {
        "mode": "selfhosted",
        "synced": True,
        "received_keys": sorted(payload.keys()),
    }


@router.get("/providers")
async def get_local_providers() -> dict[str, Any]:
    """
    List configured local providers and their status.
    Returns availability information for each provider.
    """
    config = get_provider_config()
    result: dict[str, Any] = {"providers": [], "mode": "selfhosted"}

    # Check Ollama
    ollama_available = False
    ollama_model_count = 0
    ollama_error: str | None = None

    if config.ollama_enabled:
        is_available, err = await check_provider_health(config.ollama_url)
        if is_available:
            ollama_available = True
            models = await discover_ollama_models(config.ollama_url)
            ollama_model_count = len(models)
        else:
            ollama_error = err

    result["providers"].append(
        LocalProviderStatus(
            name="ollama",
            base_url=config.ollama_url,
            enabled=config.ollama_enabled,
            available=ollama_available,
            model_count=ollama_model_count,
            error=ollama_error,
        ).model_dump()
    )

    # Check LM Studio
    lmstudio_available = False
    lmstudio_model_count = 0
    lmstudio_error: str | None = None

    if config.lmstudio_enabled:
        is_available, err = await check_provider_health(config.lmstudio_url)
        if is_available:
            lmstudio_available = True
            models = await discover_lmstudio_models(config.lmstudio_url)
            lmstudio_model_count = len(models)
        else:
            lmstudio_error = err

    result["providers"].append(
        LocalProviderStatus(
            name="lmstudio",
            base_url=config.lmstudio_url,
            enabled=config.lmstudio_enabled,
            available=lmstudio_available,
            model_count=lmstudio_model_count,
            error=lmstudio_error,
        ).model_dump()
    )

    return result


@router.get("/models")
async def get_local_models() -> dict[str, Any]:
    """
    Discover and return all available local models from Ollama and LM Studio.
    Returns a unified list of models with their metadata.
    """
    config = get_provider_config()
    all_models: list[LocalModel] = []

    # Discover from Ollama if enabled
    if config.ollama_enabled:
        try:
            models = await discover_ollama_models(config.ollama_url)
            all_models.extend(models)
        except Exception as e:
            logger.warning(f"Failed to discover ollama models: {e}")

    # Discover from LM Studio if enabled
    if config.lmstudio_enabled:
        try:
            models = await discover_lmstudio_models(config.lmstudio_url)
            all_models.extend(models)
        except Exception as e:
            logger.warning(f"Failed to discover lmstudio models: {e}")

    return {
        "mode": "selfhosted",
        "models": [m.model_dump() for m in all_models],
        "total": len(all_models),
    }


class ChatMessage(BaseModel):
    """A single chat message."""

    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    """Request body for /local/chat endpoint."""

    model: str  # e.g., "ollama:llama3" or "lmstudio:codellama-7b"
    messages: list[ChatMessage]
    system: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None


@router.post("/chat")
async def local_chat(request: ChatRequest) -> StreamingResponse:
    """
    Proxy chat completion request to the appropriate local provider (Ollama or LM Studio).
    Supports streaming responses via text/event-stream.
    """

    # Parse the model ID to determine provider
    if ":" not in request.model:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model ID format: {request.model}. Expected format: 'provider:model-name' (e.g., 'ollama:llama3')",
        )

    provider, model_name = request.model.split(":", 1)
    if provider not in ("ollama", "lmstudio"):
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider: {provider}. Supported providers: ollama, lmstudio",
        )

    config = get_provider_config()
    base_url = config.ollama_url if provider == "ollama" else config.lmstudio_url

    # Build the request payload for the provider
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    if request.system:
        messages.insert(0, {"role": "system", "content": request.system})

    headers = {"Content-Type": "application/json"}
    timeout = httpx.Timeout(60.0, connect=10.0)

    try:
        temperature = request.temperature if request.temperature is not None else 0.7
        max_tokens = request.max_tokens if request.max_tokens is not None else 4096

        if provider == "ollama":
            # Ollama uses /api/chat
            payload = {
                "model": model_name,
                "messages": messages,
                "stream": True,
                "options": {
                    "temperature": temperature,
                    "num_predict": max_tokens,
                },
            }
            url = f"{base_url.rstrip('/')}/api/chat"
        else:
            # LM Studio uses OpenAI-compatible /v1/chat/completions
            payload = {
                "model": model_name,
                "messages": messages,
                "stream": True,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            url = f"{base_url.rstrip('/')}/v1/chat/completions"

        async def stream_response():
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_detail = await response.aread()
                        raise HTTPException(
                            status_code=502,
                            detail=f"Local provider error: HTTP {response.status_code} - {error_detail.decode()}",
                        )

                    # Stream the response back
                    async for line in response.aiter_lines():
                        if line.strip():
                            if provider == "ollama":
                                # Ollama sends JSON lines with message.content
                                yield f"data: {line}\n\n"
                            else:
                                # LM Studio sends SSE-formatted data:
                                # data: {"choices":[...]}
                                if line.startswith("data:"):
                                    yield f"{line}\n\n"
                                elif line:  # Some providers send raw JSON
                                    yield f"data: {line}\n\n"

                yield "data: [DONE]\n\n"

        return StreamingResponse(
            stream_response(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Provider": provider,
                "X-Model": model_name,
            },
        )

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Local provider timed out")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Local chat proxy failed: {e}")
        raise HTTPException(status_code=500, detail=f"Local chat proxy failed: {str(e)}")
