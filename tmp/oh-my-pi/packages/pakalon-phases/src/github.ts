import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";

export interface GitHubOptions {
	repoName: string;
	description?: string;
	visibility: "public" | "private";
	projectDir: string;
}

export interface GitHubResult {
	repoCreated: boolean;
	repoUrl: string;
	prCreated: boolean;
	prUrl: string;
	error?: string;
}

export class GitHubManager {
	async createRepo(options: GitHubOptions): Promise<GitHubResult> {
		const result: GitHubResult = {
			repoCreated: false,
			repoUrl: "",
			prCreated: false,
			prUrl: "",
		};

		try {
			const ghCheck = await $`gh --version`.quiet().nothrow();
			if (ghCheck.exitCode !== 0) {
				result.error = "GitHub CLI (gh) is not installed or not in PATH";
				logger.warn(result.error);
				return result;
			}
		} catch {
			result.error = "GitHub CLI (gh) is not available";
			logger.warn(result.error);
			return result;
		}

		try {
			const authCheck = await $`gh auth status`.quiet().nothrow();
			if (authCheck.exitCode !== 0) {
				result.error = "Not authenticated with GitHub CLI. Run: gh auth login";
				logger.warn(result.error);
				return result;
			}
		} catch {
			result.error = "GitHub CLI auth check failed";
			logger.warn(result.error);
			return result;
		}

		try {
			const createCmd =
				await $`gh repo create ${options.repoName} --${options.visibility === "public" ? "public" : "private"} --description ${options.description ?? ""} --source=${options.projectDir} --remote=origin --push`
					.quiet()
					.nothrow();

			if (createCmd.exitCode === 0) {
				result.repoCreated = true;
				result.repoUrl = `https://github.com/${options.repoName}`;
				logger.info("GitHub repository created", { url: result.repoUrl });

				const prBody = this.#generatePrBody(options.repoName);
				const prCmd =
					await $`gh pr create --title "Initial commit: Pakalon 6-phase generated project" --body ${prBody} --base main`
						.cwd(options.projectDir)
						.quiet()
						.nothrow();

				if (prCmd.exitCode === 0) {
					result.prCreated = true;
					result.prUrl = prCmd.text().match(/https:\/\/github\.com\/\S+/)?.[0] ?? "";
					logger.info("Pull request created", { url: result.prUrl });
				} else {
					logger.info("PR creation skipped (may already be on main branch or no changes)");
				}
			} else {
				const stderr = createCmd.text().trim() || "Unknown error";
				result.error = `Repo creation failed: ${stderr}`;
				logger.warn(result.error);
			}
		} catch (err) {
			result.error = `GitHub operation failed: ${err}`;
			logger.warn(result.error);
		}

		return result;
	}

	/** List PRs for the repository. */
	async listPullRequests(
		repo: string,
		state: "open" | "closed" | "all" = "open",
		limit: number = 10,
	): Promise<{ number: number; title: string; state: string; url: string; author: string; createdAt: string }[]> {
		const out: { number: number; title: string; state: string; url: string; author: string; createdAt: string }[] =
			[];
		try {
			const cmd =
				await $`gh pr list --repo ${repo} --state ${state} --limit ${limit} --json number,title,state,url,author,createdAt`
					.quiet()
					.nothrow();
			if (cmd.exitCode === 0) {
				const data = JSON.parse(cmd.text() || "[]");
				for (const pr of data) out.push(pr);
			}
		} catch (err) {
			logger.warn("GitHub: list PRs failed", { err });
		}
		return out;
	}

	/** List issues for the repository. */
	async listIssues(
		repo: string,
		state: "open" | "closed" | "all" = "open",
		limit: number = 10,
	): Promise<{ number: number; title: string; state: string; url: string; author: string; createdAt: string }[]> {
		const out: { number: number; title: string; state: string; url: string; author: string; createdAt: string }[] =
			[];
		try {
			const cmd =
				await $`gh issue list --repo ${repo} --state ${state} --limit ${limit} --json number,title,state,url,author,createdAt`
					.quiet()
					.nothrow();
			if (cmd.exitCode === 0) {
				const data = JSON.parse(cmd.text() || "[]");
				for (const issue of data) out.push(issue);
			}
		} catch (err) {
			logger.warn("GitHub: list issues failed", { err });
		}
		return out;
	}

