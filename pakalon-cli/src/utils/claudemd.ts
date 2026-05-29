/**
 * Claude.md utilities
 *
 * Provides utilities for managing claude.md file caches.
 */

/**
 * Clear memoized caches that depend on the current working directory.
 * This is called when changing directories to ensure cached file
 * reads are invalidated.
 */
export function clearMemoryFileCaches(): void {
  // In a full implementation, this would clear various memoization caches
  // For now, this is a no-op stub that allows the function to be called
  // without errors.
}