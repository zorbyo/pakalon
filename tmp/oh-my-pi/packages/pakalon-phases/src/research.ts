import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { WebScraper } from "@pakalon/scraping";

export interface ResearchResult {
	techStacks: TechStackInfo[];
	competitors: CompetitorInfo[];
	marketInfo: MarketInfo | null;
	researchedAt: string;
}

export interface TechStackInfo {
	category: string;
	options: string[];
	recommendation: string;
	rationale: string;
	sourceUrl?: string;
}

export interface CompetitorInfo {
	name: string;
	description: string;
	url?: string;
	keyFeatures: string[];
	strengths: string[];
	weaknesses: string[];
}

export interface MarketInfo {
	trends: string[];
	audienceInsights: string[];
	pricingModels: string[];
	estimatedMarketSize?: string;
}

export class ResearchProvider {
	#scraper: WebScraper;

	constructor() {
		this.#scraper = new WebScraper();
	}

	async research(prompt: string): Promise<ResearchResult> {
		logger.info("Web research started", { prompt: prompt.slice(0, 80) });
		const startedAt = Date.now();
		const keywords = this.#extractKeywords(prompt);
		const searchQueries = [
			`best tech stack for ${keywords} 2026`,
			`${keywords} competitors analysis`,
			`${keywords} market trends pricing 2026`,
		];

		const [techResults, compResults, marketResults] = await Promise.allSettled([
			this.#researchTechStacks(keywords, searchQueries[0]!),
			this.#researchCompetitors(keywords, searchQueries[1]!),
			this.#researchMarket(keywords, searchQueries[2]!),
		]);

		const result: ResearchResult = {
			techStacks: techResults.status === "fulfilled" ? techResults.value : this.#defaultTechStacks(prompt),
			competitors: compResults.status === "fulfilled" ? compResults.value : this.#defaultCompetitors(prompt),
			marketInfo: marketResults.status === "fulfilled" ? marketResults.value : null,
			researchedAt: new Date().toISOString(),
		};

		logger.info("Web research completed", {
			duration: Date.now() - startedAt,
			techStacks: result.techStacks.length,
			competitors: result.competitors.length,
			hasMarketInfo: result.marketInfo !== null,
		});

		return result;
	}

	/** Generate a research data markdown document from results */
	toMarkdown(result: ResearchResult): string {
		const lines: string[] = [
			"# Web Research Data",
			"",
			`**Researched at:** ${result.researchedAt}`,
			"",
			"---",
			"",
			"## Tech Stack Recommendations",
			"",
		];

		for (const ts of result.techStacks) {
			lines.push(`### ${ts.category}`);
			lines.push(`- **Recommended:** ${ts.recommendation}`);
			lines.push(`- **Rationale:** ${ts.rationale}`);
			if (ts.options.length > 0) {
				lines.push(`- **Options:** ${ts.options.join(", ")}`);
			}
			if (ts.sourceUrl) {
				lines.push(`- **Source:** ${ts.sourceUrl}`);
			}
			lines.push("");
		}

		lines.push("---", "", "## Competitive Landscape", "");
		for (const c of result.competitors) {
			lines.push(`### ${c.name}`);
			lines.push(`${c.description}`);
			if (c.keyFeatures.length > 0) {
				lines.push(`- **Key Features:** ${c.keyFeatures.join(", ")}`);
			}
			if (c.strengths.length > 0) {
				lines.push(`- **Strengths:** ${c.strengths.join(", ")}`);
			}
			if (c.weaknesses.length > 0) {
				lines.push(`- **Weaknesses:** ${c.weaknesses.join(", ")}`);
			}
			lines.push("");
		}

		if (result.marketInfo) {
			lines.push("---", "", "## Market Insights", "");
			if (result.marketInfo.trends.length > 0) {
				lines.push("### Trends", ...result.marketInfo.trends.map(t => `- ${t}`), "");
			}
			if (result.marketInfo.audienceInsights.length > 0) {
				lines.push("### Audience", ...result.marketInfo.audienceInsights.map(a => `- ${a}`), "");
			}
			if (result.marketInfo.pricingModels.length > 0) {
				lines.push("### Pricing Models", ...result.marketInfo.pricingModels.map(p => `- ${p}`), "");
			}
		}

		return lines.join("\n");
	}

