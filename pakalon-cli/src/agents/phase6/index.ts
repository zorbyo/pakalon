/**
 * Phase 6 Agent: Documentation
 * Enterprise-grade documentation generation
 * 
 * Features:
 * - README.md generation
 * - API documentation
 * - User guide
 * - Developer guide
 * - Architecture diagrams
 * - Code comments and JSDoc
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult, Phase6State } from '../types.js';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { getToolsForAI } from '@/tools/registry-new.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as ts from 'typescript';
import logger from '@/utils/logger.js';
import { generateChangelog } from './changelog-generator.js';
import { generateTranslatedDocs } from './i18n-docs.js';

const PHASE6_SYSTEM_PROMPT = `You are the Phase 6 Documentation Agent for Pakalon.

Your responsibilities:
1. Generate comprehensive README.md
2. Create API documentation
3. Write user guides
4. Write developer guides
5. Document architecture
6. Add code comments and JSDoc

You must use natural language. Make documentation clear and helpful.`;

export class Phase6Agent extends BaseAgent {
  private state: Phase6State;
  private outputDir: string;
  private autoAddComments: boolean;
  private docLanguages: string[];
  
  constructor(context: AgentContext) {
    const projectDir = context.projectDir ?? process.cwd();
    const userPrompt = context.userPrompt ?? '';
    const config: AgentConfig = {
      name: 'phase6-documentation',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt: PHASE6_SYSTEM_PROMPT,
      tools: getToolsForAI(),
      maxTokens: 8192,
      temperature: 0.7,
    };
    
    super(config, context);
    
    this.state = {
      userPrompt,
      projectDir,
      docsGenerated: [],
      routes: [],
      readmeGenerated: false,
      apiDocGenerated: false,
      changelogGenerated: false,
      modifiedFiles: [],
      translatedDocs: [],
    };
    
    this.outputDir = path.join(projectDir, '.pakalon-agents', 'ai-agents', 'phase-6');
    this.autoAddComments = /--auto-add-comments\b/i.test(userPrompt);
    this.docLanguages = this.parseDocLanguages(userPrompt);
    
    logger.info(`[Phase6] Initialized for project: ${projectDir}`);
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      logger.info('[Phase6] ========================================');
      logger.info('[Phase6] Starting Phase 6: Documentation');
      logger.info('[Phase6] ========================================');
      
      await fs.mkdir(this.outputDir, { recursive: true });
      
      // Step 1: Generate README.md
      logger.info('[Phase6] Step 1/12: README Generation');
      await this.generateREADME();
      
      // Step 2: Generate API docs
      logger.info('[Phase6] Step 2/12: API Documentation');
      await this.generateAPIDocs();
      
      // Step 3: Generate user guide
      logger.info('[Phase6] Step 3/12: User Guide');
      await this.generateUserGuide();
      
      // Step 4: Generate developer guide
      logger.info('[Phase6] Step 4/12: Developer Guide');
      await this.generateDeveloperGuide();
      
      // Step 5: Generate architecture diagrams
      logger.info('[Phase6] Step 5/12: Architecture Diagrams');
      await this.generateArchitectureDiagrams();
      
      // Step 6: Generate feature-scoped Doc.md pipeline
      logger.info('[Phase6] Step 6/12: Feature Docs (Doc.md)');
      await this.generateFeatureDocs();
      
      // Step 7: Add code comments
      logger.info('[Phase6] Step 7/12: Code Comments');
      await this.addCodeComments();

      // Step 8: Generate changelog
      logger.info('[Phase6] Step 8/12: CHANGELOG Generation');
      await this.generateChangelog();

      // Step 9: Generate translated docs
      logger.info('[Phase6] Step 9/12: Multi-language Docs');
      await this.generateMultiLanguageDocs();

      // Step 10: Generate interactive API docs
      logger.info('[Phase6] Step 10/12: Interactive API Docs');
      await this.generateInteractiveApiDocs();

      // Step 11: Generate video tutorial storyboard assets
      logger.info('[Phase6] Step 11/12: Video Tutorial Assets');
      await this.generateVideoTutorialAssets();

      // Step 12: Generate canonical phase artifact summary
      logger.info('[Phase6] Step 12/12: Phase Summary Artifacts');
      await this.generatePhaseSummary();
      
      const duration = Date.now() - startTime;
      
      logger.info('[Phase6] ========================================');
      logger.info(`[Phase6] Phase 6 Completed Successfully in ${(duration / 1000).toFixed(1)}s`);
      logger.info(`[Phase6] Documentation Files: ${this.state.docsGenerated.length}`);
      logger.info('[Phase6] ========================================');
      logger.info('[Phase6] [Party] ALL PHASES COMPLETE! [Party]');
      logger.info('[Phase6] ========================================');
      
      return {
        success: true,
        message: `Phase 6 completed. Generated ${this.state.docsGenerated.length} documentation files.`,
        filesCreated: this.state.docsGenerated,
        duration,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Phase6] Phase 6 failed: ${message}`);
      
      return {
        success: false,
        message: `Phase 6 failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Load project-specific context from earlier phase artifacts
   */
  private async loadProjectContext(): Promise<{
    projectName?: string;
    description?: string;
    features?: string;
    prerequisites?: string;
    testingInstructions?: string;
  }> {
    const projectDir = this.state.projectDir;
    const agentsDir = path.join(projectDir, '.pakalon-agents');
    
    try {
      // Try to load from various phase artifacts
      const context: any = {};
      
      // Load Phase 1 plan for project name and description
      const phase1Paths = [
        path.join(agentsDir, 'phase-1', 'plan.md'),
        path.join(agentsDir, 'ai-agents', 'phase-1', 'plan.md'),
        path.join(projectDir, '.pakalon', 'plan.md'),
      ];
      
      for (const p of phase1Paths) {
        try {
          const content = await fs.readFile(p, 'utf-8');
          // Extract project name from first heading
          const nameMatch = content.match(/^#\s+(.+)$/m);
          if (nameMatch) {
            context.projectName = nameMatch[1];
          }
          // Extract description from first paragraph
          const descMatch = content.match(/^##?\s+[A-Z][a-z]+\s*\n\n(.+?)(?=\n\n##|$)/s);
          if (descMatch) {
            context.description = descMatch[1].substring(0, 200);
          }
          break;
        } catch {
          continue;
        }
      }
      
      // Load Phase 1 tasks for features
      const taskPaths = [
        path.join(agentsDir, 'phase-1', 'tasks.md'),
        path.join(agentsDir, 'ai-agents', 'phase-1', 'tasks.md'),
      ];
      
      for (const p of taskPaths) {
        try {
          const content = await fs.readFile(p, 'utf-8');
          // Extract task list as features
          const tasks = content.match(/^[-*]\s+.+$/gm);
          if (tasks && tasks.length > 0) {
            context.features = tasks.slice(0, 8).map(t => `- [OK] ${t.replace(/^[-*]\s+/, '')}`).join('\n');
          }
          break;
        } catch {
          continue;
        }
      }
      
      // Load Phase 5 for deployment info
      const phase5Paths = [
        path.join(agentsDir, 'phase-5', 'phase-5.md'),
        path.join(agentsDir, 'ai-agents', 'phase-5', 'phase-5.md'),
      ];
      
      for (const p of phase5Paths) {
        try {
          const content = await fs.readFile(p, 'utf-8');
          if (content.includes('prerequisites') || content.includes('requirements')) {
            context.prerequisites = content.substring(0, 500);
          }
          break;
        } catch {
          continue;
        }
      }
      
      logger.info('[Phase6] [OK] Loaded project-specific context');
      return context;
    } catch (error) {
      logger.warn('[Phase6] Could not load project context, using defaults');
      return {};
    }
  }
  
  private async generateREADME(): Promise<void> {
    try {
      logger.info('[Phase6] Generating comprehensive README.md...');
      
      // Load project-specific context from earlier phases
      const projectContext = await this.loadProjectContext();
      
      const readme = `# ${projectContext.projectName || 'Project Name'}

**Generated by Pakalon** - ${projectContext.description || 'Enterprise-grade application'}

## [Rocket] Features

${projectContext.features || `- [OK] Modern TypeScript architecture
- [OK] Full-stack application (Frontend + Backend + Database)
- [OK] RESTful API with OpenAPI documentation
- [OK] Responsive UI with Tailwind CSS
- [OK] Security scanning integrated
- [OK] Docker containerization
- [OK] CI/CD pipelines
- [OK] Production-ready deployment`}

## [Clipboard] Prerequisites

${projectContext.prerequisites || `- Node.js v20+ or Bun
- PostgreSQL 16+ (or Docker)
- Redis (optional, for caching)`}

## [Tools] Installation

\`\`\`bash
# Clone the repository
git clone <repository-url>
cd <project-name>

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
# Then run database migrations
npm run migrate

# Start development server
npm run dev
\`\`\`

## [SPOUTINGWHALE] Docker Setup

\`\`\`bash
# Start all services with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
\`\`\`

## [Book] Documentation

- [API Documentation](./docs/API.md)
- [User Guide](./docs/USER_GUIDE.md)
- [Developer Guide](./docs/DEVELOPER_GUIDE.md)

${projectContext.testingInstructions ? `## [TestTube] Testing

${projectContext.testingInstructions}` : `## [TestTube] Testing

\`\`\`bash
# Run all tests
npm test`}

# Run specific test suite
npm test -- <test-file>

# Generate coverage report
npm run test:coverage
\`\`\`

## [LockKey] Security

This project includes:
- SAST scanning with Semgrep
- Dependency vulnerability scanning
- Secret detection with gitleaks
- Regular security audits in CI/CD

## [SHIP] Deployment

### Vercel

\`\`\`bash
npm install -g vercel
vercel
\`\`\`

### Docker

\`\`\`bash
docker build -t myapp .
docker run -p 3000:3000 myapp
\`\`\`

## [Memo] License

[Your License]

## [Handshake] Contributing

Contributions welcome! Please read our [Contributing Guide](./CONTRIBUTING.md).

---

Built with [Heart] by Pakalon
`;
      
      const readmePath = path.join(this.state.projectDir, 'README.md');
      const generatedReadmePath = path.join(this.outputDir, 'README.generated.md');
      await fs.mkdir(this.outputDir, { recursive: true });

      const existingReadme = await fs.readFile(readmePath, 'utf-8').catch(() => null);
      if (existingReadme === null) {
        await fs.writeFile(readmePath, readme, 'utf-8');
        this.state.docsGenerated.push(readmePath);
      } else {
        await fs.writeFile(generatedReadmePath, readme, 'utf-8');
        const updated = this.upsertReadmeDocsSection(existingReadme);
        await fs.writeFile(readmePath, updated, 'utf-8');
        this.state.docsGenerated.push(readmePath, generatedReadmePath);
      }
      this.state.readmeGenerated = true;
      
      logger.info('[Phase6] [OK] Generated README.md');
    } catch (error) {
      logger.error(`[Phase6] README generation failed: ${error}`);
    }
  }

  private upsertReadmeDocsSection(existingReadme: string): string {
    const start = '<!-- PAKALON-DOCS:START -->';
    const end = '<!-- PAKALON-DOCS:END -->';
    const section = `${start}
## Pakalon Documentation

Generated Phase 6 documentation is available in:

- [API Documentation](./docs/API.md)
- [User Guide](./docs/USER_GUIDE.md)
- [Developer Guide](./docs/DEVELOPER_GUIDE.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Documentation Index](./docs/README.md)

Full generated README draft: \`.pakalon-agents/ai-agents/phase-6/README.generated.md\`
${end}`;

    const block = new RegExp(`${start}[\\s\\S]*?${end}`);
    if (block.test(existingReadme)) {
      return `${existingReadme.replace(block, section).trimEnd()}\n`;
    }

    return `${existingReadme.trimEnd()}\n\n${section}\n`;
  }
  
  private async generateAPIDocs(): Promise<void> {
    try {
      logger.info('[Phase6] Generating API documentation...');

      const docsDir = path.join(this.state.projectDir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      const openApiPath = await this.ensureOpenApiSpec();
      const relativeSpec = path.relative(docsDir, openApiPath).replace(/\\/g, '/');

      const apiDoc = `# API Documentation

See [Interactive API Reference](./api-reference.html) or [OpenAPI Specification](${relativeSpec}) for complete API reference.

## Quick Start

Base URL: \`http://localhost:3000/api\`

### Authentication

\`\`\`bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
\`\`\`

Include the returned token in authenticated requests:

\`\`\`bash
GET /api/users
Authorization: Bearer <your-token>
\`\`\`

## Endpoints

- \`GET /api/users\` - List all users
- \`POST /api/users\` - Create user
- \`GET /api/users/:id\` - Get user by ID
- \`PUT /api/users/:id\` - Update user
- \`DELETE /api/users/:id\` - Delete user

See the OpenAPI spec for full request and response schemas.
`;

      const apiDocPath = path.join(docsDir, 'API.md');
      await fs.writeFile(apiDocPath, apiDoc, 'utf-8');
      this.state.docsGenerated.push(apiDocPath);
      this.state.apiDocGenerated = true;

      logger.info('[Phase6] [OK] Generated API documentation');
    } catch (error) {
      logger.error(`[Phase6] API docs generation failed: ${error}`);
    }
  }

  private async generateInteractiveApiDocs(): Promise<void> {
    try {
      const docsDir = path.join(this.state.projectDir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });

      const openApiPath = await this.ensureOpenApiSpec();
      const relativeSpec = path.relative(docsDir, openApiPath).replace(/\\/g, '/');
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API Reference</title>
    <style>
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #fff; color: #111827; }
      header { padding: 16px 24px; border-bottom: 1px solid #e5e7eb; display: flex; gap: 12px; align-items: baseline; }
      header span { color: #6b7280; font-size: 13px; }
      redoc { display: block; }
    </style>
  </head>
  <body>
    <header>
      <strong>API Reference</strong>
      <span>OpenAPI source: ${relativeSpec}</span>
    </header>
    <redoc spec-url="${relativeSpec}"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>
`;

      const htmlPath = path.join(docsDir, 'api-reference.html');
      await fs.writeFile(htmlPath, html, 'utf-8');
      this.state.docsGenerated.push(htmlPath);
      this.state.apiDocGenerated = true;
      logger.info('[Phase6] [OK] Generated interactive API documentation');
    } catch (error) {
      logger.error(`[Phase6] Interactive API docs generation failed: ${error}`);
    }
  }

  private async ensureOpenApiSpec(): Promise<string> {
    const candidates = [
      path.join(this.state.projectDir, 'openapi.yaml'),
      path.join(this.state.projectDir, 'openapi.yml'),
      path.join(this.state.projectDir, 'openapi.json'),
      path.join(this.state.projectDir, 'docs', 'openapi.yaml'),
      path.join(this.state.projectDir, '.pakalon-agents', 'phase-3', 'api', 'openapi.yaml'),
      path.join(this.state.projectDir, '.pakalon-agents', 'ai-agents', 'phase-3', 'api', 'openapi.yaml'),
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try next candidate.
      }
    }

    const specPath = path.join(this.state.projectDir, 'docs', 'openapi.yaml');
    const spec = `openapi: 3.1.0
info:
  title: ${path.basename(this.state.projectDir)} API
  version: 0.1.0
  description: Generated API shell. Replace paths with the concrete Phase 3 API contract.
servers:
  - url: http://localhost:3000
paths:
  /health:
    get:
      summary: Health check
      responses:
        '200':
          description: Service is healthy
`;
    await fs.writeFile(specPath, spec, 'utf-8');
    this.state.docsGenerated.push(specPath);
    return specPath;
  }
  
  private async generateUserGuide(): Promise<void> {
    try {
      logger.info('[Phase6] Generating user guide...');
      
      const docsDir = path.join(this.state.projectDir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      
      const userGuide = `# User Guide

Welcome! This guide will help you get started.

## Getting Started

1. **Sign Up**
   - Navigate to the registration page
   - Enter your email and password
   - Click "Sign Up"

2. **Log In**
   - Enter your credentials
   - Click "Log In"
   - You'll be redirected to the dashboard

3. **Dashboard**
   - View your overview
   - Access all features from the sidebar

## Features

### Feature 1
Description of feature 1...

### Feature 2
Description of feature 2...

## Troubleshooting

### Common Issues

**Issue:** Cannot log in
- **Solution:** Check your email and password, reset if needed

**Issue:** Page not loading
- **Solution:** Clear browser cache and refresh

## Support

For help, contact: support@example.com
`;
      
      const userGuidePath = path.join(docsDir, 'USER_GUIDE.md');
      await fs.writeFile(userGuidePath, userGuide, 'utf-8');
      this.state.docsGenerated.push(userGuidePath);
      
      logger.info('[Phase6] [OK] Generated user guide');
    } catch (error) {
      logger.error(`[Phase6] User guide generation failed: ${error}`);
    }
  }
  
  private async generateDeveloperGuide(): Promise<void> {
    try {
      logger.info('[Phase6] Generating developer guide...');
      
      const docsDir = path.join(this.state.projectDir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      
      const devGuide = `# Developer Guide

## Architecture

This application follows a layered architecture:

\`\`\`
Frontend (React/Next.js)
    ↓
API Layer (REST)
    ↓
Business Logic (Services)
    ↓
Data Access (Repositories)
    ↓
Database (PostgreSQL)
\`\`\`

## Project Structure

\`\`\`
src/
├── components/     # React components
├── pages/          # Next.js pages
├── api/            # API routes
├── services/       # Business logic
├── models/         # Database models
├── middleware/     # Express middleware
└── utils/          # Utility functions
\`\`\`

## Development Workflow

1. **Create a feature branch**
   \`\`\`bash
   git checkout -b feature/my-feature
   \`\`\`

2. **Make changes and test**
   \`\`\`bash
   npm run dev
   npm test
   \`\`\`

3. **Commit and push**
   \`\`\`bash
   git add .
   git commit -m "feat: add my feature"
   git push origin feature/my-feature
   \`\`\`

4. **Create pull request**

## Code Style

- Use TypeScript for type safety
- Follow ESLint rules
- Write tests for new features
- Document complex logic

## Testing

\`\`\`bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e
\`\`\`

## Database Migrations

\`\`\`bash
# Create migration
npm run migrate:create

# Run migrations
npm run migrate:up

# Rollback
npm run migrate:down
\`\`\`

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
`;
      
      const devGuidePath = path.join(docsDir, 'DEVELOPER_GUIDE.md');
      await fs.writeFile(devGuidePath, devGuide, 'utf-8');
      this.state.docsGenerated.push(devGuidePath);
      
      logger.info('[Phase6] [OK] Generated developer guide');
    } catch (error) {
      logger.error(`[Phase6] Developer guide generation failed: ${error}`);
    }
  }
  
  /**
   * Generate Mermaid architecture diagrams based on project structure
   */
  private async generateArchitectureDiagrams(): Promise<void> {
    try {
      logger.info('[Phase6] Generating architecture diagrams...');
      
      const docsDir = path.join(this.state.projectDir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      
      // Scan project for directory structure to generate accurate diagram
      const srcDir = path.join(this.state.projectDir, 'src');
      let srcStructure = '';
      try {
        const entries = await fs.readdir(srcDir, { withFileTypes: true });
        const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
        const files = entries.filter(e => e.isFile()).map(e => e.name);
        srcStructure = [
          ...dirs.map(d => `    ${d}/`),
          ...files.slice(0, 10).map(f => `    ${f}`),
        ].join('\n');
      } catch {
        srcStructure = '    src/';
      }
      
      // Detect backend stack from package.json
      let backendStack = 'Node.js';
      let hasPostgres = false;
      let hasRedis = false;
      try {
        const pkgPath = path.join(this.state.projectDir, 'package.json');
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.next) backendStack = 'Next.js';
        if (deps.express) backendStack = 'Express';
        if (deps['@prisma/client'] || deps.prisma) hasPostgres = true;
        if (deps.ioredis || deps.redis) hasRedis = true;
      } catch { /* ignore */ }
      
      // Generate feature-scoped architecture diagram
      const archDiagram = `# Architecture Diagram
      
## System Architecture

\`\`\`mermaid
graph TB
    Client[Client Browser / Mobile]
    Client --> API[API Gateway / ${backendStack}]
    
    subgraph Backend [Backend Services]
        API --> Auth[Auth Service]
        API --> Business[Business Logic]
        API --> Data[Data Access Layer]
    end
    
    subgraph Storage [Data Stores]
        Data --> DB[${hasPostgres ? 'PostgreSQL' : 'Database'}]
        ${hasRedis ? 'API --> Cache[Redis Cache]' : ''}
    end
    
    subgraph External [External Services]
        API --> Ext1[Third-party APIs]
    ${hasRedis ? '' : ''}
    style Client fill:#f9f,stroke:#333,stroke-width:2px
    style Backend fill:#bbf,stroke:#333,stroke-width:2px
    style Storage fill:#bfb,stroke:#333,stroke-width:2px
\`\`\`

## Data Flow

\`\`\`mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant DB
    
    User->>Frontend: Interact with UI
    Frontend->>API: HTTP Request
    API->>DB: Query/Write
    DB-->>API: Response
    API-->>Frontend: JSON Response
    Frontend-->>User: Update UI
\`\`\`

## Project Structure

\`\`\`
${path.basename(this.state.projectDir)}/
├── .github/
│   └── workflows/
│       └── ci-cd.yml
${srcStructure ? `├── src/\n${srcStructure.split('\n').filter(Boolean).join('\n')}` : ''}
├── docs/
├── Dockerfile
├── docker-compose.yml
└── README.md
\`\`\`
`;
      
      const archPath = path.join(docsDir, 'ARCHITECTURE.md');
      await fs.writeFile(archPath, archDiagram, 'utf-8');
      this.state.docsGenerated.push(archPath);
      
      logger.info('[Phase6] [OK] Generated architecture diagrams');
    } catch (error) {
      logger.error(`[Phase6] Architecture diagram generation failed: ${error}`);
    }
  }

  /**
   * Generate feature-scoped Doc.md pipeline
   * Creates one Doc.md per feature discovered from phase artifacts
   */
  private async generateFeatureDocs(): Promise<void> {
    try {
      logger.info('[Phase6] Generating feature-scoped Doc.md pipeline...');
      
      const projectContext = await this.loadProjectContext();
      const docsDir = path.join(this.state.projectDir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      
      // Read existing source files for feature detection
      const srcDir = path.join(this.state.projectDir, 'src');
      const detectedFeatures: Array<{ name: string; description: string; files: string[] }> = [];
      
      // Detect features from directory structure
      try {
        const entries = await fs.readdir(srcDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const name = entry.name.replace(/^src\//, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const featureDir = path.join(srcDir, entry.name);
            const featureFiles = await fs.readdir(featureDir);
            detectedFeatures.push({
              name,
              description: `The ${name.toLowerCase()} module handles project-related functionality.`,
              files: featureFiles.map(f => path.join(entry.name, f)),
            });
          }
        }
      } catch { /* no src dir */ }
      
      // If nothing detected from src, fall back to phase-1 artifacts
      if (detectedFeatures.length === 0) {
        const features = projectContext.features?.split('\n').filter(Boolean).slice(0, 5) || ['Core Application'];
        features.forEach((feature, i) => {
          const name = feature.replace(/^[-*]\s+[[OK]]?\s*/, '').trim();
          detectedFeatures.push({
            name: name.substring(0, 40),
            description: name,
            files: [],
          });
        });
      }
      
      // Generate a Doc.md pipeline for each feature
      for (const feature of detectedFeatures) {
        const docName = feature.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const docContent = `# ${feature.name}

## Overview

${feature.description}

## Files

${feature.files.map(f => `- \`${f}\``).join('\n') || '- (auto-generated files)'}

## API Reference

### Methods/Functions

| Name | Description |
|------|-------------|
| \`initialize()\` | Initializes the ${feature.name.toLowerCase()} module |
| \`configure()\` | Configures module settings |

## Dependencies

- Core framework
- Shared utilities

## Usage Example

\`\`\`typescript
import { ${docName.replace(/-/g, '_')} } from './${docName}';

const instance = new ${docName.replace(/-/g, '_')}();
await instance.initialize();
\`\`\`

## Related

- [Architecture](./ARCHITECTURE.md)
- [API Documentation](./API.md)

---

*Generated by Pakalon Phase 6 — Documentation Pipeline*
`;
        
        const docPath = path.join(docsDir, `${docName}.doc.md`);
        await fs.writeFile(docPath, docContent, 'utf-8');
        this.state.docsGenerated.push(docPath);
      }
      
      // Generate a pipeline index file
      const pipelineIndex = `# Doc.md Pipeline

Generated by Pakalon Phase 6.

## Feature Documentation

${detectedFeatures.map((f, i) => `${i + 1}. [${f.name}](./${f.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.doc.md)`).join('\n')}

## Core Documentation

1. [Architecture](./ARCHITECTURE.md)
2. [API Reference](./API.md)
3. [Developer Guide](./DEVELOPER_GUIDE.md)
4. [User Guide](./USER_GUIDE.md)

---
*Pipeline generated: ${new Date().toISOString()}*
`;
      
      const pipelinePath = path.join(docsDir, 'README.md');
      await fs.writeFile(pipelinePath, pipelineIndex, 'utf-8');
      this.state.docsGenerated.push(pipelinePath);
      
      logger.info('[Phase6] [OK] Generated feature Doc.md pipeline');
    } catch (error) {
      logger.error(`[Phase6] Feature docs generation failed: ${error}`);
    }
  }

  private async generatePhaseSummary(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      const uniqueDocs = Array.from(new Set(this.state.docsGenerated));
      const relativeDocs = uniqueDocs.map((file) => path.relative(this.state.projectDir, file).replace(/\\/g, '/'));
      const generatedAt = new Date().toISOString();

      const phaseSummary = `# Phase 6: Documentation

## Status
Completed at ${generatedAt}

## Outputs
${relativeDocs.map((file) => `- ${file}`).join('\n') || '- No documentation files were generated.'}

## README Update
- Root README updated: ${this.state.readmeGenerated ? 'yes' : 'no'}
- Existing README content is preserved with a bounded Pakalon documentation section.

## API Documentation
- API docs generated: ${this.state.apiDocGenerated ? 'yes' : 'no'}

## Changelog
- Changelog generated: ${this.state.changelogGenerated ? 'yes' : 'no'}

## Translations
${(this.state.translatedDocs ?? []).map((file) => `- ${path.relative(this.state.projectDir, file).replace(/\\/g, '/')}`).join('\n') || '- No translated docs requested.'}
`;

      const docMd = `# Doc.md

This is the canonical Phase 6 documentation index generated by Pakalon.

## Project Documentation
${relativeDocs.map((file) => `- [${file}](../../../${file})`).join('\n') || '- No documentation files were generated.'}

## Phase Artifact
- [phase-6.md](./phase-6.md)
`;

      const phaseSummaryPath = path.join(this.outputDir, 'phase-6.md');
      const docMdPath = path.join(this.outputDir, 'Doc.md');
      await fs.writeFile(phaseSummaryPath, phaseSummary, 'utf-8');
      await fs.writeFile(docMdPath, docMd, 'utf-8');
      this.state.docsGenerated.push(phaseSummaryPath, docMdPath);
      logger.info('[Phase6] [OK] Generated phase-6.md and Doc.md artifacts');
    } catch (error) {
      logger.error(`[Phase6] Phase summary generation failed: ${error}`);
    }
  }

  private async addCodeComments(): Promise<void> {
    try {
      logger.info('[Phase6] Verifying code comments...');
      
      const srcDir = path.join(this.state.projectDir, 'src');
      
      // Scan for .ts/.tsx files missing JSDoc on exported functions
      let totalFiles = 0;
      let filesWithIssues = 0;
      const missingCommentFiles: string[] = [];
      
      try {
        const walkDir = async (dir: string): Promise<void> => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              await walkDir(fullPath);
            } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
              totalFiles++;
              const content = await fs.readFile(fullPath, 'utf-8');
              
              // Check for exported functions without JSDoc
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (/^export (async )?function/.test(line) || /^export (const|let|var) \w+/.test(line)) {
                  // Check if previous non-empty line has JSDoc
                  let prevLine = i > 0 ? lines[i - 1].trim() : '';
                  if (prevLine !== '*/' && prevLine !== '**/') {
                    filesWithIssues++;
                    missingCommentFiles.push(fullPath);
                    break;
                  }
                }
              }
            }
          }
        };
        await walkDir(srcDir);
      } catch { /* src dir may not exist */ }

      if (this.autoAddComments && missingCommentFiles.length > 0) {
        for (const filePath of [...new Set(missingCommentFiles)].slice(0, 25)) {
          const changed = await this.addMissingJSDocComments(filePath);
          if (changed) {
            this.state.modifiedFiles?.push(filePath);
          }
        }
      }
      
      logger.info(`[Phase6] [OK] Code comments verified: ${totalFiles} files scanned, ${filesWithIssues} with missing JSDoc`);
    } catch (error) {
      logger.error(`[Phase6] Code comments check failed: ${error}`);
    }
  }

  private parseDocLanguages(prompt: string): string[] {
    const raw = prompt.match(/--doc-languages\s+([a-zA-Z,\-\s]+)/)?.[1] ?? process.env.PAKALON_DOC_LANGUAGES ?? '';
    return raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[a-z]{2}(?:-[a-z]{2})?$/.test(item))
      .slice(0, 5);
  }

  private async generateChangelog(): Promise<void> {
    try {
      const changelogPath = await generateChangelog(this.state.projectDir);
      this.state.docsGenerated.push(changelogPath);
      this.state.changelogGenerated = true;
      logger.info('[Phase6] [OK] Generated CHANGELOG.md');
    } catch (error) {
      logger.warn(`[Phase6] CHANGELOG generation skipped: ${error}`);
    }
  }

  private async generateMultiLanguageDocs(): Promise<void> {
    if (this.docLanguages.length === 0) {
      logger.info('[Phase6] No doc languages requested; set --doc-languages or PAKALON_DOC_LANGUAGES to enable translations');
      return;
    }

    try {
      const sourceFiles = this.state.docsGenerated.filter((file) => file.endsWith('.md')).slice(0, 6);
      const translated = await generateTranslatedDocs(this.state.projectDir, this.docLanguages, sourceFiles);
      this.state.translatedDocs?.push(...translated);
      this.state.docsGenerated.push(...translated);
      logger.info(`[Phase6] [OK] Generated translated docs for ${this.docLanguages.join(', ')}`);
    } catch (error) {
      logger.warn(`[Phase6] Multi-language docs generation failed: ${error}`);
    }
  }

  private async generateVideoTutorialAssets(): Promise<void> {
    try {
      const docsDir = path.join(this.state.projectDir, 'docs');
      const tutorialDir = path.join(docsDir, 'tutorials');
      await fs.mkdir(tutorialDir, { recursive: true });

      const storyboard = {
        generatedAt: new Date().toISOString(),
        project: path.basename(this.state.projectDir),
        tutorials: [
          {
            id: 'getting-started',
            title: 'Getting Started',
            scenes: [
              'Open the application landing route',
              'Create or sign into an account',
              'Complete the first core workflow',
              'Show the success or dashboard state',
            ],
          },
          {
            id: 'developer-setup',
            title: 'Developer Setup',
            scenes: [
              'Install dependencies',
              'Configure environment variables',
              'Run local development server',
              'Run tests and review generated docs',
            ],
          },
        ],
      };

      const jsonPath = path.join(tutorialDir, 'video-tutorials.json');
      await fs.writeFile(jsonPath, `${JSON.stringify(storyboard, null, 2)}\n`, 'utf-8');

      const guidePath = path.join(docsDir, 'VIDEO_TUTORIALS.md');
      const guide = `# Video Tutorials

Generated tutorial storyboard assets are available in \`docs/tutorials/video-tutorials.json\`.

## Tutorials

${storyboard.tutorials.map((tutorial) => `### ${tutorial.title}\n${tutorial.scenes.map((scene, index) => `${index + 1}. ${scene}`).join('\n')}`).join('\n\n')}

## Recording Notes

Use Playwright or your preferred browser recorder to capture each scene against a running local app. Keep credentials and secrets out of recordings.
`;
      await fs.writeFile(guidePath, guide, 'utf-8');
      this.state.docsGenerated.push(jsonPath, guidePath);
      logger.info('[Phase6] [OK] Generated video tutorial storyboard assets');
    } catch (error) {
      logger.warn(`[Phase6] Video tutorial asset generation failed: ${error}`);
    }
  }

  private async addMissingJSDocComments(filePath: string): Promise<boolean> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const exportMatch = line.match(/^(\s*)export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/)
        ?? line.match(/^(\s*)export\s+const\s+([A-Za-z0-9_]+)\s*=/);
      if (!exportMatch) continue;

      let previous = i - 1;
      while (previous >= 0 && lines[previous].trim() === '') previous--;
      if (previous >= 0 && lines[previous].trim() === '*/') continue;

      const indent = exportMatch[1] ?? '';
      const symbol = exportMatch[2] ?? 'export';
      lines.splice(i, 0, `${indent}/**`, `${indent} * ${this.humanizeSymbol(symbol)}.`, `${indent} */`);
      i += 3;
      changed = true;
    }

    if (changed) {
      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
    }
    return changed;
  }

  private humanizeSymbol(symbol: string): string {
    return symbol
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^\w/, (char) => char.toUpperCase());
  }
}
