/**
 * GitHub integration for Pakalon.
 * Handles repo creation, PR management, issue tracking, and CI/CD triggers.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface GitHubConfig {
	token?: string;
	remoteName?: string;
	defaultBranch?: string;
}

export interface CreateRepoOptions {
	name: string;
	description?: string;
	visibility: "public" | "private";
	org?: string;
	autoInit?: boolean;
	gitignoreTemplate?: string;
}

export interface RepoResult {
	url: string;
	created: boolean;
	cloneUrl: string;
	sshUrl: string;
}

export interface PROptions {
	title: string;
	body: string;
	head: string;
	base: string;
	draft?: boolean;
}

export interface PRResult {
	number: number;
	url: string;
	merged: boolean;
}

export interface IssueOptions {
	title: string;
	body: string;
	labels?: string[];
	assignees?: string[];
}

export interface IssueResult {
	number: number;
	url: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const GITHUB_FILE = path.join(process.env.HOME || process.env.USERPROFILE || "", ".pakalon", "github.json");

function ensureDir(): void {
	const dir = path.dirname(GITHUB_FILE);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * Get GitHub configuration.
 */
export function getGitHubConfig(): GitHubConfig | null {
	try {
		if (!fs.existsSync(GITHUB_FILE)) return null;
		return JSON.parse(fs.readFileSync(GITHUB_FILE, "utf-8")) as GitHubConfig;
	} catch {
		return null;
	}
}

/**
 * Save GitHub configuration.
 */
export function saveGitHubConfig(config: GitHubConfig): void {
	ensureDir();
	fs.writeFileSync(GITHUB_FILE, JSON.stringify(config, null, 2));
	logger.info("GitHub config saved");
}

/**
 * Clear GitHub configuration.
 */
