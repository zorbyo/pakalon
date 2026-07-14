import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { Phase6Input, Phase6Output } from "./types";

const PHASE6_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-6");
const PHASE1_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");

function loadPhase1Memory(cwd: string): Record<string, any> {
	try {
		return JSON.parse(fs.readFileSync(path.join(PHASE1_DIR(cwd), ".memory.json"), "utf-8"));
	} catch {
		return {};
	}
}

function generateApiDocs(projectName: string): string {
	return `# ${projectName} API Documentation

## Overview
Base URL: \`https://api.${projectName.toLowerCase().replace(/\s+/g, "-")}.com\`
Version: 1.0.0
Format: REST API with JSON responses
Auth: JWT Bearer tokens

## Authentication

### Register
\`\`\`http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "John Doe"
}
\`\`\`

**Response:** \`201 Created\`
\`\`\`json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "createdAt": "2025-01-01T00:00:00Z"
}
\`\`\`

### Login
\`\`\`http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123"
}
\`\`\`

**Response:** \`200 OK\`
\`\`\`json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "dGhpcyBpcyBhIHJlZnJl...",
  "expiresIn": 900
}
\`\`\`

### Refresh Token
\`\`\`http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "dGhpcyBpcyBhIHJlZnJl..."
}
\`\`\`

**Response:** \`200 OK\`
\`\`\`json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900
}
\`\`\`

### Logout
\`\`\`http
POST /api/auth/logout
Authorization: Bearer <token>
\`\`\`

**Response:** \`204 No Content\`

## User Endpoints

### Get Current User
\`\`\`http
GET /api/users/me
Authorization: Bearer <token>
\`\`\`

**Response:** \`200 OK\`
\`\`\`json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "avatarUrl": "https://example.com/avatar.jpg",
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-15T00:00:00Z"
}
\`\`\`

### Update Profile
\`\`\`http
PUT /api/users/me
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Jane Doe",
  "avatarUrl": "https://example.com/new-avatar.jpg"
}
\`\`\`

**Response:** \`200 OK\`

## Data Endpoints

### List Items
\`\`\`http
GET /api/data?page=1&limit=20&sort=createdAt&order=desc
Authorization: Bearer <token>
\`\`\`

**Response:** \`200 OK\`
\`\`\`json
{
  "data": [
    {
      "id": "uuid",
      "title": "Item title",
      "description": "Item description",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
\`\`\`

### Create Item
\`\`\`http
POST /api/data
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "New Item",
  "description": "Item description"
}
\`\`\`

**Response:** \`201 Created\`

### Get Item
\`\`\`http
GET /api/data/:id
Authorization: Bearer <token>
\`\`\`

**Response:** \`200 OK\`

### Update Item
\`\`\`http
PUT /api/data/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Updated Title",
  "description": "Updated description"
}
\`\`\`

**Response:** \`200 OK\`

### Delete Item
\`\`\`http
DELETE /api/data/:id
Authorization: Bearer <token>
\`\`\`

**Response:** \`204 No Content\`

## Error Responses

### Validation Error
\`\`\`json
{
  "error": "ValidationError",
  "message": "Validation failed",
  "details": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
\`\`\`

### Authentication Error
\`\`\`json
{
  "error": "Unauthorized",
  "message": "Invalid or expired token"
}
\`\`\`

### Not Found
\`\`\`json
{
  "error": "NotFound",
  "message": "Resource not found"
}
\`\`\`

### Rate Limit Exceeded
\`\`\`json
{
  "error": "RateLimitExceeded",
  "message": "Too many requests. Please try again later.",
  "retryAfter": 60
}
\`\`\`

## Rate Limiting
- General API: 100 requests per minute
- Auth endpoints: 10 requests per minute
- Headers: \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\`

## Status Codes
| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 422 | Unprocessable Entity |
| 429 | Rate Limit Exceeded |
| 500 | Internal Server Error |
`;
}

