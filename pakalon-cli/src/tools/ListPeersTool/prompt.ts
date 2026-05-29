export function getListPeersToolPrompt(): string {
	return `List all connected peer sessions and their status.

Use this to discover available peers for cross-session communication.
Peers can be local sessions (via UDS) or remote sessions (via bridge).

Options:
- includeInactive: Whether to include recently disconnected peers (default: false)
- filter: Filter by peer type - local, remote, or all (default: all)

Returns a list of connected peers with their IDs, types, status, and connection details.`;
}

export function getListPeersToolDescription(input: { filter?: string }): string {
	const filter = input.filter ? ` (${input.filter})` : "";
	return `List connected peers${filter}`;
}
