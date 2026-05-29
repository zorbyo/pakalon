# Pakalon Implementation Tasks

Scope: implement the report inside `pakalon-cli/` and `pakalon-backend/` only. `pakalon-web/` is intentionally out of scope.

## Current Scan

- Already present: self-hosted mode detection, local Ollama/LM Studio discovery, login skip in self-hosted mode, `/build`, `/connect-end`, model refresh, Polar billing, usage tracking models, Telegram token storage, phase agent folders, and base compaction commands.
- Missing or shallow: microcompact, snip compact, context collapse, session-memory compaction fallback, cache-aware token counting sibling handling, robust tool-result budgeting, query pre-processing, Phase 1 document generation depth, Phase 4 scanner orchestration, and compile-surface stability for report-era modules.

## Workstreams

1. Token reduction foundation
   - [x] Add API-safe message normalization, token accounting, pressure thresholds.
   - [x] Add microcompact for old tool results.
   - [x] Add snip compact for oldest API-round groups.
   - [x] Add session-memory compaction fallback.
   - [x] Add context-collapse projections for search/read/list tool output.
   - [x] Enforce per-tool `maxResultSizeChars` before tool results enter chat history.

2. Query engine integration
   - [x] Preprocess chat runtime messages with session memory, microcompact, snip, and context collapse before model calls.
   - [x] Preserve recent turns and system prompt.
   - [x] Keep compaction circuit breaker state to avoid retry loops.
   - [x] Record actual usage where providers return it, and estimate only the tail.

3. Self-hosted hardening
   - [x] Keep auth, telemetry, billing, Redis, and cloud model calls disabled in self-hosted backend mode.
   - [x] Keep CLI model listings local-only in self-hosted mode.
   - [x] Keep cloud mode behavior unchanged.

4. Phase pipeline completion
   - [x] Phase 1: interactive Q&A and required planning docs.
   - [x] Phase 2: Penpot bridge exports and screenshot comparison hooks.
   - [x] Phase 3: frontend, backend, integration, auditor, and testing briefs.
   - [x] Phase 4: SAST/DAST scanner orchestration and XML reports with deterministic local findings.
   - [x] Phase 5: CI/CD and deployment decision helpers.
   - [x] Phase 6: project documentation generation.

5. Backend support
   - [x] Preserve daily model refresh and admin refresh endpoint.
   - [x] Preserve post-paid Polar estimates with deposit and platform fee.
   - [x] Add focused tests whenever an endpoint or billing/model contract changes.

## Verification

- CLI: `bun run type-check`, targeted Vitest suites for token reduction and command registry.
- Backend: focused pytest suites for models, self-hosted mode, billing, and usage.
- No writes to `pakalon-web/`.
