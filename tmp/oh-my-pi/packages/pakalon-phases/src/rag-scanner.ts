import * as fs from "node:fs";
import * as path from "node:path";

export interface RagComponent {
	name: string;
	type: "component" | "hook" | "utility" | "page" | "layout" | "api" | "middleware" | "schema" | "config";
	source: "registry" | "project" | "template";
	files: string[];
	dependencies: string[];
	description: string;
	tags: string[];
	usage: string;
}

export interface RagScanOptions {
	projectDir: string;
	includePatterns?: string[];
	excludePatterns?: string[];
	maxResults?: number;
}

export interface RagScanResult {
	components: RagComponent[];
	matchedPatterns: string[];
	suggestions: string[];
	scanDuration: number;
}

const KNOWN_REGISTRY_COMPONENTS: RagComponent[] = [
	{
		name: "AuthProvider",
		type: "component",
		source: "registry",
		files: ["src/providers/AuthProvider.tsx", "src/lib/auth-client.ts"],
		dependencies: ["react", "next/navigation"],
		description: "Authentication context provider with JWT session management",
		tags: ["auth", "jwt", "session", "provider"],
		usage: "Wrap root layout with AuthProvider",
	},
	{
		name: "ThemeProvider",
		type: "component",
		source: "registry",
		files: ["src/providers/ThemeProvider.tsx"],
		dependencies: ["next-themes"],
		description: "Dark/light theme provider with system preference detection",
		tags: ["theme", "dark-mode", "provider"],
		usage: "Wrap root layout with ThemeProvider",
	},
	{
		name: "QueryProvider",
		type: "component",
		source: "registry",
		files: ["src/providers/QueryProvider.tsx"],
		dependencies: ["@tanstack/react-query"],
		description: "TanStack Query provider with default configuration",
		tags: ["query", "data-fetching", "provider"],
		usage: "Wrap root layout with QueryProvider",
	},
	{
		name: "DataTable",
		type: "component",
		source: "registry",
		files: ["src/components/common/DataTable.tsx"],
		dependencies: ["react", "@tanstack/react-table"],
		description: "Generic data table with sorting, filtering, and pagination",
		tags: ["table", "data", "grid"],
		usage: "<DataTable columns={cols} data={rows} />",
	},
	{
		name: "useAuth",
		type: "hook",
		source: "registry",
		files: ["src/hooks/useAuth.ts"],
		dependencies: ["react", "next/navigation"],
		description: "Authentication hook with login, register, and logout methods",
		tags: ["auth", "hook", "login"],
		usage: "const { user, login, logout } = useAuth()",
	},
	{
		name: "apiClient",
		type: "utility",
		source: "registry",
		files: ["src/lib/api-client.ts"],
		dependencies: [],
		description: "HTTP client with JWT token injection and error handling",
		tags: ["api", "http", "fetch"],
		usage: "apiClient.get('/api/data')",
	},
	{
		name: "authMiddleware",
		type: "middleware",
		source: "registry",
		files: ["src/middleware/auth.ts"],
		dependencies: [],
		description: "Express middleware for JWT verification and role-based access",
		tags: ["auth", "middleware", "jwt"],
		usage: "app.use('/api/protected', authMiddleware)",
	},
	{
		name: "validationMiddleware",
		type: "middleware",
		source: "registry",
		files: ["src/middleware/validate.ts"],
		dependencies: ["zod"],
		description: "Request validation middleware using Zod schemas",
		tags: ["validation", "zod", "middleware"],
		usage: "app.post('/api/data', validate(schema), handler)",
	},
	{
		name: "errorHandler",
		type: "middleware",
		source: "registry",
		files: ["src/middleware/error.ts"],
		dependencies: [],
		description: "Global error handler with structured JSON error responses",
		tags: ["error", "middleware", "handler"],
		usage: "app.use(errorHandler)",
	},
	{
		name: "DatabaseSchema",
		type: "schema",
		source: "registry",
		files: ["src/db/schema.ts", "src/db/migrate.ts"],
		dependencies: ["drizzle-orm", "postgres"],
		description: "Database schema with users, sessions, profiles, and items tables",
		tags: ["database", "schema", "drizzle"],
		usage: "Imported by migration and query files",
	},
	{
		name: "DashboardLayout",
		type: "layout",
		source: "registry",
		files: ["src/app/dashboard/layout.tsx"],
		dependencies: ["react"],
		description: "Dashboard layout with sidebar navigation and header",
		tags: ["layout", "dashboard", "sidebar"],
		usage: "Applied to /dashboard/* routes",
	},
	{
		name: "LoginPage",
		type: "page",
		source: "registry",
		files: ["src/app/(auth)/login/page.tsx"],
		dependencies: ["react", "next/navigation"],
		description: "Login page with form validation and error display",
		tags: ["auth", "login", "page"],
		usage: "Route: /login",
	},
	{
		name: "RegisterPage",
		type: "page",
		source: "registry",
		files: ["src/app/(auth)/register/page.tsx"],
		dependencies: ["react", "next/navigation"],
		description: "Registration page with form validation",
		tags: ["auth", "register", "page"],
		usage: "Route: /register",
	},
	{
		name: "StatCard",
		type: "component",
		source: "registry",
		files: ["src/components/dashboard/StatCard.tsx"],
		dependencies: ["react"],
		description: "Dashboard statistics card with icon, value, and trend indicator",
		tags: ["dashboard", "statistics", "card"],
		usage: "<StatCard title='Users' value='1,234' trend='up' />",
	},
	{
		name: "ChartWidget",
		type: "component",
		source: "registry",
		files: ["src/components/dashboard/ChartWidget.tsx"],
		dependencies: ["react", "recharts"],
		description: "Reusable chart widget for dashboard analytics",
		tags: ["chart", "analytics", "dashboard"],
		usage: "<ChartWidget data={chartData} type='line' />",
	},
];

