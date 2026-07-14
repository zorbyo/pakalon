import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { ResearchResult } from "./research";
import { ResearchProvider, writeResearchData } from "./research";
import type { Mode, Phase1Input, Phase1Output, QASession } from "./types";

const PHASE1_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");

// ─── Q&A Engine ───────────────────────────────────────────────────────────────

interface QAPair {
	question: string;
	options: string[];
	answer: string;
	label?: string;
	description?: string;
}

interface BrainstormingSession {
	pairs: QAPair[];
	prompt: string;
	mode: Mode;
	completed: boolean;
}

const TECH_STACK_QUESTIONS: Array<{ question: string; options: string[]; followUps?: string[] }> = [
	{
		question: "What frontend tech stack would you like to use?",
		options: [
			"React + Next.js + TypeScript + Tailwind CSS + Shadcn UI",
			"Vue + Nuxt + TypeScript + Tailwind CSS",
			"HTML + CSS + Vanilla JavaScript (no framework)",
			"Svelte + SvelteKit",
			"Custom input from user",
			"End Phase 1",
		],
		followUps: [
			"Do you want a dual theme option (light/dark)?",
			"Do you want 3D elements in the frontend?",
			"What level of animations do you need?",
		],
	},
	{
		question: "What backend technology stack do you prefer?",
		options: [
			"Node.js + Express + TypeScript",
			"Python + FastAPI",
			"Go + Gin/Fiber",
			"Bun + Elysia",
			"Custom input from user",
			"Skip (frontend-only project)",
			"End Phase 1",
		],
		followUps: ["Do you need REST API or GraphQL?", "Do you need real-time features (WebSocket)?"],
	},
	{
		question: "What database system do you want to use?",
		options: [
			"PostgreSQL (relational, robust)",
			"SQLite (lightweight, embedded)",
			"MongoDB (document-based, flexible)",
			"Supabase (PostgreSQL + auth + storage)",
			"Custom input from user",
			"No database needed",
			"End Phase 1",
		],
	},
	{
		question: "What authentication method do you need?",
		options: [
			"JWT-based auth with email/password",
			"OAuth 2.0 (Google, GitHub, etc.)",
			"Clerk / NextAuth / Auth.js",
			"Supabase Auth",
			"Custom input from user",
			"No authentication needed",
			"End Phase 1",
		],
	},
	{
		question: "Do you need a payment system?",
		options: [
			"Stripe integration",
			"Polar (for SaaS billing)",
			"Lemon Squeezy",
			"Custom input from user",
			"No payment system needed",
			"End Phase 1",
		],
	},
	{
		question: "What is the primary purpose of your application?",
		options: [
			"SaaS platform (subscription-based)",
			"E-commerce store",
			"Landing page / Portfolio",
			"Internal business tool",
			"Social / Community platform",
			"Content management system",
			"Custom input from user",
			"End Phase 1",
		],
	},
	{
		question: "Who is your target audience?",
		options: [
			"General consumers (B2C)",
			"Businesses / Enterprises (B2B)",
			"Developers / Technical users",
			"Internal team only",
			"Custom input from user",
			"End Phase 1",
		],
	},
	{
		question: "What deployment platform do you prefer?",
		options: [
			"Vercel (frontend) + Render/Railway (backend)",
			"AWS (full stack)",
			"DigitalOcean App Platform",
			"Docker + self-hosted",
			"Custom input from user",
			"Not sure yet",
			"End Phase 1",
		],
	},
	{
		question: "What level of testing do you need?",
		options: [
			"Full testing suite (unit + integration + e2e + security)",
			"Basic unit tests only",
			"Manual testing only",
			"Custom input from user",
			"End Phase 1",
		],
	},
	{
		question: "Do you need CI/CD pipeline?",
		options: [
			"Yes - GitHub Actions (automated build, test, deploy)",
			"Yes - GitLab CI",
			"Manual deployment only",
			"Not sure yet",
			"End Phase 1",
		],
	},
];

function generateFollowUpQuestions(context: Record<string, string>): Array<{ question: string; options: string[] }> {
	const questions: Array<{ question: string; options: string[] }> = [];
	if (!context.frontend || context.frontend.includes("Next.js")) {
		questions.push({
			question: "Would you like SSR (Server-Side Rendering) or SSG (Static Site Generation)?",
			options: ["SSR (dynamic content)", "SSG (static, faster)", "Both (ISR)", "Not sure", "End Phase 1"],
		});
	}
	if (context.auth?.includes("JWT") || !context.auth) {
		questions.push({
			question: "Do you need role-based access control (RBAC)?",
			options: ["Yes - admin/user/editor roles", "Basic user auth only", "Not needed", "End Phase 1"],
		});
	}
	questions.push({
		question: "Do you need file upload/storage functionality?",
		options: ["Yes - using S3/R2/Cloudinary", "Yes - local storage", "No", "End Phase 1"],
	});
	questions.push({
		question: "Do you need email notifications?",
		options: ["Yes (Resend/SendGrid/SES)", "No", "End Phase 1"],
	});
	questions.push({
		question: "Is multi-language (i18n) support needed?",
		options: ["Yes", "No", "End Phase 1"],
	});
	questions.push({
		question: "What is the expected scale of your application?",
		options: [
			"Small (few hundred users)",
			"Medium (few thousand users)",
			"Large (100k+ users)",
			"Not sure",
			"End Phase 1",
		],
	});
	return questions;
}

