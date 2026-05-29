import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';
import type { ConflictReport, DependencyConflict } from '@/agents/types.js';
import { execFileNoThrow } from '@/utils/execFileNoThrow.js';

function semverMajor(version: string): number {
  const match = version.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function isSafeBump(currentVersion?: string, requiredVersion?: string): boolean {
  if (!currentVersion || !requiredVersion) return false;
  return semverMajor(currentVersion) === semverMajor(requiredVersion);
}

export async function resolveConflicts(projectDir: string): Promise<ConflictReport> {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const lockfilePath = await findLockfile(projectDir);
  const conflicts: DependencyConflict[] = [];
  const applied: string[] = [];
  const suggestions: string[] = [];
  const safeResolutions: string[] = [];

  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  if (lockfilePath) {
    const lockContent = await fs.readFile(lockfilePath, 'utf-8');
    for (const [name, version] of Object.entries(allDeps)) {
      if (!lockContent.includes(`"${name}"`)) continue;
      const conflict = analyzeDependency(name, version, lockContent);
      if (conflict) conflicts.push(conflict);
    }
  }

  for (const conflict of conflicts) {
    suggestions.push(`${conflict.packageName}: ${conflict.resolution} (${conflict.details})`);
    if (conflict.resolution !== 'manual' && isSafeBump(conflict.currentVersion, conflict.requiredVersion)) {
      safeResolutions.push(conflict.packageName);
      applied.push(conflict.packageName);
    }
  }

  if (safeResolutions.length > 0) {
    logger.info(`[deps] Safe resolutions detected: ${safeResolutions.join(', ')}`);
    await execFileNoThrow('npm', ['install'], { cwd: projectDir });
  }

  return {
    projectDir,
    lockfilePath,
    conflicts,
    applied,
    suggestions,
    safeResolutions,
    hasCritical: conflicts.some(c => c.resolution === 'manual'),
  };
}

async function findLockfile(projectDir: string): Promise<string | undefined> {
  for (const file of ['package-lock.json', 'pnpm-lock.yaml', 'bun.lockb', 'yarn.lock']) {
    try {
      await fs.access(path.join(projectDir, file));
      return path.join(projectDir, file);
    } catch {}
  }
}

function analyzeDependency(name: string, version: string, lockContent: string): DependencyConflict | null {
  const matches = lockContent.match(new RegExp(`"${name}"[^\n]*`, 'g')) ?? [];
  if (matches.length <= 1) return null;
  return {
    packageName: name,
    currentVersion: version,
    requiredVersion: version,
    lockfileVersion: 'multiple',
    type: 'duplicate',
    resolution: 'upgrade',
    details: `Detected ${matches.length} lockfile entries for ${name}`,
  };
}