function generateUserGuide(projectName: string): string {
	return `# ${projectName} User Guide

## Getting Started

### Welcome
Welcome to ${projectName}! This guide will help you get started using the application.

### System Requirements
- Modern web browser (Chrome 120+, Firefox 120+, Safari 17+, Edge 120+)
- Internet connection
- JavaScript enabled
- Screen resolution: 1024x768 or higher

### Accessing the Application
1. Open your web browser
2. Navigate to the application URL
3. You will see the landing page with options to login or register

## Authentication

### Creating an Account
1. Click "Sign Up" or "Register" button on the landing page
2. Fill in the registration form:
   - Email address
   - Password (minimum 8 characters)
   - Your name
3. Click "Create Account"
4. You will be automatically logged in

### Logging In
1. Click "Login" button
2. Enter your email and password
3. Click "Sign In"
4. You will be redirected to the dashboard

### Password Reset
1. Click "Forgot Password?" on the login page
2. Enter your email address
3. Check your email for reset instructions
4. Follow the link to create a new password

## Dashboard

### Overview
The dashboard is your main hub for managing data and viewing insights.

### Statistics Cards
- **Total Items**: Number of items in your account
- **Active Today**: Items modified in the last 24 hours
- **Pending Actions**: Items requiring attention
- **Recent Activity**: Latest changes to your data

### Recent Activity Feed
The activity feed shows recent changes made to your data:
- New items created
- Items updated
- Items deleted
- User account changes

### Data Table
The data table displays all your items with sorting and pagination:
- Click column headers to sort
- Use pagination controls to navigate pages
- Click on a row to view details
- Use the search bar to filter items

## Managing Data

### Creating Items
1. Click "Add New" button
2. Fill in the required fields
3. Click "Save"
4. The new item appears in your data table

### Viewing Items
1. Click on an item row in the table
2. A detail view opens with all item information
3. Click "Close" or "Back" to return to the list

### Editing Items
1. Find the item in the data table
2. Click the "Edit" button
3. Modify the fields you want to change
4. Click "Save Changes"

### Deleting Items
1. Find the item in the data table
2. Click the "Delete" button
3. Confirm deletion in the dialog
4. The item is permanently removed

## Settings

### Profile Settings
- **Name**: Update your display name
- **Email**: Change your email address
- **Avatar**: Upload a profile picture

### Account Security
- **Change Password**: Update your password
- **Two-Factor Authentication**: Enable for extra security

### Preferences
- **Theme**: Switch between light and dark mode
- **Language**: Select your preferred language
- **Notifications**: Configure email notifications

### Danger Zone
- **Delete Account**: Permanently delete your account and all data
  - This action cannot be undone
  - All data will be permanently removed
  - You will need to create a new account to use the application again

## Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| \`Ctrl + /\` | Search |
| \`Ctrl + N\` | New item |
| \`Ctrl + S\` | Save changes |
| \`Ctrl + D\` | Delete selected |
| \`?\` | Show keyboard shortcuts |

## Troubleshooting

### Login Issues
- **Forgot password**: Use the password reset flow
- **Account locked**: Wait 15 minutes for the lock to expire
- **Browser issues**: Clear cookies and cache, try incognito mode

### Performance Issues
- Clear browser cache
- Disable browser extensions
- Try a different browser
- Check your internet connection

### Error Messages
- **"Network error"**: Check your internet connection
- **"Session expired"**: Log in again
- **"Permission denied"**: Contact your administrator

## Support
- Documentation: See the developer guide for technical details
- Email: support@${projectName.toLowerCase().replace(/\s+/g, "")}.com
- GitHub: Report issues on our GitHub repository
`;
}