export async function runBrainstormingSession(input: Phase1Input): Promise<QASession> {
	logger.info("Brainstorming session started", { mode: input.mode });
	const session: QASession = {
		prompt: input.prompt,
		mode: input.mode,
		answers: [],
	};
	if (input.mode === "YOLO") {
		// In YOLO mode, auto-select best options based on prompt analysis
		const promptLower = input.prompt.toLowerCase();
		const autoAnswers = generateAutoDecisions(promptLower, input);
		for (const ans of autoAnswers) {
			session.answers.push(ans);
		}
		logger.info("YOLO mode: auto-decisions made", { count: autoAnswers.length });
		return session;
	}
	// In HIL mode, generate all Q&A pairs
	const context: Record<string, string> = {};
	const allQuestions = [...TECH_STACK_QUESTIONS];
	const followUps = generateFollowUpQuestions(context);
	allQuestions.push(...followUps.map(q => ({ question: q.question, options: q.options })));
	for (const q of allQuestions) {
		const selectedOption = q.options[0]!; // Default to first option
		session.answers.push({
			question: q.question,
			answer: selectedOption,
			label: selectedOption.slice(0, 50),
			description: q.question,
		});
		// Track context
		if (q.question.includes("frontend")) context.frontend = selectedOption;
		if (q.question.includes("backend")) context.backend = selectedOption;
		if (q.question.includes("auth")) context.auth = selectedOption;
		if (q.question.includes("database")) context.database = selectedOption;
		if (q.question.includes("payment")) context.payment = selectedOption;
	}
	session.endedAt = new Date().toISOString();
	logger.info("Brainstorming session completed", { totalQuestions: session.answers.length });
	return session;
}

function generateAutoDecisions(
	prompt: string,
	input: Phase1Input,
): Array<{ question: string; answer: string; label?: string; description?: string }> {
	const decisions: Array<{ question: string; answer: string; label?: string; description?: string }> = [];
	const isWebApp = prompt.includes("web") || prompt.includes("app") || prompt.includes("site");
	const isEcommerce = prompt.includes("ecommerce") || prompt.includes("shop") || prompt.includes("store");
	const isSaaS = prompt.includes("saas") || prompt.includes("subscription");
	const needsAuth = isEcommerce || isSaaS || prompt.includes("login") || prompt.includes("auth");

	decisions.push({
		question: "What frontend tech stack?",
		answer:
			input.techStack?.includes("React") || input.techStack?.includes("Next")
				? input.techStack
				: "React + Next.js + TypeScript + Tailwind CSS + Shadcn UI",
	});
	decisions.push({
		question: "What backend technology?",
		answer: "Node.js + Express + TypeScript",
	});
	decisions.push({
		question: "What database?",
		answer: "PostgreSQL (via Supabase)",
	});
	decisions.push({
		question: "Authentication needed?",
		answer: needsAuth ? "Supabase Auth (email + OAuth)" : "No authentication needed",
	});
	decisions.push({
		question: "Payment system?",
		answer: isEcommerce ? "Stripe integration" : isSaaS ? "Polar" : "No payment system needed",
	});
	decisions.push({
		question: "Primary purpose?",
		answer: isEcommerce
			? "E-commerce store"
			: isSaaS
				? "SaaS platform"
				: isWebApp
					? "Web application"
					: "Landing page",
	});
	decisions.push({
		question: "Target audience?",
		answer: isEcommerce || isSaaS ? "General consumers (B2C)" : "Custom audience as defined in prompt",
	});
	decisions.push({
		question: "Deployment platform?",
		answer: "Vercel + Docker",
	});
	decisions.push({
		question: "Testing level?",
		answer: "Full testing suite (unit + integration + e2e + security)",
	});
	decisions.push({
		question: "CI/CD pipeline?",
		answer: "Yes - GitHub Actions",
	});
	return decisions;
}

// ─── Content Generators ────────────────────────────────────────────────────────

