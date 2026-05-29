export function getPushNotificationToolPrompt(): string {
	return `Send a push notification to the user's device.

Use this to notify the user about important events when they may not be actively watching the terminal.
Notifications appear on the user's device even when the CLI is running in the background.

Options:
- title: Notification title (required)
- body: Notification body text (required)
- priority: Notification priority - low, normal, or high (default: normal)
- sound: Whether to play a sound (default: true for high priority)

Returns notification delivery status.`;
}

export function getPushNotificationToolDescription(input: { title?: string; priority?: string }): string {
	const title = input.title ? ` "${input.title}"` : "";
	const priority = input.priority ? ` (${input.priority})` : "";
	return `Push notification${title}${priority}`;
}
