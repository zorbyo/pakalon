# Self-hosted Pakalon (Coolify + Caddy)

Per CLI-req.md §707-713, Pakalon can run in two modes:

| Mode       | Auth  | Models                | Network |
|------------|-------|----------------------|---------|
| **cloud**  | required (Clerk) | OpenRouter (master key) | online |
| **selfhosted** | skipped | Ollama / LM Studio only | offline-capable |

This document covers the selfhosted mode.

## Quick start (manual)

```sh
# 1. install Ollama (or LM Studio)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1
ollama pull qwen2.5-coder:7b

# 2. install Pakalon
bun install -g pakalon

# 3. run in selfhosted mode
PAKALON_MODE=selfhosted pakalon
# or, equivalently:
PAKALON_SELF_HOSTED=1 pakalon
```

When `PAKALON_MODE=selfhosted` is set, the pre-launch auth gate
returns `skipped: true, reason: "self-hosted"`, no 6-digit code is
shown, and the registry returns only Ollama / LM Studio models.

## Coolify deployment

The repo ships a Coolify-friendly stack at the root:

- `docker-compose.selfhosted.yml` — Postgres + Supabase-compatible auth
  + Pakalon + Caddy reverse proxy
- `Caddyfile.selfhosted` — auto-TLS via Let's Encrypt

```sh
git clone https://github.com/your-fork/pakalon-cli.git
cd pakalon-cli

# Point Coolify at docker-compose.selfhosted.yml.
# Set the following environment variables in the Coolify UI:
#   PAKALON_MODE=selfhosted
#   OLLAMA_HOST=http://ollama:11434
#   SUPABASE_URL=https://auth.example.com
#   SUPABASE_SERVICE_ROLE_KEY=...
#   CLERK_SECRET_KEY=...   (optional, only for non-selfhosted services)
```

Coolify will:
1. Build the `Dockerfile` (multi-stage bun + Rust native addon).
2. Bring up Postgres, Caddy, Ollama, and the Pakalon container.
3. Wire DNS + Let's Encrypt via Caddy.

## Verifying self-hosted mode

```sh
PAKALON_MODE=selfhosted pakalon --smoke-test
```

Expected output:
- Banner renders with the `[selfhost]` marker.
- `/models` shows only Ollama / LM Studio entries.
- No 6-digit code, no network calls to OpenRouter.
- `/upgrade` returns the local URL (or `https://pakalon.dev/upgrade`
  as a default fallback).

## Tier-gated features in self-hosted

| Feature                | cloud | selfhosted |
|------------------------|-------|------------|
| OpenRouter model catalog | yes   | no         |
| Ollama / LM Studio      | no    | yes        |
| Polar billing            | yes   | no         |
| Dunning emails           | yes   | no         |
| Pro-only MCPs (Playwright, Chrome DevTools, Vercel agent-browser, Firecrawl) | yes | opt-in (run `OLLAMA_HOST=… /mcp add chrome-devtools`) |
| Phase 4 SAST/DAST Docker tools | yes | yes (Docker is the only dep) |
| 6-phase SDLC pipeline    | yes   | yes        |
| Telemetry (machineId)    | yes   | yes (local-only) |

## Disabling telemetry

For fully air-gapped self-hosted deployments, set:

```json
// .pakalon/settings.local.json
{
  "privacy": { "enabled": true }
}
```

This stops the LLM call from sending `store: false, training: false`
and the telemetry event stream is paused.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Banner still shows `[not-signed-in]` | Check that `PAKALON_MODE` is exported in the same shell. |
| `/models` is empty | Make sure Ollama is running and `OLLAMA_HOST` is reachable. |
| Docker phase 4 tools fail | Install Docker ≥ 24 on the host. |
| Caddy fails to obtain a cert | Make sure ports 80 and 443 are open to the internet. |
| Web search returns 401 | Self-hosted web search is not supported; use local-context search. |