function generatePlan(input: Phase1Input, session: QASession, research?: ResearchResult | null): string {
	const answers = session.answers.reduce<Record<string, string>>((acc, a) => {
		const key = a.question.slice(0, 30);
		acc[key] = a.answer;
		return acc;
	}, {});
	const frontend =
		Object.values(answers).find(v => v.includes("React") || v.includes("Vue") || v.includes("HTML")) ??
		"React + Next.js";
	const backend =
		Object.values(answers).find(
			v => v.includes("Node") || v.includes("Python") || v.includes("Go") || v.includes("Bun"),
		) ?? "Node.js";
	const database =
		Object.values(answers).find(
			v => v.includes("Postgres") || v.includes("SQL") || v.includes("Mongo") || v.includes("Supabase"),
		) ?? "PostgreSQL";

	return `# Project Plan

## Overview
**Project:** ${input.prompt}
**Mode:** ${input.mode}
**Generated:** ${new Date().toISOString()}

## Tech Stack
- **Frontend:** ${research?.techStacks.find(t => t.category === "Frontend")?.recommendation ?? frontend}
- **Backend:** ${research?.techStacks.find(t => t.category === "Backend")?.recommendation ?? backend}
- **Database:** ${research?.techStacks.find(t => t.category === "Database")?.recommendation ?? database}
- **Authentication:** ${research?.techStacks.find(t => t.category === "Authentication")?.recommendation ?? Object.values(answers).find(v => v.includes("JWT") || v.includes("OAuth") || v.includes("Clerk") || v.includes("Supabase Auth") || v.includes("No auth")) ?? "To be determined"}
- **Payment:** ${research?.techStacks.find(t => t.category === "Payments" || t.category === "Billing & Subscriptions")?.recommendation ?? Object.values(answers).find(v => v.includes("Stripe") || v.includes("Polar") || v.includes("Lemon") || v.includes("No payment")) ?? "To be determined"}
- **Deployment:** ${research?.techStacks.find(t => t.category === "Deployment")?.recommendation ?? Object.values(answers).find(v => v.includes("Vercel") || v.includes("AWS") || v.includes("DigitalOcean") || v.includes("Docker")) ?? "To be determined"}

## Architecture
\`\`\`
┌─────────────────────────────────────────────────────────┐
│                    Frontend (${frontend.split("+")[0]?.trim() ?? "Web"})                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Pages: Home, Dashboard, Auth, Settings, Profile  │  │
│  │  Components: Nav, Sidebar, Cards, Forms, Tables   │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │ REST API / GraphQL
┌──────────────────────────▼──────────────────────────────┐
│                   Backend (${backend.split("+")[0]?.trim() ?? "API"})                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │  API Routes: /api/auth, /api/users, /api/data      │  │
│  │  Middleware: Auth, Rate Limiting, Logging          │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │ ORM / Driver
┌──────────────────────────▼──────────────────────────────┐
│              Database (${database})                        │
│  Tables: users, sessions, profiles, content              │
└─────────────────────────────────────────────────────────┘

## Phases Breakdown

### Phase 1 - Planning ✅
- [x] Requirements gathering via interactive Q&A
- [x] Tech stack decisions
- [x] Architecture planning
- [x] Risk assessment
- [x] This plan document

### Phase 2 - Wireframes
- [ ] AI-generated wireframes in SVG/JSON/Penpot formats
- [ ] Design approval flow
- [ ] TDD screenshot verification

### Phase 3 - Development
- [ ] Frontend implementation (Subagent-1)
- [ ] Backend implementation (Subagent-2)
- [ ] Frontend-backend integration (Subagent-3)
- [ ] Debugging and testing (Subagent-4)
- [ ] User feedback and review (Subagent-5)

### Phase 4 - Testing & Security
- [ ] SAST scanning (Semgrep, Gitleaks, Bandit)
- [ ] DAST scanning (OWASP ZAP, Nikto, sqlmap)
- [ ] Code review
- [ ] CI/CD review
- [ ] Security report generation

### Phase 5 - Deployment
- [ ] GitHub repository setup
- [ ] CI/CD pipeline
- [ ] Docker image build
- [ ] Cloud deployment

### Phase 6 - Documentation
- [ ] API documentation
- [ ] User guide
- [ ] Developer guide
- [ ] README update

## Features
1. User authentication and authorization
2. Responsive UI with modern design
3. Database integration with CRUD operations
4. API endpoints with proper error handling
5. Security best practices (XSS, CSRF, SQLi protection)
6. Performance optimization
7. Accessibility compliance
8. Cross-browser compatibility

## Timeline Estimates
- **Phase 1:** ~1 hour
- **Phase 2:** ~2-3 hours
- **Phase 3:** ~8-16 hours (bulk of development)
- **Phase 4:** ~2-4 hours
- **Phase 5:** ~1-2 hours
- **Phase 6:** ~1-2 hours
`;
}

