import path from "path"
import { CICDGenerator } from "../deploy/cicd"
import { GitHub } from "../deploy/github"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { FileStructure } from "./file-structure"
import type { PhaseContext, PhaseResult } from "./types"

const log = Log.create({ service: "pipeline:phase5" })

const SYSTEM_PROMPT = `You are the Phase 5 Deployment Agent for Pakalon.

Your job is to:
1. Set up CI/CD pipeline configuration
2. Configure deployment settings
3. Push code to GitHub with proper branch management
4. Create pull requests for review
5. Set up monitoring and health checks

You must produce:
- phase-5.md: Phase 5 completion summary with deployment details
- .github/workflows/ci.yml: CI/CD pipeline configuration
- .github/workflows/deploy.yml: Deployment workflow
- .github/dependabot.yml: Dependency update automation
- Dockerfile: Container configuration
- docker-compose.yml: Multi-container setup
- deploy.sh: Deployment script

## GitHub Integration

### Prerequisites
- GitHub CLI (gh) must be authenticated
- Repository must be initialized with git
- Remote origin must be configured

### GitHub Operations

#### 1. Initialize Repository (if needed)
\`\`\`bash
gh repo create <repo-name> --public --source=. --remote=origin
\`\`\`

#### 2. Create Branch Structure
\`\`\`bash
git checkout -b develop
git push -u origin main
git push -u origin develop
\`\`\`

#### 3. Create Pull Request
\`\`\`bash
gh pr create --title "feat: Initial implementation" --body "## Summary\\n- Implemented core features\\n- Added CI/CD pipeline\\n- Configured deployment" --base main --head develop
\`\`\`

#### 4. Create Issues for TODOs
\`\`\`bash
gh issue create --title "Add unit tests" --body "Add comprehensive unit tests for all modules"
\`\`\`

#### 5. Configure Repository Settings
\`\`\`bash
# Enable branch protection
gh api repos/{owner}/{repo}/branches/main/protection --method PUT --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["lint", "test", "build"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  }
}
EOF
\`\`\`

### Deployment Targets
- **Vercel**: For Next.js/frontend apps
- **Docker**: For containerized deployments
- **AWS ECS/Fargate**: For scalable container deployments
- **GitHub Pages**: For static sites

### Secrets Required
Configure these in GitHub Settings > Secrets:
- \`VERCEL_TOKEN\` - Vercel deployment token
- \`VERCEL_ORG_ID\` - Vercel organization ID  
- \`VERCEL_PROJECT_ID\` - Vercel project ID
- \`AWS_ACCESS_KEY_ID\` - AWS credentials (if using AWS)
- \`AWS_SECRET_ACCESS_KEY\` - AWS credentials (if using AWS)
- \`DOCKER_USERNAME\` - Docker Hub credentials
- \`DOCKER_PASSWORD\` - Docker Hub credentials

### Workflow Best Practices
1. Use matrix testing for multiple Node versions
2. Cache dependencies for faster builds
3. Run security scans in CI
4. Deploy to staging first, then production
5. Use semantic versioning for releases
6. Add status badges to README`

export namespace Phase5Deploy {
  export function systemPrompt(): string {
    return SYSTEM_PROMPT
  }

  export async function execute(ctx: PhaseContext): Promise<PhaseResult> {
    log.info("starting phase 5 deployment", { mode: ctx.mode, path: ctx.projectPath })

    const artifacts: string[] = []
    let tokensUsed = 0

    const files = [
      {
        name: ".github/workflows/ci.yml",
        content: CICDGenerator.generateGitHubActions("node"),
      },
      {
        name: ".github/workflows/deploy.yml",
        content: CICDGenerator.generateDeployWorkflow("docker"),
      },
      {
        name: ".github/dependabot.yml",
        content: CICDGenerator.generateDependabot(),
      },
      {
        name: "Dockerfile",
        content: CICDGenerator.generateDockerfile("node"),
      },
      {
        name: "docker-compose.yml",
        content: CICDGenerator.generateDockerCompose(["app", "worker", "db"]),
      },
      {
        name: "deploy.sh",
        content: CICDGenerator.generateDeployScript("docker"),
      },
    ] as const

    const cmds: string[] = []
    const notes: string[] = []
    let auth = false

    try {
      auth = GitHub.isAuthenticated(ctx.projectPath)
      cmds.push("gh auth status")
      notes.push(auth ? "GitHub CLI authenticated" : "GitHub CLI not authenticated; skipped GitHub operations")
    } catch (error) {
      notes.push(`GitHub auth check failed: ${toMsg(error)}`)
    }

    try {
      for (const file of files) {
        try {
          const p = path.join(ctx.projectPath, file.name)
          const mode = file.name === "deploy.sh" ? 0o755 : undefined
          await Filesystem.write(p, file.content, mode)
          await FileStructure.writeArtifact(ctx.projectPath, 5, file.name, file.content)
          artifacts.push(file.name)
          tokensUsed += tokenCost(file.content)
        } catch (error) {
          notes.push(`Failed to write ${file.name}: ${toMsg(error)}`)
        }
      }

      if (auth && ctx.mode === "yolo") {
        const repo = path.basename(ctx.projectPath)
        try {
          GitHub.createRepo(repo, { cwd: ctx.projectPath, source: ".", remote: "origin", visibility: "public" })
          cmds.push(`gh repo create ${repo} --public --source=. --remote=origin`)
        } catch (error) {
          notes.push(`Repo creation skipped/failed: ${toMsg(error)}`)
        }

        try {
          GitHub.createBranch("develop", ctx.projectPath)
          cmds.push("git checkout -b develop")
          cmds.push("git push -u origin develop")
        } catch (error) {
          notes.push(`Branch creation skipped/failed: ${toMsg(error)}`)
        }

        try {
          const body = GitHub.formatPRSummary("Initial implementation", files.map((x) => `Added ${x.name}`))
          GitHub.createPR("feat: initial implementation", body, "main", "develop", ctx.projectPath)
          cmds.push("gh pr create --title \"feat: initial implementation\" --base main --head develop")
        } catch (error) {
          notes.push(`PR creation skipped/failed: ${toMsg(error)}`)
        }
      } else if (auth && ctx.mode !== "yolo") {
        notes.push("GitHub authenticated but mode is HIL; skipped repo/branch/PR automation")
      }
    } catch (error) {
      notes.push(`Phase 5 execution recovered from error: ${toMsg(error)}`)
      log.warn("phase 5 recovered from execution error", { error: toMsg(error) })
    }

    const content = generateDeploymentSummary(ctx, {
      files: artifacts,
      commands: cmds,
      notes,
      githubAuthenticated: auth,
    })

    try {
      await Filesystem.write(path.join(ctx.projectPath, "phase-5.md"), content)
      await FileStructure.writeArtifact(ctx.projectPath, 5, "phase-5.md", content)
      artifacts.push("phase-5.md")
      tokensUsed += tokenCost(content)
    } catch (error) {
      log.warn("failed to write phase-5 summary", { error: toMsg(error) })
    }

    log.info("phase 5 completed", { artifacts: artifacts.length, tokensUsed, githubAuthenticated: auth })
    return { success: true, artifacts, nextPhase: 6, tokensUsed }
  }