function generateDeveloperGuide(projectName: string): string {
	return `# ${projectName} Developer Guide

## Architecture Overview

### Tech Stack
- **Frontend:** React/Next.js with TypeScript
- **Backend:** Node.js/Express with TypeScript
- **Database:** PostgreSQL (via Supabase or direct)
- **Styling:** Tailwind CSS + Shadcn UI
- **State Management:** Zustand
- **API Client:** TanStack Query
- **Authentication:** JWT with httpOnly cookies

### Project Structure
\`\`\`
${projectName.toLowerCase().replace(/\s+/g, "-")}/
├── src/
│   ├── app/                 # Next.js App Router pages
│   │   ├── (auth)/         # Auth pages (login, register)
│   │   ├── dashboard/      # Dashboard pages
│   │   └── settings/       # Settings pages
│   ├── components/         # React components
│   │   ├── auth/          # Auth components
│   │   ├── common/        # Shared UI components
│   │   ├── dashboard/     # Dashboard components
│   │   └── layout/        # Layout components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utilities and API client
│   └── providers/         # Context providers
├── backend/               # Backend application
│   ├── src/
│   │   ├── db/           # Database schema and migrations
│   │   ├── routes/       # API route handlers
│   │   ├── middleware/   # Express middleware
│   │   └── lib/          # Backend utilities
│   └── package.json
├── tests/                 # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docker-compose.yml     # Docker services
├── Dockerfile             # Multi-stage build
└── .github/workflows/     # CI/CD pipelines
\`\`\`

## Setup Development Environment

### Prerequisites
- Bun 1.0+ (recommended) or Node.js 20+
- Docker (optional, for database)
- Git

### Local Setup
\`\`\`bash
# Clone the repository
git clone <repository-url>
cd ${projectName.toLowerCase().replace(/\s+/g, "-")}

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your configuration

# Start the development servers
bun run dev          # Frontend on http://localhost:3000
cd backend && bun run dev  # Backend on http://localhost:3001
\`\`\`

### Database Setup
\`\`\`bash
# Using Docker
docker compose up -d postgres

# Run migrations
cd backend && bun run migrate

# Seed data (optional)
bun run seed
\`\`\`

## Development Workflow

### Code Style
- TypeScript strict mode is enabled
- Use ESLint and Prettier for code formatting
- Follow the existing component patterns
- Write tests for new features

### Git Workflow
1. Create a feature branch: \`git checkout -b feature/your-feature\`
2. Make changes and commit: \`git commit -m "feat: add your feature"\`
3. Push and create PR: \`git push origin feature/your-feature\`
4. CI/CD pipeline runs automated checks
5. Merge after review and CI passes

### Testing
\`\`\`bash
# Run all tests
bun run test

# Run unit tests
bun run test:unit

# Run integration tests
bun run test:integration

# Run E2E tests (requires dev servers)
bun run test:e2e

# Run with coverage
bun run test:coverage
\`\`\`

### Building for Production
\`\`\`bash
# Build the application
bun run build

# Build Docker image
docker build -t ${projectName.toLowerCase().replace(/\s+/g, "-")}:latest .

# Run with Docker Compose
docker compose up -d
\`\`\`

## API Integration

### Making API Calls
\`\`\`typescript
import { api } from "@/lib/api";

// GET request
const data = await api.get("/api/data");

// POST request
const result = await api.post("/api/data", {
  title: "New Item",
  description: "Description",
});

// With auth headers (auto-included)
const user = await api.get("/api/users/me");
\`\`\`

### Custom Hooks
\`\`\`typescript
import { useQuery, useMutation } from "@tanstack/react-query";

// Fetch data
const { data, isLoading } = useQuery({
  queryKey: ["items"],
  queryFn: () => api.get("/api/data"),
});

// Mutate data
const mutation = useMutation({
  mutationFn: (newItem) => api.post("/api/data", newItem),
  onSuccess: () => {
    // Invalidate and refetch
    queryClient.invalidateQueries({ queryKey: ["items"] });
  },
});
\`\`\`

## Deployment

### CI/CD Pipeline
The repository includes GitHub Actions workflow:
1. **Lint** - Code quality and type checking
2. **Test** - Automated test suite
3. **Security** - SAST scanning with Gitleaks + Semgrep
4. **Build** - Application and Docker image build
5. **Deploy** - Automated deployment to cloud target

### Environment Variables
| Variable | Description | Required |
|----------|-------------|----------|
| \`DATABASE_URL\` | PostgreSQL connection string | Yes |
| \`JWT_SECRET\` | JWT signing secret | Yes |
| \`NEXT_PUBLIC_API_URL\` | Backend API URL | Yes |
| \`NODE_ENV\` | Environment (development/production) | Yes |

### Docker Deployment
\`\`\`bash
# Build and run
docker compose up -d --build

# View logs
docker compose logs -f

# Stop services
docker compose down
\`\`\`

## Security Guidelines

### Authentication
- Passwords hashed with bcrypt (cost factor 12)
- JWT tokens with 15-minute expiry
- Refresh tokens with 7-day expiry
- httpOnly cookies for token storage

### API Security
- Rate limiting on all endpoints
- CORS restricted to known origins
- Input validation with Zod schemas
- SQL injection protection via parameterized queries
- XSS protection with output encoding
- CSRF protection with double-submit cookies

### Best Practices
- Never commit secrets or API keys
- Use environment variables for configuration
- Run security scans before deployment
- Keep dependencies updated
- Follow OWASP Top 10 guidelines

## Monitoring & Logging

### Application Logs
\`\`\`bash
# View application logs
docker compose logs -f app

# Backend logs
docker compose logs -f postgres
docker compose logs -f redis
\`\`\`

### Health Checks
- \`GET /health\` - Application health status
- \`GET /api/health\` - API health with database check

### Performance Monitoring
- API response times
- Database query performance
- Memory and CPU usage
- Error rates and types
- User activity metrics
`;
}

