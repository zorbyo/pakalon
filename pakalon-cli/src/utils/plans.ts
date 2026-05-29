/**
 * Plans utilities
 *
 * Provides utilities for managing plan slugs and plans directory.
 */

import { join } from 'path';

let cachedPlansDir: string | null = null;

/**
 * Get the plans directory path
 */
export function getPlansDirectory(): { path: string; cache: { clear?: () => void } } {
  if (!cachedPlansDir) {
    cachedPlansDir = join(process.cwd(), '.claude', 'plans');
  }
  return {
    path: cachedPlansDir,
    cache: {
      clear: () => {
        cachedPlansDir = null;
      },
    },
  };
}

/**
 * Get a slug from the current plan
 */
export function getPlanSlug(): string {
  // Generate a slug from the current directory name
  const cwd = process.cwd();
  const parts = cwd.split(/[/\\]/);
  const dirName = parts[parts.length - 1] || 'plan';
  // Sanitize for use as a git branch name
  return dirName.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 64);
}