function generateTasks(_input: Phase1Input, session: QASession): string {
	const answers = session.answers.reduce<Record<string, string>>((acc, a) => {
		acc[a.question.slice(0, 30)] = a.answer;
		return acc;
	}, {});
	const frontend =
		Object.values(answers).find(v => v.includes("React") || v.includes("Vue") || v.includes("HTML")) ?? "React";
	const backend =
		Object.values(answers).find(
			v => v.includes("Node") || v.includes("Python") || v.includes("Go") || v.includes("Bun"),
		) ?? "Node.js";

	return `# Tasks

## Phase 2: Wireframes (US-001 to US-005)
### US-001: Wireframe - Landing Page
- [ ] Create landing page wireframe with hero, features, CTA sections
- [ ] Add navigation bar with logo and menu items
- [ ] Design footer with links and contact info

### US-002: Wireframe - Authentication Pages
- [ ] Design login page wireframe
- [ ] Design registration page wireframe
- [ ] Design password reset page wireframe

### US-003: Wireframe - Dashboard
- [ ] Create dashboard layout with sidebar navigation
- [ ] Design analytics cards and charts
- [ ] Add data table component

### US-004: Wireframe - User Profile
- [ ] Design profile settings page
- [ ] Add avatar upload component
- [ ] Design account preferences section

## Phase 3: Development
### US-005: Frontend - Project Setup (Subagent-1)
- [ ] Initialize ${frontend} project
- [ ] Configure Tailwind CSS and Shadcn UI
- [ ] Set up routing structure
- [ ] Create layout components (Nav, Sidebar, Footer)
- [ ] Implement theme provider (light/dark)

### US-006: Frontend - Pages (Subagent-1)
- [ ] Implement landing page with hero section
- [ ] Build authentication pages (login/register/reset)
- [ ] Create dashboard with analytics
- [ ] Build settings and profile pages
- [ ] Implement responsive design

### US-007: Backend - Setup (Subagent-2)
- [ ] Initialize ${backend} backend project
- [ ] Set up database connection and migrations
- [ ] Create user model and authentication
- [ ] Implement API middleware stack
- [ ] Set up error handling and logging

### US-008: Backend - API Endpoints (Subagent-2)
- [ ] Create auth endpoints (register, login, logout, refresh)
- [ ] Build user CRUD endpoints
- [ ] Implement data endpoints
- [ ] Add input validation and sanitization
- [ ] Implement rate limiting

### US-009: Integration (Subagent-3)
- [ ] Connect frontend auth to backend endpoints
- [ ] Wire up data fetching with proper error handling
- [ ] Implement state management
- [ ] Add loading states and error boundaries
- [ ] Test full-stack flows

### US-010: Debug & Test (Subagent-4)
- [ ] Review all code for bugs and issues
- [ ] Fix identified bugs
- [ ] Run integration tests
- [ ] Test all user flows
- [ ] Performance optimization

### US-011: User Feedback (Subagent-5)
- [ ] Create test documentation
- [ ] Generate usage instructions
- [ ] Review session for final approval

## Phase 4: Security
### US-012: SAST Scanning
- [ ] Run Semgrep for code vulnerabilities
- [ ] Run Gitleaks for secret detection
- [ ] Run Bandit for Python security
- [ ] Generate SAST report

### US-013: DAST Scanning
- [ ] Run OWASP ZAP against dev server
- [ ] Run Nikto for web server scan
- [ ] Test for SQL injection
- [ ] Test for XSS and CSRF
- [ ] Generate DAST report

## Phase 5: Deployment
### US-014: CI/CD & Deployment
- [ ] Create GitHub repository
- [ ] Set up GitHub Actions pipeline
- [ ] Build Docker image
- [ ] Deploy to cloud platform
- [ ] Configure environment variables

## Phase 6: Documentation
### US-015: Documentation
- [ ] Generate API documentation
- [ ] Create user guide
- [ ] Create developer guide
- [ ] Update README
`;
}

function generateUserStories(_input: Phase1Input): string {
	return `# User Stories

## US-001: Landing Page
**As a** visitor,
**I want** to see an attractive landing page,
**So that** I understand the product and its value proposition.

### Acceptance Criteria
- Hero section with headline and CTA button
- Features section highlighting key capabilities
- Testimonials or social proof section
- Responsive design
- Fast loading (< 2s)

### Test Scenarios
1. Verify hero section renders with correct text
2. Verify CTA button navigates to signup
3. Verify features section displays all key features
4. Verify page is responsive on mobile/tablet/desktop
5. Verify page loads within performance budget

## US-002: User Authentication
**As a** user,
**I want** to register and login securely,
**So that** I can access my account and data.

### Acceptance Criteria
- Email/password registration with validation
- Login with email and password
- OAuth login (Google/GitHub)
- Password reset flow
- Session management with JWT tokens
- Error handling for invalid credentials

### Test Scenarios
1. Register with valid email and password
2. Login with correct credentials
3. Login with wrong password shows error
4. Password reset email is sent
5. Session persists across page reloads
6. Logout clears session

## US-003: Dashboard
**As a** authenticated user,
**I want** to see a personalized dashboard,
**So that** I can view my data and insights at a glance.

### Acceptance Criteria
- Welcome message with user name
- Key metrics/statistics cards
- Recent activity feed
- Quick action buttons
- Data visualization (charts/graphs)

## US-004: Profile Management
**As a** user,
**I want** to manage my profile settings,
**So that** I can update my personal information and preferences.

### Acceptance Criteria
- Edit name, email, avatar
- Change password
- Theme preference (light/dark)
- Notification settings
- Account deletion option

## US-005: Security & Performance
**As a** system administrator,
**I want** the application to be secure and performant,
**So that** user data is protected and experience is smooth.

### Acceptance Criteria
- HTTPS enabled
- Input validation on all forms
- SQL injection protection
- XSS protection
- CSRF tokens on forms
- Rate limiting on auth endpoints
- Response time < 200ms for API calls
- 99.9% uptime
`;
}

