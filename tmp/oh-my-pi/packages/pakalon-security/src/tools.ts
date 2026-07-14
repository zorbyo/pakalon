export interface SecurityTool {
	name: string;
	kind: "sast" | "dast" | "code-review";
	command: string;
	dockerImage?: string;
}

export const FREE_TIER_TOOLS: SecurityTool[] = [
	{ name: "semgrep", kind: "sast", command: "semgrep", dockerImage: "returntocorp/semgrep" },
	{ name: "gitleaks", kind: "sast", command: "gitleaks", dockerImage: "zricethezav/gitleaks" },
	{ name: "bandit", kind: "sast", command: "bandit", dockerImage: "python:3.11" },
];

export const PRO_TIER_TOOLS: SecurityTool[] = [
	...FREE_TIER_TOOLS,
	{ name: "sonarqube", kind: "sast", command: "sonar-scanner", dockerImage: "sonarsource/sonar-scanner-cli" },
	{ name: "owasp-zap", kind: "dast", command: "zap-cli", dockerImage: "owasp/zap2docker-stable" },
	{ name: "nikto", kind: "dast", command: "nikto", dockerImage: "sectools/nikto" },
];

export function toolsForTier(tier: "free" | "pro"): SecurityTool[] {
	return tier === "pro" ? PRO_TIER_TOOLS : FREE_TIER_TOOLS;
}
