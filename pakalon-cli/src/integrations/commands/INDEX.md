# Pakalon Commands Index

This file lists all available commands in the Pakalon integrations.

## Development Commands
- `/plan` - Create implementation plan
- `/tdd` - Enforce TDD workflow
- `/code-review` - Review code changes
- `/build-fix` - Fix build errors
- `/e2e` - Generate E2E tests
- `/refactor-clean` - Remove dead code
- `/verify` - Run verification loop
- `/eval` - Evaluate against criteria

## Language-Specific Commands
- `/go-review` - Go code review
- `/go-test` - Go TDD workflow
- `/go-build` - Fix Go build errors
- `/python-review` - Python code review
- `/cpp-review` - C++ code review
- `/cpp-build` - Fix C++ build errors
- `/cpp-test` - C++ TDD workflow
- `/rust-review` - Rust code review
- `/rust-build` - Fix Rust build errors
- `/rust-test` - Rust TDD workflow
- `/kotlin-review` - Kotlin code review
- `/kotlin-build` - Fix Kotlin build errors
- `/kotlin-test` - Kotlin TDD workflow

## Multi-Agent Commands
- `/multi-plan` - Multi-agent task decomposition
- `/multi-execute` - Orchestrated multi-agent workflows
- `/multi-backend` - Backend multi-service orchestration
- `/multi-frontend` - Frontend multi-service orchestration
- `/multi-workflow` - General multi-service workflows
- `/orchestrate` - Multi-agent coordination

## Session Management
- `/sessions` - Session history management
- `/save-session` - Save current session
- `/resume-session` - Resume saved session

## Learning & Skills
- `/learn` - Extract patterns from session
- `/learn-eval` - Extract and evaluate patterns
- `/skill-create` - Generate skills from git
- `/skill-health` - Check skill health
- `/instinct-status` - View learned instincts
- `/instinct-import` - Import instincts
- `/instinct-export` - Export instincts
- `/evolve` - Cluster instincts into skills
- `/promote` - Promote project instincts

## Quality & Testing
- `/test-coverage` - Test coverage analysis
- `/quality-gate` - Run quality gate checks
- `/harness-audit` - Audit harness reliability
- `/model-route` - Route tasks to models

## Documentation
- `/update-docs` - Update documentation
- `/update-codemaps` - Update codemaps
- `/docs` - Documentation lookup

## Configuration
- `/setup-pm` - Configure package manager
- `/checkpoint` - Save verification state
- `/projects` - List known projects
- `/prompt-optimize` - Optimize prompts

## Service Management
- `/pm2` - PM2 service lifecycle management
- `/loop-start` - Start controlled agentic loop
- `/loop-status` - Inspect active loop status

## Other
- `/aside` - Side conversation
- `/claw` - Claw operations
- `/devfleet` - Dev fleet management
- `/gradle-build` - Gradle build operations

## Total Commands: 57

## Usage

Use these commands via Pakalon CLI:
```bash
/pakalon <command> [options]
```

Example:
```bash
/pakalon plan "Add user authentication"
/pakalon tdd
/pakalon code-review
```