function generateDesign(_input: Phase1Input, session: QASession): string {
	const answers = session.answers.reduce<Record<string, string>>((acc, a) => {
		acc[a.question.slice(0, 30)] = a.answer;
		return acc;
	}, {});
	const frontend =
		Object.values(answers).find(v => v.includes("React") || v.includes("Vue") || v.includes("HTML")) ??
		"React + Next.js";

	return `# Design Document

## Design System

### Color Palette
\`\`\`json
{
  "primary": { "50": "#eff6ff", "100": "#dbeafe", "200": "#bfdbfe", "500": "#3b82f6", "600": "#2563eb", "700": "#1d4ed8", "900": "#1e3a5f" },
  "secondary": { "50": "#f8fafc", "100": "#f1f5f9", "200": "#e2e8f0", "500": "#64748b", "600": "#475569", "700": "#334155", "900": "#0f172a" },
  "accent": { "500": "#f59e0b", "600": "#d97706" },
  "success": { "500": "#10b981" },
  "error": { "500": "#ef4444" },
  "warning": { "500": "#f59e0b" }
}
\`\`\`

### Typography
- **Headings:** Inter / Plus Jakarta Sans (font-weight: 700, 600)
- **Body:** Inter (font-weight: 400, size: 16px base)
- **Monospace:** JetBrains Mono (for code)

### Spacing
- Base unit: 4px (0.25rem)
- Container max-width: 1280px
- Section padding: 4rem (64px) / 2rem (32px) mobile

### Component Library
Using ${frontend} with:
- **Tailwind CSS** for utility-first styling
- **Shadcn UI** for accessible component primitives
- **Radix UI** for headless UI components
- **Lucide React** for icons
- **Recharts / Chart.js** for data visualization

### Page Layouts
1. **Landing Page:** Hero → Features → Testimonials → Pricing → CTA → Footer
2. **Auth Pages:** Centered card layout with form
3. **Dashboard:** Sidebar + Top bar + Main content area
4. **Settings:** Tabbed content within main layout

### Responsive Breakpoints
- sm: 640px (mobile)
- md: 768px (tablet)
- lg: 1024px (desktop)
- xl: 1280px (wide)

### Accessibility
- WCAG 2.1 AA compliance target
- Keyboard navigation support
- Screen reader friendly with aria labels
- Focus indicators on all interactive elements
- Color contrast ratio >= 4.5:1

### Agent Skills Reference
Based on requirements, the following agent skills are recommended:
- UI/UX Design: vercel-labs/agent-skills (UI/UX Pro Max)
- Frontend Components: shadcn/ui component library
- Animation: framer-motion for React transitions
- Data Visualization: Recharts for charts and graphs
`;
}

function generateContextManagement(input: Phase1Input, _session: QASession): string {
	const pct = input.contextBudgetPct ?? (input.mode === "YOLO" ? 90 : 65);
	const totalBudget = 128000;
	const allocated = Math.floor(totalBudget * (pct / 100));
	const buffer = Math.floor(allocated * 0.1);
	const afterBuffer = allocated - buffer;

	return `# Context Management

## Model Settings
- Default Model: auto (largest context window, lowest output cost)
- Context Window: ${totalBudget.toLocaleString()} tokens
- Max Output: 16,384 tokens
- Temperature: 0.7
- Mode: ${input.mode}
- Budget Allocation: ${pct}% (${allocated.toLocaleString()} tokens)

## Token Allocation (with 10% buffer)
| Phase | Allocated | Buffer (10%) | Net |
|-------|-----------|--------------|-----|
| Phase 1 | ${Math.floor(afterBuffer * 0.15).toLocaleString()} | ${Math.floor(afterBuffer * 0.015).toLocaleString()} | ${Math.floor(afterBuffer * 0.135).toLocaleString()} |
| Phase 2 | ${Math.floor(afterBuffer * 0.15).toLocaleString()} | ${Math.floor(afterBuffer * 0.015).toLocaleString()} | ${Math.floor(afterBuffer * 0.135).toLocaleString()} |
| Phase 3 | ${Math.floor(afterBuffer * 0.35).toLocaleString()} | ${Math.floor(afterBuffer * 0.035).toLocaleString()} | ${Math.floor(afterBuffer * 0.315).toLocaleString()} |
| Phase 4 | ${Math.floor(afterBuffer * 0.15).toLocaleString()} | ${Math.floor(afterBuffer * 0.015).toLocaleString()} | ${Math.floor(afterBuffer * 0.135).toLocaleString()} |
| Phase 5 | ${Math.floor(afterBuffer * 0.1).toLocaleString()} | ${Math.floor(afterBuffer * 0.01).toLocaleString()} | ${Math.floor(afterBuffer * 0.09).toLocaleString()} |
| Phase 6 | ${Math.floor(afterBuffer * 0.1).toLocaleString()} | ${Math.floor(afterBuffer * 0.01).toLocaleString()} | ${Math.floor(afterBuffer * 0.09).toLocaleString()} |
| **Total** | **${allocated.toLocaleString()}** | **${buffer.toLocaleString()}** | **${afterBuffer.toLocaleString()}** |

## Rules
- Each phase must stay within its allocation.
- ${input.mode === "HIL" ? "HIL: ask the user before exceeding the budget." : "YOLO: auto-allocate up to the buffer."}
- Auto-compact when nearing limits (80% threshold).
- The auto model is the largest-context, lowest-cost option.

## Session Context
- Prompt: ${input.prompt}
- Mode: ${input.mode}
- ${input.techStack ? `Tech Stack: ${input.techStack}` : ""}
- ${input.languages ? `Languages: ${input.languages.join(", ")}` : ""}
- ${input.frameworks ? `Frameworks: ${input.frameworks.join(", ")}` : ""}
`;
}