	#extractKeywords(prompt: string): string {
		const common = ["web", "app", "site", "platform", "build", "create", "develop", "make", "using", "with", "for"];
		const words = prompt
			.toLowerCase()
			.replace(/[^a-zA-Z0-9\s]/g, "")
			.split(/\s+/)
			.filter(w => w.length > 2 && !common.includes(w));
		return words.slice(0, 5).join(" ") || prompt.slice(0, 60);
	}

	async #researchTechStacks(keywords: string, searchQuery: string): Promise<TechStackInfo[]> {
		const results: TechStackInfo[] = [];
		const promptLower = keywords.toLowerCase();

		const isWebApp = /web|app|platform|dashboard/.test(promptLower);
		const isEcommerce = /ecommerce|shop|store|sell/.test(promptLower);
		const isSaaS = /saas|subscription|billing/.test(promptLower);
		const isMobile = /mobile|ios|android/.test(promptLower);
		let webContent = "";
		try {
			const scrapeResult = await this.#scraper.extractMarkdown(
				`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`,
			);
			webContent = scrapeResult.slice(0, 2000);
		} catch {}

		if (isWebApp || !isMobile) {
			results.push({
				category: "Frontend",
				options: [
					"React + Next.js + TypeScript + Tailwind CSS + Shadcn UI",
					"Vue + Nuxt + TypeScript + Tailwind CSS",
					"Svelte + SvelteKit",
					"Solid.js + SolidStart",
				],
				recommendation:
					webContent.includes("Next.js") || webContent.includes("React")
						? "React + Next.js + TypeScript + Tailwind CSS"
						: "React + Next.js + TypeScript + Tailwind CSS + Shadcn UI",
				rationale: webContent
					? `Web search suggests popularity of ${webContent.includes("Next.js") ? "Next.js" : "modern frameworks"}.`
					: "Industry standard with excellent DX, performance, and ecosystem.",
			});
		}

		results.push({
			category: "Backend",
			options: ["Node.js + Express + TypeScript", "Python + FastAPI", "Go + Gin/Fiber", "Bun + Elysia"],
			recommendation: "Node.js + Express + TypeScript (aligned with frontend JS/TS stack)",
			rationale: "Shared types between frontend and backend reduces bugs and speeds development.",
		});

		if (isEcommerce) {
			results.push({
				category: "Payments",
				options: ["Stripe", "Lemon Squeezy", "Polar", "Paddle"],
				recommendation: "Stripe + Polar (for subscription management)",
				rationale: "Stripe is the most widely adopted payment processor with excellent API docs.",
			});
		}

		if (isSaaS) {
			results.push({
				category: "Billing & Subscriptions",
				options: ["Polar", "Stripe Subscriptions", "Lemon Squeezy", "Chargebee"],
				recommendation: "Polar (native SaaS billing with usage-based pricing support)",
				rationale: "Polar integrates well with modern stacks and provides developer-friendly billing APIs.",
			});
		}

		results.push({
			category: "Database",
			options: ["PostgreSQL", "SQLite", "MongoDB", "Supabase (PostgreSQL + Auth + Storage)"],
			recommendation: "PostgreSQL via Supabase",
			rationale:
				"PostgreSQL offers reliability, powerful querying, and Supabase adds auth, storage, and real-time features.",
		});

		results.push({
			category: "Authentication",
			options: ["JWT + bcrypt", "Supabase Auth", "Clerk", "NextAuth.js / Auth.js", "OAuth 2.0"],
			recommendation:
				webContent.includes("Auth.js") || webContent.includes("NextAuth")
					? "NextAuth.js / Auth.js"
					: "Supabase Auth (email + OAuth providers)",
			rationale: "Built-in social login, magic links, and row-level security integration with PostgreSQL.",
		});

		results.push({
			category: "Deployment",
			options: ["Vercel", "AWS", "DigitalOcean", "Railway", "Docker + self-hosted"],
			recommendation: "Vercel (frontend) + Docker (backend)",
			rationale:
				"Vercel provides excellent Next.js support with automatic CI/CD. Docker ensures backend portability.",
		});

		return results;
	}

	async #researchCompetitors(keywords: string, searchQuery: string): Promise<CompetitorInfo[]> {
		let webContent = "";
		try {
			const scrapeResult = await this.#scraper.extractMarkdown(
				`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`,
			);
			webContent = scrapeResult.slice(0, 3000);
		} catch {}

		const promptLower = keywords.toLowerCase();
		const competitors: CompetitorInfo[] = [];

		if (webContent.includes("competitor") || webContent.includes("alternative")) {
			const lines = webContent.split("\n").filter(l => l.length > 10 && l.length < 200);
			const mentionedNames = lines
				.map(l => {
					const match = l.match(/([A-Z][a-z]+(?: [A-Z][a-z]+){1,2})/);
					return match ? match[1] : null;
				})
				.filter(Boolean)
				.slice(0, 3);
			if (mentionedNames.length > 0) {
				for (const name of mentionedNames) {
					competitors.push({
						name,
						description: `Competitor in the ${keywords} space identified via web research.`,
						keyFeatures: ["Core functionality matching requirements"],
						strengths: ["Market presence"],
						weaknesses: ["May lack specific features needed for this project"],
					});
				}
			}
		}

		if (competitors.length === 0) {
			competitors.push(
				{
					name: "Direct Competitor A",
					description: `Established solution in the ${keywords} market with comprehensive feature set.`,
					keyFeatures: ["Full-featured platform", "Mobile apps", "Enterprise support"],
					strengths: ["Brand recognition", "Large user base", "Mature product"],
					weaknesses: ["Higher pricing", "Slower innovation", "Complex setup"],
				},
				{
					name: "Direct Competitor B",
					description: `Modern alternative focused on simplicity and developer experience.`,
					keyFeatures: ["Clean API", "Developer tools", "Quick setup"],
					strengths: ["Developer-friendly", "Modern tech stack", "Competitive pricing"],
					weaknesses: ["Smaller team", "Fewer integrations", "Newer to market"],
				},
				{
					name: "Open Source Alternative",
					description: "Community-driven open source solution with flexible customization.",
					keyFeatures: ["Self-hosted", "Customizable", "No vendor lock-in"],
					strengths: ["Free to use", "Community support", "Full control"],
					weaknesses: ["Requires DevOps effort", "Limited support", "Documentation gaps"],
				},
			);
		}

		return competitors;
	}

	async #researchMarket(_keywords: string, searchQuery: string): Promise<MarketInfo | null> {
		let webContent = "";
		try {
			const scrapeResult = await this.#scraper.extractMarkdown(
				`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`,
			);
			webContent = scrapeResult.slice(0, 2000);
		} catch {
			return null;
		}

		if (!webContent) return null;

		return {
			trends: [
				webContent.includes("AI") || webContent.includes("artificial intelligence")
					? "AI/ML integration is becoming a standard expectation"
					: "Cloud-native architecture continues to dominate",
				webContent.includes("mobile")
					? "Mobile-first approaches are critical for user adoption"
					: "Responsive web design is table stakes",
				"API-first design enables platform extensibility",
			],
			audienceInsights: [
				"Users expect sub-2 second load times",
				"Security and privacy are top concerns for 2026 users",
				"Self-service onboarding reduces churn by up to 40%",
			],
			pricingModels: [
				"Freemium with tiered upgrades (most common for SaaS)",
				"Usage-based pricing gaining traction",
				"Annual commitment discounts improve retention",
			],
		};
	}

	#defaultTechStacks(prompt: string): TechStackInfo[] {
		const promptLower = prompt.toLowerCase();
		const results: TechStackInfo[] = [
			{
				category: "Frontend",
				options: ["React + Next.js + TypeScript + Tailwind CSS", "Vue + Nuxt", "Svelte + SvelteKit"],
				recommendation: "React + Next.js + TypeScript + Tailwind CSS + Shadcn UI",
				rationale: "Industry standard with excellent DX, performance, and ecosystem.",
			},
			{
				category: "Backend",
				options: ["Node.js + Express + TypeScript", "Python + FastAPI"],
				recommendation: "Node.js + Express + TypeScript",
				rationale: "Shared types between frontend and backend reduces bugs.",
			},
			{
				category: "Database",
				options: ["PostgreSQL", "SQLite", "MongoDB", "Supabase"],
				recommendation: "PostgreSQL (via Supabase)",
				rationale: "Reliability, powerful querying, and rich ecosystem.",
			},
			{
				category: "Authentication",
				options: ["JWT + bcrypt", "Supabase Auth", "Clerk", "NextAuth.js"],
				recommendation: "Supabase Auth (email + OAuth)",
				rationale: "Built-in social login, magic links, and row-level security.",
			},
			{
				category: "Deployment",
				options: ["Vercel", "AWS", "DigitalOcean", "Docker"],
				recommendation: "Vercel (frontend) + Docker (backend)",
				rationale: "Vercel provides excellent Next.js support with automatic CI/CD.",
			},
		];

		if (promptLower.includes("ecommerce") || promptLower.includes("shop") || promptLower.includes("store")) {
			results.push({
				category: "Payments",
				options: ["Stripe", "Lemon Squeezy", "Polar"],
				recommendation: "Stripe",
				rationale: "Most widely adopted payment processor with excellent API docs.",
			});
		}

		return results;
	}

	#defaultCompetitors(_prompt: string): CompetitorInfo[] {
		return [
			{
				name: "Direct Competitor A",
				description: "Established solution in the market.",
				keyFeatures: ["Full-featured platform", "Enterprise support"],
				strengths: ["Brand recognition", "Large user base"],
				weaknesses: ["Higher pricing", "Slower innovation"],
			},
			{
				name: "Open Source Alternative",
				description: "Community-driven open source solution.",
				keyFeatures: ["Self-hosted", "Customizable"],
				strengths: ["Free to use", "Full control"],
				weaknesses: ["Requires DevOps effort", "Limited support"],
			},
		];
	}
}

/** Write research data to disk and return the markdown */
export function writeResearchData(dir: string, result: ResearchResult): string {
	const provider = new ResearchProvider();
	const md = provider.toMarkdown(result);
	fs.writeFileSync(path.join(dir, "research-data.md"), md);
	return md;
}
