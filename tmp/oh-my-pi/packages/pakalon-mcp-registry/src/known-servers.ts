import type { McpServerSpec } from "./types";

export const KNOWN_SERVERS: McpServerSpec[] = [
	{
		id: "firecrawl",
		name: "Firecrawl",
		description: "Web scraping and crawling MCP server",
		command: "npx",
		args: ["-y", "@anthropic/firecrawl-mcp"],
		scope: "global",
		status: "not-installed",
		homepage: "https://github.com/anthropics/anthropic-cookbook/tree/main/mcp/firecrawl",
	},
	{
		id: "puppeteer",
		name: "Puppeteer",
		description: "Browser automation MCP server",
		command: "npx",
		args: ["-y", "@anthropic/puppeteer-mcp"],
		scope: "global",
		status: "not-installed",
		homepage: "https://github.com/anthropics/anthropic-cookbook/tree/main/mcp/puppeteer",
	},
	{
		id: "context7",
		name: "Context7",
		description: "Library documentation and code examples MCP server",
		command: "npx",
		args: ["-y", "@context7/context7-mcp"],
		scope: "global",
		status: "not-installed",
		homepage: "https://context7.com",
	},
	{
		id: "chrome-devtools",
		name: "Chrome DevTools",
		description: "Chrome DevTools Protocol MCP server",
		command: "npx",
		args: ["-y", "@anthropic/chrome-devtools-mcp"],
		scope: "global",
		status: "not-installed",
	},
	{
		id: "mem0",
		name: "Mem0",
		description: "Memory persistence MCP server",
		command: "npx",
		args: ["-y", "@mem0/mcp"],
		scope: "global",
		status: "not-installed",
		homepage: "https://mem0.ai",
	},
	{
		id: "sequential-thinking",
		name: "Sequential Thinking",
		description: "Sequential reasoning MCP server",
		command: "npx",
		args: ["-y", "@anthropic/sequential-thinking-mcp"],
		scope: "global",
		status: "not-installed",
	},
	{
		id: "github",
		name: "GitHub MCP",
		description: "GitHub API MCP server",
		command: "npx",
		args: ["-y", "@anthropic/github-mcp"],
		scope: "global",
		status: "not-installed",
		homepage: "https://github.com/anthropics/anthropic-cookbook/tree/main/mcp/github",
	},
	{
		id: "slack",
		name: "Slack MCP",
		description: "Slack API MCP server",
		command: "npx",
		args: ["-y", "@anthropic/slack-mcp"],
		scope: "global",
		status: "not-installed",
	},
];

export function getKnownServer(id: string): McpServerSpec | undefined {
	return KNOWN_SERVERS.find(s => s.id === id);
}

export function getKnownServersByScope(scope: "project" | "global"): McpServerSpec[] {
	return KNOWN_SERVERS.filter(s => s.scope === scope);
}