function generatePRD(input: Phase1Input, research?: ResearchResult | null): string {
	return `# Product Requirements Document (PRD)

## 1. Executive Summary
**Product:** ${input.prompt}
**Status:** Planning Phase
**Version:** 1.0.0

This document outlines the complete product requirements for ${input.prompt}. The product will be built using the Pakalon 6-phase AI-powered development pipeline.

## 2. Product Overview
### Vision
To deliver a high-quality, production-ready application that meets the user's specified requirements with modern best practices.

### Target Audience
- Primary: End users as specified in the requirements
- Secondary: Administrators and power users
- Tertiary: API consumers and integrators

### Success Metrics
- Application loads within 2 seconds
- All core features functional and tested
- Zero critical security vulnerabilities
- 90%+ test coverage
- Responsive on all device sizes
- Accessibility compliant (WCAG 2.1 AA)

## 3. Features

### Core Features (Must Have)
1. **User Authentication** - Register, login, logout, password reset
2. **Responsive UI** - Works on desktop, tablet, mobile
3. **CRUD Operations** - Create, read, update, delete for primary entities
4. **Data Persistence** - Database integration for all data
5. **API Layer** - RESTful or GraphQL API
6. **Security** - Auth, input validation, XSS/CSRF protection

### Secondary Features (Should Have)
1. **Theme Support** - Light/dark mode toggle
2. **Search Functionality** - Full-text search on data
3. **Pagination** - Efficient data listing
4. **File Upload** - Image/file attachment support
5. **Email Notifications** - Transactional emails

### Nice-to-Have Features
1. **Real-time Updates** - WebSocket/live updates
2. **Advanced Analytics** - Dashboard with charts
3. **Export/Import** - CSV/JSON data export
4. **Multi-language** - i18n support

${
	research?.techStacks && research.techStacks.length > 0
		? `## Research-Based Tech Stack Recommendation
${research.techStacks
	.map(
		t => `### ${t.category}
- **Recommended:** ${t.recommendation}
- **Rationale:** ${t.rationale}
`,
	)
	.join("\n")}
${
	research.marketInfo
		? `## Market Insights
- **Trends:** ${research.marketInfo.trends.join(", ")}
- **Pricing Models:** ${research.marketInfo.pricingModels.join(", ")}
`
		: ""
}
`
		: ""
}

## 4. Technical Requirements
- **Frontend:** Modern JavaScript framework with component architecture
- **Backend:** Scalable API server
- **Database:** Reliable data storage with migrations
- **Authentication:** Secure JWT/OAuth implementation
- **Deployment:** CI/CD pipeline with containerization
`;
}

function generateRiskAssessment(_input: Phase1Input): string {
	return `# Risk Assessment

## Technical Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| API rate limiting | Medium | High | Implement caching, queueing |
| Database performance | Medium | High | Index optimization, query tuning |
| Browser compatibility | Low | Medium | Cross-browser testing, polyfills |
| Third-party dependency failures | Low | High | Version pinning, fallbacks |
| Security vulnerability | Medium | Critical | SAST/DAST scanning, code review |

## Resource Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Token budget exceeded | Medium | High | 10% buffer, compact when needed |
| Model unavailability | Low | Medium | Fallback model chains |
| Development time overrun | Medium | Medium | Scope management, prioritization |

## Schedule Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Complex feature delays | Medium | Medium | Phased delivery, MVP first |
| Integration issues | Medium | High | Incremental integration, early testing |
| Requirement changes | Low | Medium | Clear scope definition, change control |

## Security Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Data breach | Low | Critical | Encryption, auth, audit logging |
| XSS attack | Medium | High | Input sanitization, CSP headers |
| CSRF attack | Medium | High | CSRF tokens, same-site cookies |
| SQL injection | Low | Critical | Parameterized queries, ORM |
| Insecure dependencies | Medium | High | Dependency scanning, regular updates |

## Business Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Poor user adoption | Medium | Medium | User research, iterative feedback |
| Performance issues | Medium | High | Performance testing, optimization |
| Scalability concerns | Low | High | Horizontal scaling, caching |
`;
}

function generateTechnicalSpec(_input: Phase1Input): string {
	return `# Technical Specification

## System Architecture
\`\`\`
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Layer                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Browser (React/Next.js SPA)                                 │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │   │
│  │  │ Pages│ │Components│ │ State│ │ Router │ │ Hooks│          │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP/HTTPS (REST API)
┌────────────────────────────▼────────────────────────────────────────┐
│                         API Layer                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Express/Fastify Server                                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │   │
│  │  │ Routes   │ │Middleware│ │Validation│ │ Error Handler  │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ ORM / Driver
┌────────────────────────────▼────────────────────────────────────────┐
│                       Data Layer                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  PostgreSQL / SQLite / MongoDB                               │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │   │
│  │  │ Tables   │ │Indexes   │ │Migrations│ │   Seeds        │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
\`\`\`

## Component Tree (Frontend)
\`\`\`
App
├── Layout
│   ├── Header (Nav, Logo, UserMenu, ThemeToggle)
│   ├── Sidebar (Navigation Links)
│   └── Main Content
│       ├── LandingPage (Hero, Features, Pricing, CTA)
│       ├── AuthPage (Login, Register, ResetPassword)
│       ├── Dashboard (StatCards, Charts, RecentActivity)
│       ├── Settings (Profile, Security, Preferences)
│       └── NotFound
└── Providers
    ├── ThemeProvider
    ├── AuthProvider
    ├── QueryProvider
    └── ToastProvider
\`\`\`

## API Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/auth/register | Register new user | No |
| POST | /api/auth/login | Login user | No |
| POST | /api/auth/logout | Logout user | Yes |
| POST | /api/auth/refresh | Refresh token | Yes |
| GET | /api/users/me | Get current user | Yes |
| PUT | /api/users/me | Update profile | Yes |
| GET | /api/data | List data | Yes |
| POST | /api/data | Create data | Yes |
| PUT | /api/data/:id | Update data | Yes |
| DELETE | /api/data/:id | Delete data | Yes |

## Database Schema
### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| name | VARCHAR(255) | |
| avatar_url | TEXT | |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | DEFAULT NOW() |

### sessions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| user_id | UUID | FK -> users(id) |
| token | VARCHAR(500) | UNIQUE, NOT NULL |
| expires_at | TIMESTAMP | NOT NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |
`;
}

