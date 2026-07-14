# Changelog

All notable changes to `@pakalon/tanstack-adapter` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `createPakalonChatClient(opts)` — Tanstack-AI-compatible streaming chat client backed by the Pakalon backend.
- `listPakalonModels(client, tier)` — tier-aware (free/pro) OpenRouter model catalog, sorted newest-first.
- `resolveAutoModel(models)` — picks the highest-context, lowest-cost model.
- Privacy mode: when `privacyMode: true` is set on the client, every request includes `X-Provider-No-Train: true`.
- `abort()` on the chat client cancels in-flight requests via `AbortController`.
- SSE parsing with backpressure-safe stream consumption.
- `timeoutMs` per-request timeout (default 90s).