function generateDocMd(projectName: string, phase1Memory: Record<string, any>): string {
	const techStack = (phase1Memory as any).techStack ?? {};
	const features = (phase1Memory as any).features ?? (phase1Memory as any).userRequirements ?? "N/A";
	const pages = (phase1Memory as any).pages ?? [];
	const endpoints = (phase1Memory as any).apiEndpoints ?? [];

	return `# ${projectName} — Complete Documentation

> Auto-generated by Pakalon Phase 6. Last updated: ${new Date().toISOString()}

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Architecture](#architecture)
5. [Getting Started](#getting-started)
6. [API Reference](#api-reference)
7. [Database Schema](#database-schema)
8. [Frontend Pages](#frontend-pages)
9. [Authentication & Billing](#authentication--billing)
10. [Testing](#testing)
11. [Deployment](#deployment)
12. [Security](#security)
13. [Troubleshooting](#troubleshooting)

---

## Overview

${projectName} is a full-stack application built using Pakalon's 6-phase autonomous AI build pipeline. This document provides a complete guide to understanding, using, and extending the application.

**Build Pipeline Phases:**
- Phase 1: Planning & Requirements
- Phase 2: Wireframe & Design
- Phase 3: Development & Implementation
- Phase 4: Testing & Security QA
- Phase 5: Deployment & Integration
- Phase 6: Documentation

---

## Features

\`\`\`text
${typeof features === "string" ? features : JSON.stringify(features, null, 2)}
\`\`\`

---

## Tech Stack

| Layer         | Technology                                       |
|---------------|--------------------------------------------------|
| **Frontend**  | ${techStack.frontend ?? "React + Next.js + TypeScript + Tailwind CSS + Shadcn UI"} |
| **Backend**   | ${techStack.backend ?? "Node.js + Express + TypeScript"} |
| **Database**  | ${techStack.database ?? "PostgreSQL"}            |
| **Auth**      | ${techStack.auth ?? "JWT"}                       |
| **ORM**       | ${techStack.orm ?? "Drizzle ORM / Prisma"}        |
| **Deployment**| Docker + Docker Compose + GitHub Actions CI/CD  |
| **LLM**       | OpenRouter (40+ providers)                       |

---

## Architecture

\`\`\`
${projectName.toLowerCase().replace(/\s+/g, "-")}/
├── src/                    # Frontend source code
│   ├── app/               # App Router pages
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # API client, auth utilities
│   └── providers/         # Context providers
├── backend/               # Backend source code
│   ├── src/
│   │   ├── db/           # Database schema + migrations
│   │   ├── routes/       # API route handlers
│   │   ├── middleware/   # Express middleware
│   │   └── lib/          # Backend utilities
│   └── package.json
├── docs/                  # API docs, guides
├── tests/                 # Unit / integration / E2E tests
├── .github/workflows/     # CI/CD pipelines
├── Dockerfile             # Multi-stage Docker build
├── docker-compose.yml     # Docker services (app, postgres, redis)
├── README.md              # Project README
└── doc.md                 # This document
\`\`\`

---

## Getting Started

### Prerequisites

- **Bun 1.3+** (recommended) or Node.js 20+
- **Docker** and Docker Compose
- **Git**

### Installation

\`\`\`bash
# Clone the repository
git clone <repository-url>
cd ${projectName.toLowerCase().replace(/\s+/g, "-")}

# Install dependencies (frontend + backend)
bun install
cd backend && bun install && cd ..

# Set up environment variables
cp .env.example .env.local
cp backend/.env.example backend/.env
# Edit with your configuration

# Start development servers
bun run dev              # Frontend → http://localhost:3000
cd backend && bun run dev # Backend → http://localhost:3001
\`\`\`

### Docker Quick-Start

\`\`\`bash
docker compose up -d --build
# App → http://localhost:3000
# API → http://localhost:3001
\`\`\`

---

## API Reference

### Authentication Endpoints

\`\`\`http
POST   /api/auth/register       Register a new user
POST   /api/auth/login          Login with email + password
POST   /api/auth/logout         Logout (clears session)
POST   /api/auth/refresh        Refresh access token
\`\`\`

### User Endpoints

\`\`\`http
GET    /api/users/me            Get current user profile
PUT    /api/users/me            Update user profile
\`\`\`

### Data Endpoints${endpoints.length > 0 ? `\n\`\`\`http\n${endpoints.join("\n")}\n\`\`\`` : "\nSee backend/src/routes/ for full list.\n"}