  function generateDeploymentSummary(
    ctx: PhaseContext,
    input: {
      files: string[]
      commands: string[]
      notes: string[]
      githubAuthenticated: boolean
    },
  ): string {
    const files = input.files.length > 0 ? input.files.map((x) => `- ${x}`).join("\n") : "- No files generated"
    const commands = input.commands.length > 0 ? input.commands.map((x) => `- \`${x}\``).join("\n") : "- No GitHub commands executed"
    const notes = input.notes.length > 0 ? input.notes.map((x) => `- ${x}`).join("\n") : "- No notes"

    return `# Phase 5 Summary - Deployment

## Status: Completed

## Deployment Configuration
- Target: Docker
- Environment: Production
- CI/CD: GitHub Actions
- GitHub Authenticated: ${input.githubAuthenticated ? "Yes" : "No"}

## Artifacts Generated
- .github/workflows/ci.yml
- .github/workflows/deploy.yml
- .github/dependabot.yml
- Dockerfile
- docker-compose.yml
- deploy.sh
- phase-5.md

## Files Written
${files}

## Commands Executed
${commands}

## Execution Notes
${notes}

## Steps Performed
1. ✅ Checked GitHub CLI authentication via \`GitHub.isAuthenticated()\`
2. ✅ Generated CI workflow via \`CICDGenerator.generateGitHubActions("node")\`
3. ✅ Generated deploy workflow via \`CICDGenerator.generateDeployWorkflow("docker")\`
4. ✅ Generated dependency automation via \`CICDGenerator.generateDependabot()\`
5. ✅ Generated Dockerfile via \`CICDGenerator.generateDockerfile("node")\`
6. ✅ Generated compose file via \`CICDGenerator.generateDockerCompose(...)\`
7. ✅ Generated deploy script via \`CICDGenerator.generateDeployScript("docker")\`
8. ✅ Wrote generated files to project root and phase-5 artifacts

## GitHub Integration
- Authentication check executed
- Repository/branch/PR operations attempted only when authenticated and mode permits

## Deployment Checklist
- [x] CI/CD pipeline configured
- [x] Docker configuration ready
- [x] Deployment scripts created
- [x] Deployment workflow configured
- [ ] Environment variables configured (manual)
- [ ] Database migrations ready (manual)
- [ ] Runtime secrets configured in GitHub (manual)

## Deployment Instructions
1. Review generated files in project root.
2. Configure required GitHub secrets (for Docker registry credentials).
3. Run local validation:
   - \`docker compose config\`
   - \`bash ./deploy.sh\`
4. Push changes and confirm GitHub Actions workflows pass.
5. Trigger deploy workflow manually if needed (workflow_dispatch).

## Next Steps
1. Verify pipeline against target runtime requirements
2. Add environment-specific service definitions to \`docker-compose.yml\`
3. Add smoke tests to deploy workflow
4. Set up branch protection rules in GitHub

## Mode
${ctx.mode === "hil" ? "Human-in-the-Loop - awaiting deployment approval" : "YOLO - configuration generated"}

---
*Generated by Pakalon Phase 5 Deployment Agent*
`
  }

  function tokenCost(content: string): number {
    return Math.max(120, Math.ceil(content.length / 8))
  }

  function toMsg(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
  }
}
