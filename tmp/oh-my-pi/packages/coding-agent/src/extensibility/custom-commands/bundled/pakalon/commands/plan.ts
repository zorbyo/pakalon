/**
 * /plan command — Generate a planning document as output.md.
 *
 * Analyzes the user's prompt and creates a detailed plan
 * written to output.md in the project root.
 */
import * as path from "node:path";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// PlanCommand
// ============================================================================

export class PlanCommand implements CustomCommand {
	name = "plan";
	description = "Generate a planning document (output.md) from your prompt";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const prompt = args.join(" ").trim();

		if (!prompt) {
			ctx.ui.notify("Usage: /plan <description of what to build>", "error");
			return undefined;
		}

		ctx.ui.notify("Analyzing your request and generating a plan...", "info");

		// Generate the plan content
		const planContent = generatePlanDocument(prompt);

		// Write to output.md in project root
		const outputPath = path.join(this.api.cwd, "output.md");
		await Bun.write(outputPath, planContent);

		ctx.ui.notify(`Plan generated: output.md`, "info");
		ctx.ui.notify("Review the plan, then use /build to start implementing.", "info");

		// Return a prompt that includes the plan for the LLM to use
		return `I have generated a plan in output.md. Please review it and then start implementing the application based on this plan. The plan includes:\n\n${planContent.slice(0, 2000)}...`;
	}
}

// ============================================================================
// Plan Document Generator
// ============================================================================

function generatePlanDocument(prompt: string): string {
	const timestamp = new Date().toISOString().split("T")[0];

	return `# Project Plan

**Generated**: ${timestamp}
**Request**: ${prompt}

---

## 1. Overview

This plan outlines the implementation of the requested application based on the user's requirements.

### Goals
- Build a production-ready application
- Follow modern best practices
- Ensure scalability and maintainability
- Deliver a polished user experience

### Success Criteria
- [ ] All core features implemented
- [ ] Tests passing
- [ ] Documentation complete
- [ ] Deployment ready

---

## 2. Technical Architecture

### Frontend
- **Framework**: React + Next.js (App Router)
- **Styling**: Tailwind CSS + Shadcn UI
- **State Management**: React hooks + Zustand (if needed)
- **API Client**: Fetch API with custom wrapper

### Backend
- **Runtime**: Node.js
- **Framework**: Express / Fastify
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Clerk (OAuth)

### Infrastructure
- **Hosting**: Vercel (frontend) + Railway/Render (backend)
- **Database**: Supabase / Neon (managed PostgreSQL)
- **CI/CD**: GitHub Actions

---

## 3. Feature Breakdown

### Core Features
1. **User Authentication**
   - Registration and login flows
   - OAuth providers (GitHub, Google)
   - Session management
   - Protected routes

2. **Main Application Logic**
   - CRUD operations for primary entities
   - Dashboard with key metrics
   - Search and filtering
   - Data export capabilities

3. **User Interface**
   - Responsive design (mobile + desktop)
   - Dark/light mode toggle
   - Loading states and skeletons
   - Error boundaries and fallbacks

4. **API Layer**
   - RESTful endpoints
   - Input validation
   - Error handling
   - Rate limiting

---

## 4. Implementation Phases

### Phase 1: Foundation (Days 1-2)
- Project setup (Next.js + Express)
- Database schema and migrations
- Authentication integration
- Basic layout and navigation

### Phase 2: Core Features (Days 3-5)
- CRUD operations
- API endpoints
- Frontend forms and lists
- Data relationships

### Phase 3: Polish (Days 6-7)
- Responsive design
- Loading states
- Error handling
- Form validation

### Phase 4: Testing & Deploy (Day 8)
- Unit tests
- Integration tests
- CI/CD pipeline
- Deployment configuration

---

## 5. Database Schema (High-Level)

\`\`\`
Users
  ├── id: UUID (PK)
  ├── email: String (unique)
  ├── name: String
  ├── avatar: String?
  ├── createdAt: DateTime
  └── updatedAt: DateTime

Posts (or primary entity)
  ├── id: UUID (PK)
  ├── title: String
  ├── content: Text
  ├── authorId: UUID (FK -> Users)
  ├── status: Enum (draft, published, archived)
  ├── createdAt: DateTime
  └── updatedAt: DateTime
\`\`\`

---

## 6. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | User registration |
| POST | /api/auth/login | User login |
| GET | /api/users/me | Get current user |
| GET | /api/posts | List posts |
| POST | /api/posts | Create post |
| GET | /api/posts/:id | Get post |
| PUT | /api/posts/:id | Update post |
| DELETE | /api/posts/:id | Delete post |

---

## 7. Environment Variables

\`\`\`env
# Database
DATABASE_URL=postgresql://...

# Authentication
CLERK_SECRET_KEY=sk_...
CLERK_PUBLISHABLE_KEY=pk_...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
API_URL=http://localhost:4000
\`\`\`

---

## 8. Next Steps

1. Review this plan and provide feedback
2. Adjust any technical choices as needed
3. Start implementation with \`/build\`
4. Monitor progress through the session

---

*This plan was generated by Pakalon. Modify as needed before starting implementation.*
`;
}

export default function planFactory(api: CustomCommandAPI): PlanCommand {
	return new PlanCommand(api);
}