export function clearGitHubConfig(): void {
	try {
		if (fs.existsSync(GITHUB_FILE)) fs.unlinkSync(GITHUB_FILE);
		logger.info("GitHub config cleared");
	} catch {
		/* ignore */
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check whether the `gh` CLI is authenticated.
 */
export async function isGhAuthenticated(): Promise<boolean> {
	try {
		const r = await $`gh auth status`.quiet().nothrow();
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Ensure `gh` CLI is authenticated. If a token is stored in config,
 * attempt to use it. Otherwise prompt the user.
 */
export async function ensureGhAuth(token?: string): Promise<boolean> {
	if (await isGhAuthenticated()) return true;
	if (token) {
		try {
			await $`echo ${token} | gh auth login --with-token`.quiet().nothrow();
			return await isGhAuthenticated();
		} catch {
			return false;
		}
	}
	return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Repo operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a GitHub repository via `gh repo create`.
 * Returns the repo URL and creation status.
 */
export async function createRepo(options: CreateRepoOptions): Promise<RepoResult> {
	logger.info("github: creating repo", { name: options.name, visibility: options.visibility });

	const visibleFlag = options.visibility === "private" ? "--private" : "--public";
	const descriptionFlag = options.description ? `--description "${options.description}"` : "";
	const orgPrefix = options.org ? `${options.org}/` : "";

	try {
		const result = await $`
			gh repo create ${orgPrefix}${options.name} ${visibleFlag} ${descriptionFlag} --source=. --push --remote=origin
		`
			.quiet()
			.nothrow();

		if (result.exitCode !== 0) {
			const stderr = result.stderr?.toString() ?? "";
			logger.warn("github: repo creation returned non-zero", { exitCode: result.exitCode, stderr });
			return { url: "", created: false, cloneUrl: "", sshUrl: "" };
		}

		const url = `https://github.com/${options.org ? `${options.org}/` : ""}${options.name}`;
		logger.info("github: repo created", { url });
		return {
			url,
			created: true,
			cloneUrl: `${url}.git`,
			sshUrl: `git@github.com:${options.org ? `${options.org}/` : ""}${options.name}.git`,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error("github: create repo failed", { error: msg });
		return { url: "", created: false, cloneUrl: "", sshUrl: "" };
	}
}

/**
 * Create a GitHub repository for the current project directory.
 * Uses the git remote if already configured.
 */
export async function createGitHubRepo(projectDir: string, repoName: string): Promise<RepoResult> {
	logger.info("github: setting up repo for project", { projectDir, repoName });

	// Check if git is already initialised
	try {
		const gitCheck = await $`git rev-parse --git-dir`.cwd(projectDir).quiet().nothrow();
		if (gitCheck.exitCode !== 0) {
			await $`git init`.cwd(projectDir).quiet().nothrow();
			await $`git add -A`.cwd(projectDir).quiet().nothrow();
			await $`git commit -m "Initial commit from Pakalon"`
				.cwd(projectDir)
				.quiet()
				.nothrow()
				.catch(() => {});
		} else {
			// Check if there's already a remote
			const remoteCheck = await $`git remote get-url origin`.cwd(projectDir).quiet().nothrow();
			if (remoteCheck.exitCode === 0) {
				const existingUrl = remoteCheck.text().trim();
				logger.info("github: remote already configured", { url: existingUrl });
				return { url: existingUrl, created: true, cloneUrl: existingUrl, sshUrl: existingUrl };
			}
		}
	} catch {
		// Not a git repo — init
		await $`git init`.cwd(projectDir).quiet().nothrow();
		await $`git add -A`.cwd(projectDir).quiet().nothrow();
	}

	// Ensure gh auth
	const authenticated = await ensureGhAuth();
	if (!authenticated) {
		logger.warn("github: gh CLI not authenticated, cannot create repo");
		return { url: "", created: false, cloneUrl: "", sshUrl: "" };
	}

	return createRepo({ name: repoName, visibility: "public" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PR operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a pull request via `gh pr create`.
 */
export async function createPR(options: PROptions): Promise<PRResult> {
	logger.info("github: creating PR", { title: options.title, head: options.head, base: options.base });

	const draftFlag = options.draft ? "--draft" : "";
	try {
		const result = await $`
			gh pr create --title ${options.title} --body ${options.body} --head ${options.head} --base ${options.base} ${draftFlag}
		`
			.quiet()
			.nothrow();

		if (result.exitCode !== 0) {
			return { number: 0, url: "", merged: false };
		}

		const output = result.text().trim();
		// gh returns the PR URL on stdout
		const prNumber = parseInt(output.match(/#(\d+)/)?.[1] ?? "0", 10);
		logger.info("github: PR created", { number: prNumber, url: output });
		return { number: prNumber, url: output, merged: false };
	} catch (err) {
		logger.error("github: create PR failed", { error: err instanceof Error ? err.message : String(err) });
		return { number: 0, url: "", merged: false };
	}
}

/**
 * Merge a pull request via `gh pr merge`.
 */
export async function mergePR(prNumber: number, method: "merge" | "squash" | "rebase" = "squash"): Promise<boolean> {
	try {
		const r = await $`gh pr merge ${prNumber} --${method} --delete-branch`.quiet().nothrow();
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a GitHub issue via `gh issue create`.
 */
export async function createIssue(options: IssueOptions): Promise<IssueResult> {
	logger.info("github: creating issue", { title: options.title });

	const labelFlag = options.labels?.length ? `--label "${options.labels.join(",")}"` : "";
	const assigneeFlag = options.assignees?.length ? `--assignee "${options.assignees.join(",")}"` : "";

	try {
		const result = await $`
			gh issue create --title ${options.title} --body ${options.body} ${labelFlag} ${assigneeFlag}
		`
			.quiet()
			.nothrow();

		if (result.exitCode !== 0) {
			return { number: 0, url: "" };
		}

		const output = result.text().trim();
		const issueNumber = parseInt(output.match(/#(\d+)/)?.[1] ?? "0", 10);
		return { number: issueNumber, url: output };
	} catch (err) {
		logger.error("github: create issue failed", { error: err instanceof Error ? err.message : String(err) });
		return { number: 0, url: "" };
	}
}

/**
 * List issues via `gh issue list`.
 */
export async function listIssues(state: "open" | "closed" | "all" = "open", limit = 10): Promise<IssueResult[]> {
	try {
		const result = await $`gh issue list --state ${state} --limit ${limit} --json number,url`.quiet().nothrow();
		if (result.exitCode !== 0) return [];
		return JSON.parse(result.text()) as IssueResult[];
	} catch {
		return [];
	}
}

/**
 * Close a GitHub issue via `gh issue close`.
 */
export async function closeIssue(issueNumber: number): Promise<boolean> {
	try {
		const r = await $`gh issue close ${issueNumber}`.quiet().nothrow();
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// CI/CD integration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Trigger a GitHub Actions workflow dispatch event.
 */
export async function triggerWorkflowDispatch(
	workflow: string,
	ref: string = "main",
	inputs?: Record<string, string>,
): Promise<boolean> {
	try {
		const inputsJson = inputs ? JSON.stringify(inputs) : "{}";
		const r = await $`gh workflow run ${workflow} --ref ${ref} ${inputs ? `--json ${inputsJson}` : ""}`
			.quiet()
			.nothrow();
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * List workflow runs via `gh run list`.
 */
export async function listWorkflowRuns(
	limit = 5,
): Promise<Array<{ number: number; status: string; conclusion: string; url: string }>> {
	try {
		const result = await $`gh run list --limit ${limit} --json number,status,conclusion,databaseId`.quiet().nothrow();
		if (result.exitCode !== 0) return [];
		return JSON.parse(result.text()) as Array<{ number: number; status: string; conclusion: string; url: string }>;
	} catch {
		return [];
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Repo metadata
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the remote origin URL for the current project.
 */
export async function getRemoteUrl(projectDir: string): Promise<string | null> {
	try {
		const r = await $`git remote get-url origin`.cwd(projectDir).quiet().nothrow();
		if (r.exitCode === 0) return r.text().trim();
		return null;
	} catch {
		return null;
	}
}

/**
 * Set up git and push to GitHub. Used by Phase 5 to wire the generated project.
 * Returns true if the push succeeded.
 */
export async function setupAndPush(projectDir: string, repoName: string): Promise<boolean> {
	try {
		// 1. Init + add + commit if needed
		const gitDir = await $`git rev-parse --git-dir`.cwd(projectDir).quiet().nothrow();
		if (gitDir.exitCode !== 0) {
			await $`git init`.cwd(projectDir).quiet().nothrow();
			await $`git add -A`.cwd(projectDir).quiet().nothrow();
			await $`git commit -m "Initial commit from Pakalon"`
				.cwd(projectDir)
				.quiet()
				.nothrow()
				.catch(() => {});
		}

		// 2. Create the GitHub repo if it doesn't exist
		const repo = await createGitHubRepo(projectDir, repoName);
		if (!repo.created) return false;

		// 3. Push
		const push = await $`git push -u origin main`.cwd(projectDir).quiet().nothrow();
		if (push.exitCode !== 0) {
			// Maybe the branch is master instead of main
			const pushMaster = await $`git push -u origin master`.cwd(projectDir).quiet().nothrow();
			return pushMaster.exitCode === 0;
		}
		return true;
	} catch (err) {
		logger.error("github: setup and push failed", { error: err instanceof Error ? err.message : String(err) });
		return false;
	}
}