### Error Responses

| Code | Meaning          |
|------|-----------------|
| 400  | Bad Request     |
| 401  | Unauthorized    |
| 403  | Forbidden       |
| 404  | Not Found       |
| 422  | Validation Error|
| 429  | Rate Limited    |
| 500  | Server Error    |

---

## Database Schema

Key tables:

| Table       | Description                        |
|-------------|------------------------------------|
| \`users\`    | User accounts (email, password hash)|
| \`sessions\` | Auth sessions (JWT refresh tokens) |
| \`profiles\` | User profile data                  |
| \`items\`    | Main application data entity       |

See \`backend/src/db/schema.ts\` for the full Drizzle ORM schema definition.

---

## Frontend Pages${pages.length > 0 ? `\n${pages.map((p: any) => `- **${p.name ?? p}** — ${p.description ?? ""}`).join("\n")}` : "\nGenerated in Phase 2 based on wireframes.\n"}

---

## Authentication & Billing

### Auth

- JWT access tokens with 15-minute expiry
- Refresh tokens with 7-day expiry
- httpOnly cookie storage
- Password hashing with bcrypt (cost factor 12)

### Billing (Pro Users)

- Post-paid billing: pay only for tokens used
- 10% platform fee on total usage
- $2 deposit at signup
- 7-day email reminders before billing
- Payment via Polar

---

## Testing

### Test Types

| Type              | Tool            | Scope                          |
|-------------------|-----------------|--------------------------------|
| Unit              | Vitest          | Individual functions/components|
| Integration       | Vitest          | API routes + DB                |
| E2E               | Playwright      | Full user flows                |
| Security (SAST)   | Semgrep, Gitleaks, Bandit | Code vulnerabilities|
| Security (DAST)   | OWASP ZAP, Nikto, sqlmap    | Runtime vulnerabilities|

### Running Tests

\`\`\`bash
bun run test              # All tests
bun run test:unit         # Unit tests
bun run test:integration  # Integration tests
bun run test:e2e          # E2E tests
\`\`\`

Security scanning (Phase 4):

\`\`\`bash
docker compose -f docker-compose.security.yml up -d
# Scans run automatically; results in .pakalon-agents/ai-agents/phase-4/
\`\`\`

---

## Deployment

### CI/CD Pipeline

GitHub Actions workflow runs on every push:

1. **Lint** — ESLint + TypeScript type checking
2. **Test** — Unit + integration tests
3. **Security** — Gitleaks + Semgrep scanning
4. **Build** — Docker image build + push to registry
5. **Deploy** — Cloud deployment (configurable)

### Cloud Targets

| Platform | Guide Location           |
|----------|--------------------------|
| AWS      | docs/deployment/aws.md   |
| DigitalOcean | docs/deployment/do.md|
| Azure    | docs/deployment/azure.md |
| GCP      | docs/deployment/gcp.md   |

### Manual Deployment

\`\`\`bash
docker build -t ${projectName.toLowerCase().replace(/\s+/g, "-")}:latest .
docker run -d -p 3000:3000 ${projectName.toLowerCase().replace(/\s+/g, "-")}:latest
\`\`\`

---

## Security

### Authentication & Authorization
- JWT Bearer tokens
- httpOnly cookies
- bcrypt password hashing (cost 12)
- Rate limiting (100 req/min general, 10 req/min auth)

### Input Validation
- Zod schemas on all endpoints
- SQL injection protection (parameterized queries)
- XSS protection (output encoding)
- CSRF protection (double-submit cookies)

### Security Scanning
- SAST: Semgrep, Gitleaks, Bandit
- DAST: OWASP ZAP, Nikto, sqlmap
- Container scanning in CI/CD

---

## Troubleshooting

### Common Issues

| Issue                       | Solution                                              |
|-----------------------------|-------------------------------------------------------|
| Port 3000/3001 already in use| \`lsof -ti:3000 | xargs kill -9\` (or change PORT) |
| Database connection refused  | Ensure PostgreSQL is running; check DATABASE_URL     |
| Build fails                  | Run \`bun install\` in both root and backend/         |
| Auth token expired           | Refresh token auto-renews; re-login if needed         |
| Docker out of memory         | Increase Docker Desktop memory to 4GB+                |

### Resetting State

\`\`\`bash
# Clear local auth state
rm -rf ~/.config/pakalon/
# Clear project state
rm -rf .pakalon-agents/
\`\`\`

### Getting Help

- Docs: \`/help\` in the CLI
- Issues: GitHub Issues
- Community: Discord / Slack

---

*Generated by Pakalon AI — 6-Phase Autonomous Build Pipeline*
`;
}