function generateCompetitiveAnalysis(input: Phase1Input, research?: ResearchResult | null): string {
	return `# Competitive Analysis

## Market Overview
Analysis of competing solutions in the ${input.prompt} space.

## Competitor Comparison
| Feature | This Project | Competitor A | Competitor B | Competitor C |
|---------|-------------|--------------|--------------|--------------|
| Authentication | ✅ | ✅ | ✅ | ❌ |
| Responsive Design | ✅ | ✅ | ✅ | ✅ |
| Dark Mode | ✅ | ❌ | ✅ | ❌ |
| API Access | ✅ | ✅ | ❌ | ✅ |
| Real-time Updates | ✅ | ❌ | ✅ | ❌ |
| Customizable | ✅ | ❌ | ✅ | ✅ |
| Open Source | ✅ | ❌ | ❌ | ✅ |
| Security Scanned | ✅ | ❌ | ❌ | ❌ |
| CI/CD Built-in | ✅ | ❌ | ❌ | ❌ |

${
	research?.competitors && research.competitors.length > 0
		? `## Research-Based Competitors
${research.competitors
	.map(
		c => `### ${c.name}
${c.description}
- **Key Features:** ${c.keyFeatures.join(", ")}
- **Strengths:** ${c.strengths.join(", ")}
- **Weaknesses:** ${c.weaknesses.join(", ")}
`,
	)
	.join("\n")}
`
		: ""
}

## Differentiation Strategy
1. **AI-Powered Development:** 6-phase autonomous pipeline from planning to deployment
2. **Security-First:** Integrated SAST/DAST scanning in Phase 4
3. **Modern Stack:** Latest frameworks with Tailwind CSS, Shadcn UI
4. **Full Automation:** CI/CD, Docker, cloud deployment built-in
5. **Comprehensive Documentation:** Auto-generated API docs, user guides

## Market Position
Positioned as a premium, fully-automated application builder for developers who want production-ready code without manual configuration.
`;
}

function generateConstraintsAndTradeoffs(_input: Phase1Input): string {
	return `# Constraints & Trade-offs

## Technical Constraints
1. **TypeScript Only:** The entire codebase must be in TypeScript (no Python/LangGraph)
2. **Bun Runtime:** Development and execution using Bun (not Node.js)
3. **Package Scope:** Changes limited to packages/ directory in the monorepo
4. **OpenRouter API:** All LLM calls go through OpenRouter with single master key
5. **Docker Required:** Security tools (Phase 4) and Penpot (Phase 2) run in Docker

## Resource Constraints
1. **Token Budget:** 128,000 token context window with 10% buffer
2. **Model Selection:** Auto model selection based on task requirements
3. **API Rate Limits:** OpenRouter rate limiting for free tier models

## Trade-off Decisions
| Decision | Option A | Option B | Chosen | Rationale |
|----------|----------|----------|--------|-----------|
| Runtime | Node.js | Bun | Bun | Better performance, built-in tooling |
| Styling | CSS Modules | Tailwind | Tailwind | Faster development, consistent design |
| Auth | Custom JWT | Supabase Auth | Supabase | Faster implementation, built-in features |
| Database | MongoDB | PostgreSQL | PostgreSQL | Better relations, Supabase compatibility |
| Deployment | Manual | CI/CD | CI/CD | Automated, reliable releases |
| Testing | Unit only | Full suite | Full suite | Security-critical application |

## Scope Boundaries
### In Scope
- Full 6-phase pipeline execution
- AI-powered code generation
- Security scanning with SAST/DAST
- CI/CD and deployment automation
- Comprehensive documentation

### Out of Scope (v1)
- Mobile native apps (iOS/Android)
- Desktop applications
- Machine learning model training
- Custom plugin marketplace
`;
}

function generateAgentSkills(_input: Phase1Input): string {
	return `# Agent Skills

## Recommended Skills for This Project

### UI/UX Design Skills
- **UI/UX Pro Max** (https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
  - Advanced component design patterns
  - Accessibility-first approach
  - Responsive design strategies
- **Vercel Agent Skills** (https://github.com/vercel-labs/agent-skills)
  - Modern UI patterns
  - Performance optimization
  - Best practices for React/Next.js

### Frontend Skills
- Tailwind CSS utility-first styling
- Shadcn UI component patterns
- Radix UI headless components
- React hooks and custom hooks patterns
- State management (Zustand/Redux)

### Backend Skills
- API design best practices (RESTful)
- Database schema design
- Authentication/authorization patterns
- Error handling and logging
- Rate limiting and security

### Testing Skills
- Unit testing with Vitest
- Integration testing strategies
- E2E testing with Playwright
- Security testing methodology

### Deployment Skills
- Docker containerization
- CI/CD pipeline configuration
- Cloud platform deployment
- Environment management

### Skill Sources
1. https://github.com/vercel-labs/agent-skills
2. https://skills.sh/vercel-labs/agent-skills
3. https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
4. https://agentskills.io/home
`;
}

