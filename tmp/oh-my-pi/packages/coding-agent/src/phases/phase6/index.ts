/**
 * Phase 6: Documentation for Pakalon.
 *
 * Generates complete project documentation by analyzing the codebase
 * and artifacts from previous phases.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { invokePhaseLLM } from "../../pakalon/llm/invoker";
import { rememberArtifactsInDir } from "../../pakalon/mem0";
import docSystemPrompt from "../../prompts/phase-6/documentation.md" with { type: "text" };

export interface Phase6Input {
	projectDir: string;
}

export interface Phase6Output {
	docMd: string;
	phase6Doc: string;
	readmeUpdated: string;
}

const PHASE6_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-6");
const PHASE1_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");
const PHASE3_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-3");

function readFileSafe(p: string): string {
	try {
		return fs.readFileSync(p, "utf-8");
	} catch {
		return "";
	}
}

export async function runPhase6(cwd: string, _input?: Phase6Input): Promise<Phase6Output> {
	logger.info("Phase 6: Documentation started", { cwd });

	const dir = PHASE6_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });

	const plan = readFileSafe(path.join(PHASE1_DIR(cwd), "plan.md"));
	const design = readFileSafe(path.join(PHASE1_DIR(cwd), "design.md"));
	const apiRef = readFileSafe(path.join(PHASE1_DIR(cwd), "API_reference.md"));
	const dbSchema = readFileSafe(path.join(PHASE1_DIR(cwd), "Database_schema.md"));
	const userStories = readFileSafe(path.join(PHASE1_DIR(cwd), "user-stories.md"));
	const auditorReport = readFileSafe(path.join(PHASE3_DIR(cwd), "auditor.md"));

	const fileTree = scanProjectStructure(cwd);

	let docMd = "";
	let phase6Doc = "";

	try {
		const prompt = JSON.stringify({
			plan,
			design,
			apiReference: apiRef.slice(0, 2000),
			databaseSchema: dbSchema.slice(0, 2000),
			userStories: userStories.slice(0, 1000),
			fileTree,
			auditorSummary: auditorReport.slice(0, 500),
		});

		const docResult = await invokePhaseLLM(docSystemPrompt, prompt, {
			cwd,
			phase: "phase-6",
			subagent: "documentation",
			maxOutputTokens: 16384,
		});

		docMd = docResult.text;
	} catch (err) {
		logger.warn("phase-6: LLM generation failed, using template", { err });
		docMd = generateDocTemplate(cwd, plan);
	}

	phase6Doc =
		`# Phase 6: Documentation\n\n` +
		`## Status: Complete\n\n` +
		`## Deliverables\n\n` +
		`- doc.md - Complete user documentation\n` +
		`- README.md - Updated project readme\n\n` +
		`## Documentation Includes\n\n` +
		`- Feature overview\n` +
		`- Installation instructions\n` +
		`- Usage guide\n` +
		`- API reference\n` +
		`- Database schema\n` +
		`- Troubleshooting\n`;

	fs.writeFileSync(path.join(dir, "phase-6.md"), phase6Doc);
	fs.writeFileSync(path.join(cwd, "doc.md"), docMd);

	const readmePath = path.join(cwd, "README.md");
	let readmeUpdated = "";
	if (fs.existsSync(readmePath)) {
		const existingReadme = readFileSafe(readmePath);
		const newReadme = updateReadme(existingReadme, plan);
		fs.writeFileSync(readmePath, newReadme);
		readmeUpdated = newReadme;
	} else {
		readmeUpdated = generateReadme(cwd, plan);
		fs.writeFileSync(readmePath, readmeUpdated);
	}

	logger.info("Phase 6 completed", { docLength: docMd.length, readmeUpdated: !!readmeUpdated });
	void rememberArtifactsInDir({
		userId: process.env.PAKALON_USER_ID ?? process.env.USER ?? "anonymous",
		phase: "phase-6",
		dir: PHASE6_DIR(cwd),
		projectRoot: cwd,
		extensions: [".md"],
	}).catch(err => logger.warn("phase-6: mem0 sync failed", { err }));

	return { docMd, phase6Doc, readmeUpdated };
}

function scanProjectStructure(cwd: string): string {
	const lines: string[] = [`${path.basename(cwd)}/`];
	const walk = (dir: string, indent: number) => {
		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".git") {
					continue;
				}
				const prefix = "  ".repeat(indent) + (entry.isDirectory() ? "[DIR] " : "[FILE] ");
				lines.push(prefix + entry.name);
				if (entry.isDirectory()) {
					walk(path.join(dir, entry.name), indent + 1);
				}
			}
		} catch {
			/* skip */
		}
	};
	walk(cwd, 1);
	return lines.join("\n");
}

function generateDocTemplate(cwd: string, plan: string): string {
	const projectName = path.basename(cwd);
	return `# ${projectName} Documentation

## Overview

${plan.slice(0, 500) || "This project was built with Pakalon AI."}

## Features

- Feature 1
- Feature 2
- Feature 3

## Installation

\`\`\`bash
# Clone the repository
git clone <repository-url>
cd ${projectName}

# Install dependencies
npm install

# Start the application
npm start
\`\`\`

## Usage

[Add usage instructions here]

## API Reference

See API_reference.md in .pakalon-agents/ai-agents/phase-1/

## Database Schema

See Database_schema.md in .pakalon-agents/ai-agents/phase-1/

## Project Structure

\`\`\`
${scanProjectStructure(cwd)}
\`\`\`

## Contributing

[Add contributing guidelines here]

## License

[Add license information here]
`;
}

function generateReadme(cwd: string, plan: string): string {
	const projectName = path.basename(cwd);
	return `# ${projectName}

> ${plan.slice(0, 200) || "Built with Pakalon AI"}

## Features

- Built with modern tech stack
- Full-stack application
- Production-ready

## Quick Start

\`\`\`bash
npm install
npm start
\`\`\`

## Documentation

See [doc.md](./doc.md) for complete documentation.

## What's Built

This project was generated by Pakalon AI through a 6-phase SDLC pipeline:
1. Planning & Requirements
2. Wireframes
3. Development
4. Testing & QA
5. Deployment
6. Documentation

## License

MIT
`;
}

function updateReadme(existing: string, _plan: string): string {
	const builtSection = `

## What's Built

This project was generated by Pakalon AI through a 6-phase SDLC pipeline:
1. Planning & Requirements
2. Wireframes
3. Development
4. Testing & QA
5. Deployment
6. Documentation

See [doc.md](./doc.md) for complete documentation.
`;

	if (existing.includes("What's Built") || existing.includes("Pakalon AI")) {
		return existing;
	}

	return existing.trimEnd() + builtSection;
}
