import { ContentBudgetManager } from "@/tools/contentBudget.js";

export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5;
export const POST_COMPACT_TOKEN_BUDGET = 50_000;
export const POST_COMPACT_FILE_BUDGET = 5_000;
export const POST_COMPACT_SKILL_BUDGET = 5_000;

export interface PostCompactFileReference {
  path: string;
  content?: string;
  skillName?: string;
}

export interface PostCompactCleanupResult {
  content: string;
  restoredFiles: number;
  truncated: boolean;
}

export function restoreFilesAfterCompact(
  content: string,
  files: readonly PostCompactFileReference[] = [],
): PostCompactCleanupResult {
  const budget = new ContentBudgetManager({ maxToolResultChars: POST_COMPACT_TOKEN_BUDGET });
  const selected = files.slice(0, POST_COMPACT_MAX_FILES_TO_RESTORE);
  const blocks: string[] = [content.trim()];
  let restoredFiles = 0;

  for (const file of selected) {
    const header = `[Restored File] ${file.path}`;
    const fileContent = (file.content ?? "").slice(0, POST_COMPACT_FILE_BUDGET);
    const skillSuffix = file.skillName ? ` (skill: ${file.skillName.slice(0, POST_COMPACT_SKILL_BUDGET)})` : "";
    const block = `${header}${skillSuffix}\n${fileContent}`.trim();
    if (!budget.canAddToolResult(file.path, block, restoredFiles)) break;
    budget.addToolResult(file.path, file.path, block);
    blocks.push(block);
    restoredFiles += 1;
  }

  return {
    content: blocks.join("\n\n---\n\n"),
    restoredFiles,
    truncated: restoredFiles < Math.min(files.length, POST_COMPACT_MAX_FILES_TO_RESTORE),
  };
}

export function runPostCompactCleanup(
  compactSuccess: boolean,
  filesToRestore: readonly PostCompactFileReference[] = [],
): PostCompactCleanupResult {
  if (!compactSuccess) {
    return { content: "", restoredFiles: 0, truncated: false };
  }
  return restoreFilesAfterCompact("", filesToRestore);
}
