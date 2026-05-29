export interface CompactPromptOptions {
  reason: string;
  tokensSaved: number;
  messageCount: { before: number; after: number };
  toolResultsCompacted: number;
  contentReplaced: number;
  focusHint?: string;
  notes?: string[];
}

export interface CompactSummaryState {
  reason: string;
  tokensSaved: number;
  messageCount: { before: number; after: number };
  toolResultsCompacted: number;
  contentReplaced: number;
}

export function generateCompactPrompt(options: CompactPromptOptions): string {
  const sections = [
    "You are condensing conversation context.",
    `Reason: ${options.reason}`,
    `Tokens saved: ${options.tokensSaved}`,
    `Messages: ${options.messageCount.before} -> ${options.messageCount.after}`,
    `Tool results compacted: ${options.toolResultsCompacted}`,
    `Content replaced: ${options.contentReplaced}`,
    options.focusHint ? `Focus: ${options.focusHint}` : null,
    options.notes?.length ? `Notes:\n${options.notes.map((note) => `- ${note}`).join("\n")}` : null,
    "Preserve decisions, file paths, commands, tool outcomes, unresolved issues, and next actions.",
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function formatCompactSummary(state: CompactSummaryState): string {
  return [
    `Compacted because: ${state.reason}`,
    `Messages: ${state.messageCount.before} → ${state.messageCount.after}`,
    `Tokens saved: ${state.tokensSaved}`,
    `Tool results compacted: ${state.toolResultsCompacted}`,
    `Content replaced: ${state.contentReplaced}`,
  ].join("\n");
}
