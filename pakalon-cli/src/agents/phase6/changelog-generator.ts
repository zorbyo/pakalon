import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type ChangelogSection = 'Added' | 'Changed' | 'Deprecated' | 'Removed' | 'Fixed' | 'Security';

interface GitCommitEntry {
  hash: string;
  message: string;
  scope?: string;
  type: string;
}

function categorizeCommit(message: string): ChangelogSection {
  const lower = message.toLowerCase();
  if (lower.startsWith('feat') || lower.includes(' add ')) return 'Added';
  if (lower.startsWith('fix') || lower.includes('bug')) return 'Fixed';
  if (lower.includes('security') || lower.includes('vulnerability')) return 'Security';
  if (lower.startsWith('refactor') || lower.startsWith('chore') || lower.startsWith('perf')) return 'Changed';
  if (lower.startsWith('deprecate')) return 'Deprecated';
  if (lower.startsWith('remove') || lower.startsWith('delete')) return 'Removed';
  return 'Changed';
}

function parseCommitLine(line: string): GitCommitEntry | null {
  const [hash, message = ''] = line.split('\u241f');
  if (!hash) return null;
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
  return {
    hash,
    message: match?.[3] ?? message,
    type: match?.[1] ?? 'other',
    scope: match?.[2],
  };
}

export async function generateChangelog(projectDir: string, sinceTag?: string): Promise<string> {
  const args = ['log', '--pretty=format:%H\u241f%s'];
  if (sinceTag) args.unshift(`${sinceTag}..HEAD`);
  const { stdout } = await execFileAsync('git', args, { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 });
  const commits = stdout.split(/\r?\n/).map(parseCommitLine).filter((entry): entry is GitCommitEntry => Boolean(entry));

  const sections: Record<ChangelogSection, string[]> = {
    Added: [],
    Changed: [],
    Deprecated: [],
    Removed: [],
    Fixed: [],
    Security: [],
  };

  for (const commit of commits) {
    const section = categorizeCommit(`${commit.type}: ${commit.message}`);
    sections[section].push(`- ${commit.message} (${commit.hash.slice(0, 7)})`);
  }

  const generatedAt = new Date().toISOString();
  const content = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

${(Object.entries(sections) as Array<[ChangelogSection, string[]]>)
  .map(([section, entries]) => `### ${section}\n${entries.length ? entries.join('\n') : '- No entries yet.'}`)
  .join('\n\n')}

---
Generated from git history at ${generatedAt}
`;

  const changelogPath = path.join(projectDir, 'CHANGELOG.md');
  await fs.writeFile(changelogPath, content, 'utf-8');
  return changelogPath;
}
