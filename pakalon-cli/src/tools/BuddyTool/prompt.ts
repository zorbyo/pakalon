export function getBuddyToolPrompt(): string {
	return `Manage the buddy system for peer review and accountability.

The buddy system pairs agents together for mutual code review, progress checks, and quality assurance.
Use this to register as available for buddy pairing, check on your buddy's status, or submit review feedback.

Actions:
- register: Register yourself as available for buddy pairing
- unregister: Remove yourself from the buddy pool
- check: Check on your assigned buddy's status
- review: Submit a review of your buddy's work
- status: Get the current buddy system status

Returns buddy pairing status, review results, or system status information.`;
}

export function getBuddyToolDescription(input: { action?: string; buddy?: string }): string {
	const { action, buddy } = input;
	const buddyPart = buddy ? ` with ${buddy}` : "";
	return `Buddy system: ${action ?? "manage"}${buddyPart}`;
}