export class RagScanner {
	#registryComponents: Map<string, RagComponent>;

	constructor(customComponents: RagComponent[] = []) {
		this.#registryComponents = new Map();
		for (const comp of [...KNOWN_REGISTRY_COMPONENTS, ...customComponents]) {
			this.#registryComponents.set(comp.name, comp);
		}
	}

	registerComponent(component: RagComponent): void {
		this.#registryComponents.set(component.name, component);
	}

	async scanProject(options: RagScanOptions): Promise<RagScanResult> {
		const startTime = performance.now();
		const components: RagComponent[] = [];
		const matchedPatterns: string[] = [];
		const suggestions: string[] = [];

		const include = options.includePatterns ?? ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];
		const exclude = options.excludePatterns ?? ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**"];

		for (const [name, component] of this.#registryComponents) {
			const allFilesExist = component.files.some(f => {
				const fullPath = path.join(options.projectDir, f);
				return fs.existsSync(fullPath);
			});

			if (allFilesExist) {
				components.push(component);
				matchedPatterns.push(name);
			} else {
				suggestions.push(`Missing: ${name} (${component.description}) — expected at ${component.files.join(", ")}`);
			}
		}

		const scannedFiles = await this.#scanExistingFiles(options.projectDir, include, exclude);
		const scanDuration = performance.now() - startTime;

		return {
			components,
			matchedPatterns,
			suggestions: suggestions.concat(scannedFiles.suggestions),
			scanDuration,
		};
	}

	async fetchRelevantComponents(description: string, maxResults = 5): Promise<RagComponent[]> {
		const query = description.toLowerCase();
		const scored = Array.from(this.#registryComponents.values()).map(comp => {
			let score = 0;
			const name = comp.name.toLowerCase();
			const tags = comp.tags.map(t => t.toLowerCase());
			const desc = comp.description.toLowerCase();

			if (name.includes(query)) score += 10;
			if (desc.includes(query)) score += 5;
			for (const tag of tags) {
				if (query.includes(tag)) score += 3;
			}
			if (comp.type.toLowerCase().includes(query)) score += 2;

			return { component: comp, score };
		});

		return scored
			.sort((a, b) => b.score - a.score)
			.slice(0, maxResults)
			.filter(s => s.score > 0)
			.map(s => s.component);
	}

	generateUsageGuide(components: RagComponent[]): string {
		if (components.length === 0) return "No reusable components found in registry.";

		const byType = new Map<string, RagComponent[]>();
		for (const comp of components) {
			const list = byType.get(comp.type) ?? [];
			list.push(comp);
			byType.set(comp.type, list);
		}

		const lines: string[] = ["## Reusable Components Found in Registry\n"];
		for (const [type, comps] of byType) {
			lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
			for (const comp of comps) {
				lines.push(`- **${comp.name}**: ${comp.description}`);
				lines.push(`  - Files: ${comp.files.join(", ")}`);
				lines.push(`  - Usage: \`${comp.usage}\``);
				lines.push(`  - Tags: ${comp.tags.join(", ")}`);
			}
			lines.push("");
		}

		lines.push("### Missing Components (Recommended)");
		return lines.join("\n");
	}

	async #scanExistingFiles(
		projectDir: string,
		include: string[],
		_exclude: string[],
	): Promise<{ suggestions: string[] }> {
		const suggestions: string[] = [];
		const existingComponents: string[] = [];

		const globPatterns = include.flatMap(p => {
			if (p.startsWith("**/")) return [p];
			return [p];
		});

		for (const pattern of globPatterns) {
			const parts = pattern.replace(/\*\*/g, "").split("/").filter(Boolean);
			if (parts.length === 0) continue;

			const dirsToCheck = [projectDir];
			for (const part of parts) {
				if (part.includes("*")) break;
				const nextDirs: string[] = [];
				for (const dir of dirsToCheck) {
					try {
						const entries = fs.readdirSync(dir, { withFileTypes: true });
						for (const entry of entries) {
							if (entry.isDirectory()) {
								nextDirs.push(path.join(dir, entry.name));
							} else if (!entry.isDirectory() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
								existingComponents.push(path.relative(projectDir, path.join(dir, entry.name)));
							}
						}
					} catch {
						/* skip unreadable */
					}
				}
				dirsToCheck.length = 0;
				dirsToCheck.push(...nextDirs);
			}
		}

		const projectComponentNames = new Set(existingComponents.map(f => path.basename(f).replace(/\.(ts|tsx)$/, "")));

		for (const [name, component] of this.#registryComponents) {
			const normalizedName = name.toLowerCase();
			const isSimilar = Array.from(projectComponentNames).some(pn => {
				const normalizedPn = pn.toLowerCase();
				return normalizedPn.includes(normalizedName) || normalizedName.includes(normalizedPn);
			});

			if (!isSimilar) {
				const expectedFiles = component.files.filter(f => {
					const fullPath = path.join(projectDir, f);
					return !fs.existsSync(fullPath);
				});
				if (expectedFiles.length > 0 && expectedFiles.length < component.files.length) {
					suggestions.push(`Partial: ${name} — missing files: ${expectedFiles.join(", ")}`);
				}
			}
		}

		return { suggestions };
	}
}
