/**
 * Cosine similarity + L2 norm helpers for vector-store backends.
 *
 * Kept dependency-free so it works in the sandbox image where we cannot
 * pull in heavy numeric libraries.
 */
export function l2norm(v: number[]): number {
	let s = 0;
	for (const x of v) s += x * x;
	return Math.sqrt(s) || 1;
}

/** Cosine similarity. Returns 0 when either vector has zero norm. */
export function cosine(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	let dot = 0;
	for (let i = 0; i < n; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
	}
	const na = l2norm(a);
	const nb = l2norm(b);
	if (na === 0 || nb === 0) return 0;
	return dot / (na * nb);
}