	/** Create a pull request from current branch to base. */
	async createPullRequest(
		repo: string,
		options: {
			title: string;
			body?: string;
			base: string;
			head?: string;
			draft?: boolean;
		},
	): Promise<{ number: number; url: string } | null> {
		try {
			const head = options.head ?? (await $`git branch --show-current`.text()).trim();
			const args: string[] = [
				`gh pr create --repo ${repo}`,
				`--title ${options.title}`,
				`--base ${options.base}`,
				options.body ? `--body ${options.body}` : "",
				options.draft ? "--draft" : "",
			].filter(Boolean);
			const cmd = await $`${args.join(" ")}`.quiet().nothrow();
			if (cmd.exitCode === 0) {
				const match = cmd.text().match(/https:\/\/github\.com\/\S+/);
				if (match) return { number: 0, url: match[0] };
			}
		} catch (err) {
			logger.warn("GitHub: create PR failed", { err });
		}
		return null;
	}

	/** Create an issue on the repository. */
	async createIssue(
		repo: string,
		options: { title: string; body?: string; labels?: string[] },
	): Promise<{ number: number; url: string } | null> {
		try {
			const args = [
				`gh issue create --repo ${repo}`,
				`--title ${options.title}`,
				options.body ? `--body ${options.body}` : "",
				...(options.labels ?? []).map(l => `--label ${l}`),
			].filter(Boolean);
			const cmd = await $`${args.join(" ")}`.quiet().nothrow();
			if (cmd.exitCode === 0) {
				const match = cmd.text().match(/https:\/\/github\.com\/\S+/);
				if (match) return { number: 0, url: match[0] };
			}
		} catch (err) {
			logger.warn("GitHub: create issue failed", { err });
		}
		return null;
	}

	#generatePrBody(_projectName: string): string {
		return [
			"## 🤖 Generated by Pakalon 6-Phase Pipeline",
			"",
			"This pull request contains the complete project generated by the Pakalon autonomous build pipeline.",
			"",
			"### What's Included",
			"",
			"**Phase 1 - Planning:**",
			"- Product Requirements Document (PRD)",
			"- Technical specification and architecture",
			"- Risk assessment and competitive analysis",
			"- User stories with acceptance criteria",
			"",
			"**Phase 2 - Wireframes:**",
			"- SVG wireframes for all pages",
			"- JSON structured element data",
			"- Penpot-compatible format",
			"",
			"**Phase 3 - Development:**",
			"- Frontend implementation (React/Next.js)",
			"- Backend API (Node.js/Express)",
			"- Frontend-backend integration",
			"- Testing suite (unit, integration, e2e)",
			"",
			"**Phase 4 - Security:**",
			"- SAST scanning (Semgrep, Gitleaks, Bandit)",
			"- Code review and CI/CD review",
			"- Test cases (whitebox + blackbox XML)",
			"- Security best practices assessment",
			"",
			"**Phase 5 - Deployment:**",
			"- GitHub Actions CI/CD pipeline",
			"- Dockerfile and Docker Compose setup",
			"- Deployment guides (AWS/DO/Azure/GCP)",
			"",
			"**Phase 6 - Documentation:**",
			"- API documentation",
			"- User guide",
			"- Developer guide",
			"- Updated README",
			"",
			"### How to Review",
			"1. Check the architecture in docs/guides/developer-guide.md",
			"2. Review API endpoints in docs/api/README.md",
			"3. Run locally: `docker compose up -d --build`",
			"",
			"---",
			"_Built with [Pakalon](https://github.com/Tarun-1516/Pakalon)_",
		].join("\n");
	}
}
