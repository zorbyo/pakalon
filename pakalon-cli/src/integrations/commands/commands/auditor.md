# Auditor

Comprehensive codebase analysis and comparison tool. Scans your project structure, detects technologies, analyzes code quality, and provides actionable recommendations.

## Usage

```
/auditor [scope]
```

Where `scope` is one of:
- `full` - Complete codebase analysis (default)
- `security` - Security-focused scan
- `quality` - Code quality metrics
- `structure` - Project structure analysis
- `tech` - Technology detection

## What It Analyzes

### 1. Project Structure
- Directory tree depth and organization
- Monorepo detection (Nx, Turborepo, PNPM workspaces)
- Package manager detection (npm, pnpm, yarn, bun)
- Language distribution

### 2. Technology Detection
Scans for:
- **Frontend**: React, Vue, Svelte, Angular, Next.js, Nuxt, SvelteKit
- **Backend**: Node.js, Python, Go, Rust, Java, Ruby, PHP, .NET
- **Databases**: PostgreSQL, MySQL, MongoDB, SQLite, Redis
- **Frameworks**: Express, FastAPI, Django, Rails, Spring, Gin, Axum
- **Build Tools**: Webpack, Vite, esbuild, Rollup, Turbopack
- **Testing**: Vitest, Jest, pytest, Go test, RSpec
- **ORMs**: Prisma, Drizzle, SQLAlchemy, TypeORM, Hibernate

### 3. Code Quality Metrics

**Files & Size:**
- Total files by extension
- Largest files (>500 lines flagged)
- Average file size

**Complexity Indicators:**
- Functions >50 lines
- Files >800 lines
- Deep nesting (>4 levels)
- Complex conditionals

**Anti-Patterns:**
- `console.log` / `console.debug` in production code
- TODO/FIXME/HACK comments
- Bare except clauses
- any type usage in TypeScript
- Missing error handling

### 4. Security Scan

**Secrets Detection:**
- API keys (AWS, GCP, Azure patterns)
- Private keys (.pem, .key files)
- Hardcoded passwords
- Token patterns (ghp_, sk-, AKIA)

**Vulnerability Patterns:**
- SQL injection risks (string concatenation in queries)
- XSS risks (innerHTML, dangerouslySetInnerHTML)
- Path traversal (unsanitized file paths)
- Insecure dependencies

**Security Best Practices:**
- HTTPS enforcement
- CORS configuration
- Rate limiting
- Input validation
- Auth/authorization checks

### 5. Architecture Analysis

**Pattern Detection:**
- MVC/MVP/MVVM patterns
- Repository pattern
- Service layer
- Dependency injection
- Event-driven patterns

**Anti-Patterns:**
- God classes/modules
- Circular dependencies
- Feature envy
- Shotgun surgery

## Output Format

The auditor generates a structured report:

```markdown
# Auditor Report — {project_name}

**Generated:** {timestamp}
**Scope:** {scope}

## Summary

| Metric | Value |
|--------|-------|
| Total Files | 123 |
| Languages | TypeScript (78%), Python (22%) |
| Health Score | 85/100 |
| Security | [!] 2 issues |
| Quality | [OK] Good |

## Technology Stack

- **Frontend**: React 18, Next.js 14, Tailwind CSS
- **Backend**: Node.js 20, Express, FastAPI
- **Database**: PostgreSQL 16, Redis 7

## Issues Found

### CRITICAL
1. **[File: src/auth.ts:45]** Hardcoded AWS credentials detected
   - Remove and use environment variables

### HIGH
2. **[File: src/components/DataTable.tsx:89]** Large component (450 lines)
   - Consider splitting into smaller components

### MEDIUM
3. **[File: api/users.py:23]** Bare except clause
   - Use specific exception types

## Recommendations

1. Enable TypeScript strict mode
2. Add rate limiting to API endpoints
3. Implement proper error boundaries in React
4. Set up CI/CD with security scanning

## Files Analyzed

- `src/` — {count} files
- `api/` — {count} files
- `tests/` — {count} files
```

## Examples

```bash
# Full audit
/auditor

# Security scan only
/auditor security

# Check project structure
/auditor structure

# Technology detection
/auditor tech
```

## Integration

The auditor integrates with:
- **Phase 3** — Runs after code generation for quality checks
- **CI/CD** — Can be run in automated pipelines
- **Pre-commit** — Hook into git pre-commit

## Exit Codes

- `0` — Scan completed, no critical issues
- `1` — Scan completed, issues found (non-blocking)
- `2` — Scan failed (configuration error, etc.)

## Notes

- The auditor is read-only — it never modifies files
- Large codebases may take longer to scan
- Use `--privacy` flag to exclude sensitive patterns from logs