export async function runPhase6(cwd: string, _input?: Phase6Input): Promise<Phase6Output> {
	logger.info("Phase 6: Documentation started", { cwd });
	const dir = PHASE6_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });

	const phase1Memory = loadPhase1Memory(cwd);
	const projectName = (phase1Memory as any).prompt ?? path.basename(cwd);

	const apiDocs = generateApiDocs(projectName);
	const userGuide = generateUserGuide(projectName);
	const developerGuide = generateDeveloperGuide(projectName);
	const docMd = generateDocMd(projectName, phase1Memory);

	const docsDir = path.join(cwd, "docs");
	fs.mkdirSync(docsDir, { recursive: true });
	fs.mkdirSync(path.join(docsDir, "api"), { recursive: true });
	fs.mkdirSync(path.join(docsDir, "guides"), { recursive: true });

	fs.writeFileSync(path.join(docsDir, "api", "README.md"), apiDocs);
	fs.writeFileSync(path.join(docsDir, "guides", "user-guide.md"), userGuide);
	fs.writeFileSync(path.join(docsDir, "guides", "developer-guide.md"), developerGuide);
	fs.writeFileSync(path.join(cwd, "doc.md"), docMd);

	const readmePath = path.join(cwd, "README.md");
	const readmeContent = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf-8") : "";
	const hasPakalonMarker =
		readmeContent.includes("Built with Pakalon AI") || readmeContent.includes("# Project Readme");
	const readmeUpdated = hasPakalonMarker
		? `# ${projectName}

> Built with Pakalon AI - 6-Phase Autonomous Build Pipeline

## Overview
${projectName} is a full-stack application generated by Pakalon's AI-powered 6-phase build pipeline.

## Quick Start

\`\`\`bash
# Install dependencies
bun install

# Start development server
bun run dev
\`\`\`

## Documentation
- [Complete Documentation](./doc.md)
- [API Documentation](./docs/api/README.md)
- [User Guide](./docs/guides/user-guide.md)
- [Developer Guide](./docs/guides/developer-guide.md)

## Tech Stack
- **Frontend:** ${(phase1Memory as any).techStack?.frontend ?? "React/Next.js + TypeScript + Tailwind CSS + Shadcn UI"}
- **Backend:** ${(phase1Memory as any).techStack?.backend ?? "Node.js/Express + TypeScript"}
- **Database:** ${(phase1Memory as any).techStack?.database ?? "PostgreSQL"}
- **Deployment:** Docker + CI/CD

## Project Structure
\`\`\`
.
├── src/              # Frontend source code
├── backend/          # Backend API server
├── docs/             # Documentation
├── tests/            # Test files
├── .github/workflows/# CI/CD pipelines
├── Dockerfile        # Container build
├── docker-compose.yml # Development services
└── doc.md            # Complete documentation
\`\`\`

## License
MIT
`
		: readmeContent;

	if (hasPakalonMarker) {
		fs.writeFileSync(readmePath, readmeUpdated);
	}

	fs.writeFileSync(path.join(dir, "api-docs.md"), apiDocs);
	fs.writeFileSync(path.join(dir, "user-guide.md"), userGuide);
	fs.writeFileSync(path.join(dir, "developer-guide.md"), developerGuide);

	const phase6Doc = `# Phase 6: Documentation Summary

## Overview
- **Generated:** ${new Date().toISOString()}
- **Project:** ${projectName}
- **Status:** Complete

## Generated Documentation
| File | Description |
|------|-------------|
| doc.md | Complete end-user + technical documentation (project root) |
| docs/api/README.md | API documentation with endpoints and examples |
| docs/guides/user-guide.md | End-user guide for the application |
| docs/guides/developer-guide.md | Developer setup and contribution guide |
| README.md | Updated project README |
| phase-6.md | This summary document |

## Documentation Contents

### doc.md
- Project overview, features, and tech stack
- Architecture and project structure
- Getting started guide
- Complete API reference
- Database schema overview
- Frontend pages listing
- Authentication and billing information
- Testing guide
- Deployment instructions
- Security best practices
- Troubleshooting guide

### API Documentation
- Authentication endpoints (register, login, logout, refresh)
- User endpoints (profile CRUD)
- Data endpoints (full CRUD with pagination)
- Error response formats
- Rate limiting details
- Status code reference

### User Guide
- Getting started instructions
- Authentication walkthrough
- Dashboard overview
- Data management guide
- Settings and preferences
- Keyboard shortcuts
- Troubleshooting

### Developer Guide
- Architecture overview
- Setup instructions
- Development workflow
- API integration examples
- Deployment guide
- Security guidelines
- Monitoring and logging

## Next Steps
1. Review and customize documentation as needed
2. Add screenshots to the user guide
3. Publish API docs with your preferred tool (Swagger, Postman)
4. Share user guide with your users
5. Share developer guide with your team

## Pipeline Complete
🎉 All 6 phases of the Pakalon build pipeline are complete!
`;

	fs.writeFileSync(path.join(dir, "phase-6.md"), phase6Doc);

	const memoryContext = {
		phase: "phase-6",
		projectName,
		docMdGenerated: true,
		apiDocsGenerated: true,
		userGuideGenerated: true,
		developerGuideGenerated: true,
		readmeUpdated: hasPakalonMarker,
		completedAt: new Date().toISOString(),
	};
	fs.writeFileSync(path.join(dir, ".memory.json"), JSON.stringify(memoryContext, null, 2));

	logger.info("Phase 6 completed", { projectName, hasDocs: true });

	return {
		docMd,
		phase6Doc,
		readmeUpdated,
	};
}