// ─── Main Phase 1 Runner ──────────────────────────────────────────────────────

export async function runPhase1(cwd: string, input: Phase1Input): Promise<Phase1Output> {
	logger.info("Phase 1: Planning & Requirements started", { cwd, mode: input.mode });
	const dir = PHASE1_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });

	// Run brainstorming session
	const session = await runBrainstormingSession(input);

	let researchData: ResearchResult | null = null;
	if (input.enableResearch) {
		try {
			const provider = new ResearchProvider();
			researchData = await provider.research(input.prompt);
			writeResearchData(dir, researchData);
			logger.info("Web research completed and saved", {
				techStacks: researchData.techStacks.length,
				competitors: researchData.competitors.length,
			});
		} catch (err) {
			logger.warn("Web research failed, continuing with template data", { error: err });
		}
	}

	// Generate all document content
	const plan = generatePlan(input, session, researchData);
	const tasks = generateTasks(input, session);
	const userStories = generateUserStories(input);
	const design = generateDesign(input, session);
	const contextManagement = generateContextManagement(input, session);
	const prd = generatePRD(input, researchData);
	const riskAssessment = generateRiskAssessment(input);
	const technicalSpec = generateTechnicalSpec(input);
	const competitiveAnalysis = generateCompetitiveAnalysis(input, researchData);
	const constraints = generateConstraintsAndTradeoffs(input);
	const agentSkills = generateAgentSkills(input);

	// Generate API Reference
	const apiReference = generateTechnicalSpec(input);
	// Generate Database Schema
	const dbSchemaSection = technicalSpec.split("## Database Schema")[1] ?? "";
	const databaseSchema = `# Database Schema\n${dbSchemaSection}`;

	// Phase 1 summary document
	const phase1Doc = `# Phase 1: Planning & Requirements

## Summary
- **Mode:** ${input.mode}
- **Prompt:** ${input.prompt}
- **Q&A Sessions:** ${session.answers.length} questions answered
- **Web Research:** ${researchData ? "✅ Completed" : "❌ Not enabled"}
- **Status:** Complete

## Generated Files (${14 + (researchData ? 1 : 0)})
| File | Description |
|------|-------------|
| plan.md | Complete project plan with architecture |
| tasks.md | Task breakdown with US numbering |
| user-stories.md | User stories with acceptance criteria |
| design.md | Design system and UI guidelines |
| context_management.md | Token allocation and budget |
| API_reference.md | API endpoints and schemas |
| Database_schema.md | Database tables and relationships |
| prd.md | Product requirements document |
| risk-assessment.md | Risk analysis and mitigations |
| technical-spec.md | Technical architecture specification |
| competitive-analysis.md | Market and competitor analysis |
| constraints-and-tradeoffs.md | Constraints and decisions |
| agent-skills.md | Recommended agent skills |
| phase-1.md | This summary document |

## Decisions Made
${session.answers.map(a => `- **${a.question}** → ${a.answer}`).join("\n")}

## Next Steps
Proceed to Phase 2: Wireframe & Design
`;

	// Write all files to disk
	const files: Array<[string, string]> = [
		["plan.md", plan],
		["tasks.md", tasks],
		["user-stories.md", userStories],
		["design.md", design],
		["context_management.md", contextManagement],
		["API_reference.md", apiReference],
		["Database_schema.md", databaseSchema],
		["phase-1.md", phase1Doc],
		["prd.md", prd],
		["risk-assessment.md", riskAssessment],
		["technical-spec.md", technicalSpec],
		["competitive-analysis.md", competitiveAnalysis],
		["constraints-and-tradeoffs.md", constraints],
		["agent-skills.md", agentSkills],
	];

	if (researchData) {
		const researchMd = new ResearchProvider().toMarkdown(researchData);
		files.push(["research-data.md", researchMd]);
	}

	for (const [filename, content] of files) {
		fs.writeFileSync(path.join(dir, filename), content);
	}

	// Also write planning context for phase-to-phase memory passing
	const memoryContext = {
		phase: "phase-1",
		prompt: input.prompt,
		mode: input.mode,
		decisions: session.answers.map(a => ({ question: a.question, answer: a.answer })),
		techStack: {
			frontend: session.answers.find(a => a.question.includes("frontend"))?.answer ?? "React",
			backend: session.answers.find(a => a.question.includes("backend"))?.answer ?? "Node.js",
			database: session.answers.find(a => a.question.includes("database"))?.answer ?? "PostgreSQL",
			auth: session.answers.find(a => a.question.includes("auth"))?.answer ?? "JWT",
		},
		generatedAt: new Date().toISOString(),
		filesGenerated: files.map(f => f[0]),
	};
	fs.writeFileSync(path.join(dir, ".memory.json"), JSON.stringify(memoryContext, null, 2));

	const output: Phase1Output = {
		plan,
		tasks,
		userStories,
		design,
		contextManagement,
		apiReference,
		databaseSchema,
		phase1Doc,
		prd,
		riskAssessment,
		technicalSpec,
		competitiveAnalysis,
		constraints,
		agentSkills,
	};

	logger.info("Phase 1 completed", {
		filesGenerated: files.length,
		mode: input.mode,
		questionsAnswered: session.answers.length,
	});
	return output;
}
