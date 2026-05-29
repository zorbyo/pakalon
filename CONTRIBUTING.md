# Contributing to Pakalon

Thank you for your interest in contributing to Pakalon! This guide will help you get started.

## Project Overview

Pakalon is an AI-powered CLI code editor that unifies your AI workflow with seamless authentication and usage tracking. It features a dual-mode architecture:

- **Cloud mode** — Full SaaS platform with Supabase auth, Polar billing, and OpenRouter model proxy
- **Self-hosted mode** — Local deployment with Ollama/LM Studio integration, no auth, works offline

## Monorepo Structure

```
pakalon/
├── pakalon-backend/    # Python 3.12, FastAPI, PostgreSQL/SQLite
├── pakalon-web/        # Next.js 16, Tailwind CSS, Supabase auth
├── pakalon-cli/        # TypeScript/Bun, Ink TUI, 6-phase pipeline
└── specs/              # Design documents and contracts
```

## Development Setup

### Backend

```bash
cd pakalon-backend
uv sync
cp .env.example .env  # or .env.selfhosted.example for local mode
docker compose up -d  # cloud mode only
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

### Web Dashboard

```bash
cd pakalon-web
npm install
npm run dev
```

### CLI

```bash
cd pakalon-cli
bun install
bun dev
```

## Dual-Mode Architecture

Pakalon uses a single codebase with two deployment modes controlled by `PAKALON_MODE`:

| Feature | Cloud (`PAKALON_MODE=cloud`) | Self-Hosted (`PAKALON_MODE=selfhosted`) |
|---------|-------------------------------|------------------------------------------|
| Auth | Supabase JWT (GitHub OAuth) | None (localhost only) |
| Database | PostgreSQL | SQLite |
| Models | OpenRouter proxy | Ollama / LM Studio |
| Billing | Polar | N/A |
| Schedulers | APScheduler + Trigger.dev | Disabled |

When contributing, ensure your changes work in both modes. If a feature is cloud-only, it must be gated behind `settings.is_selfhosted` checks.

## Coding Standards

### Python (Backend)

- **Linting**: `ruff check app/`
- **Formatting**: `ruff format app/`
- **Type hints**: Required for all function signatures
- **Docstrings**: Google-style for public APIs

### TypeScript (Web + CLI)

- **Linting**: ESLint (configured per project)
- **Type checking**: `tsc --noEmit`
- **Formatting**: Prettier (configured per project)

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Ollama model discovery endpoint
fix: resolve SQLite path in self-hosted mode
docs: update SELFHOSTED.md with Docker instructions
test: add self-hosted mode gate tests
```

## Running Tests

### Backend

```bash
cd pakalon-backend
uv run pytest -v                    # All tests
uv run pytest tests/test_selfhosted_mode.py -v  # Self-hosted mode tests
uv run pytest --cov=app --cov-report=html       # With coverage
```

### Web

```bash
cd pakalon-web
npm run build    # Ensures no type errors
```

## Pull Request Process

1. **Fork** the repository
2. **Create a branch** for your feature or fix
3. **Write tests** for new functionality
4. **Ensure CI passes** — lint, type check, and tests
5. **Update documentation** if your change affects setup or usage
6. **Submit a PR** with a clear description of changes

### PR Checklist

- [ ] Code follows project conventions
- [ ] Tests added/updated
- [ ] Documentation updated (SELFHOSTED.md, README.md, etc.)
- [ ] Works in both cloud and self-hosted mode (if applicable)
- [ ] No new dependencies added without justification

## Security

- Report vulnerabilities to security@pakalon.com (not public issues)
- Never commit secrets, API keys, or credentials
- Self-hosted mode has no authentication — do not add cloud auth patterns to it

## License

By contributing, you agree that your contributions will be licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Questions?

- Open a [GitHub Discussion](https://github.com/pakalon/pakalon/discussions) for questions
- Open an [Issue](https://github.com/pakalon/pakalon/issues) for bugs and feature requests
