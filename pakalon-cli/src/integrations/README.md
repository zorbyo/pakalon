# Pakalon Integrations

This directory contains integrations from the "everything-claude-code" repository, adapted for Pakalon.

## Structure

```
integrations/
├── skills/          # 109 workflow skills and domain knowledge
├── commands/        # 57 slash commands
├── rules/           # Always-follow guidelines (common + per-language)
├── hooks/           # Trigger-based automations
├── schemas/         # JSON schemas for configuration
└── agents/          # Specialized subagents
```

## Available Skills

### Coding & Development
- `coding-standards/` - Universal coding standards
- `tdd-workflow/` - Test-driven development
- `security-review/` - Security checklist
- `api-design/` - REST API design patterns
- `database-migrations/` - Migration patterns
- `deployment-patterns/` - CI/CD, Docker, health checks

### Frontend
- `frontend-patterns/` - React/Next.js patterns
- `frontend-slides/` - HTML presentations
- `nextjs-turbopack/` - Next.js Turbopack optimization

### Backend
- `backend-patterns/` - API, database, caching
- `docker-patterns/` - Docker Compose patterns
- `postgres-patterns/` - PostgreSQL optimization

### Languages
- `golang-patterns/` - Go idioms and best practices
- `golang-testing/` - Go testing patterns
- `python-patterns/` - Python idioms
- `python-testing/` - Python testing with pytest
- `springboot-patterns/` - Java Spring Boot patterns
- `django-patterns/` - Django patterns
- `laravel-patterns/` - Laravel patterns
- `kotlin-patterns/` - Kotlin patterns
- `swift-actor-persistence/` - Swift actor patterns
- `rust-patterns/` - Rust patterns

### AI & Agents
- `agentic-engineering/` - AI agent engineering
- `autonomous-loops/` - Autonomous loop patterns
- `continuous-learning-v2/` - Instinct-based learning
- `eval-harness/` - Verification loop evaluation

### Business
- `article-writing/` - Long-form writing
- `content-engine/` - Multi-platform content
- `market-research/` - Market research
- `investor-materials/` - Pitch decks, memos
- `investor-outreach/` - Fundraising outreach

## Available Commands

- `/plan` - Implementation planning
- `/tdd` - Test-driven development
- `/code-review` - Code quality review
- `/build-fix` - Fix build errors
- `/e2e` - E2E test generation
- `/refactor-clean` - Dead code removal
- `/verify` - Verification loop
- `/eval` - Evaluation against criteria
- `/sessions` - Session history
- `/skill-create` - Generate skills from git

## Rules

### Common Rules (Language-Agnostic)
- `common/coding-style.md` - Immutability, file organization
- `common/git-workflow.md` - Commit format, PR process
- `common/testing.md` - TDD, 80% coverage
- `common/performance.md` - Model selection, context management
- `common/patterns.md` - Design patterns
- `common/security.md` - Security checks

### Language-Specific Rules
- `typescript/` - TypeScript/JavaScript patterns
- `python/` - Python patterns
- `golang/` - Go patterns
- `swift/` - Swift patterns
- `php/` - PHP patterns
- `java/` - Java patterns
- `kotlin/` - Kotlin patterns
- `cpp/` - C++ patterns
- `perl/` - Perl patterns

## Usage

These integrations are automatically loaded by Pakalon CLI. Use the slash commands to access the functionality:

```bash
/pakalon plan "Add user authentication"
/pakalon tdd
/pakalon code-review
```

## Configuration

The hooks and rules are configured in:
- `hooks/hooks.json` - Hook configurations
- `rules/common/` - Common rules
- `rules/typescript/` - TypeScript rules

## Customization

You can customize these integrations by modifying the files in this directory. Changes will be picked up on the next Pakalon CLI restart.
