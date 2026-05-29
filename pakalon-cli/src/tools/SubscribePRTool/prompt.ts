export function getSubscribePRToolPrompt(): string {
	return `Subscribe to a GitHub Pull Request for notifications and updates.

Use this to monitor a PR for new comments, review requests, status changes, and CI updates.
You will receive notifications when the PR is updated.

Options:
- repo: Repository in format "owner/repo" (required)
- prNumber: Pull request number (required)
- events: Events to subscribe to - comments, reviews, status, ci, or all (default: all)

Returns subscription confirmation with PR details and subscribed events.`;
}

export function getSubscribePRToolDescription(input: { repo?: string; prNumber?: number }): string {
	const repo = input.repo ? ` ${input.repo}` : "";
	const pr = input.prNumber ? ` #${input.prNumber}` : "";
	return `Subscribe to PR${repo}${pr}`;
}
