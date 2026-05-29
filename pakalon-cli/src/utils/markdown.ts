/**
 * Markdown generation utilities — replaces Python markdown helpers.
 *
 * Provides reusable functions for generating structured markdown content
 * used across all 6 phase agents.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface MarkdownSection {
  title: string;
  level?: 1 | 2 | 3 | 4;
  content: string;
}

export interface MarkdownTableRow {
  [key: string]: string;
}

/**
 * Generate a level-1 heading
 */
export function h1(text: string): string {
  return `# ${text}\n`;
}

/**
 * Generate a level-2 heading
 */
export function h2(text: string): string {
  return `## ${text}\n`;
}

/**
 * Generate a level-3 heading
 */
export function h3(text: string): string {
  return `### ${text}\n`;
}

/**
 * Generate a level-4 heading
 */
export function h4(text: string): string {
  return `#### ${text}\n`;
}

/**
 * Wrap text in bold
 */
export function bold(text: string): string {
  return `**${text}**`;
}

/**
 * Wrap text in italic
 */
export function italic(text: string): string {
  return `*${text}*`;
}

/**
 * Wrap text in inline code
 */
export function code(text: string): string {
  return `\`${text}\``;
}

/**
 * Generate a code block with language
 */
export function codeBlock(code: string, language = ''): string {
  return `\`\`\`${language}\n${code}\n\`\`\`\n`;
}

/**
 * Generate an unordered list item
 */
export function ul(items: string[]): string {
  return items.map(item => `- ${item}`).join('\n') + '\n';
}

/**
 * Generate an ordered list item
 */
export function ol(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n') + '\n';
}

/**
 * Generate a table from array of objects
 */
export function table(headers: string[], rows: MarkdownTableRow[]): string {
  if (rows.length === 0) return '';

  const headerRow = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataRows = rows.map(row =>
    `| ${headers.map(h => String(row[h] ?? '')).join(' | ')} |`,
  );

  return [headerRow, separator, ...dataRows].join('\n') + '\n';
}

/**
 * Generate a horizontal rule
 */
export function hr(): string {
  return '---\n';
}

/**
 * Generate a blockquote
 */
export function blockquote(text: string): string {
  return `> ${text}\n`;
}

/**
 * Generate a link
 */
export function link(text: string, url: string): string {
  return `[${text}](${url})`;
}

/**
 * Generate a checklist item (checked or unchecked)
 */
export function checklist(text: string, checked = false): string {
  return `- [${checked ? 'x' : ' '}] ${text}\n`;
}

/**
 * Build a complete markdown document from sections
 */
export function document(sections: MarkdownSection[]): string {
  return sections
    .map(section => {
      const heading = section.level === 1
        ? h1(section.title)
        : section.level === 2
        ? h2(section.title)
        : section.level === 3
        ? h3(section.title)
        : section.level === 4
        ? h4(section.title)
        : '';

      return `${heading}${section.content}\n`;
    })
    .join('');
}

/**
 * Generate a file header with title and metadata
 */
export function fileHeader(title: string, metadata?: Record<string, string>): string {
  const lines = [
    h1(title),
    '',
    metadata ? table(Object.keys(metadata), [metadata]) : '',
  ];
  return lines.filter(Boolean).join('');
}

/**
 * Generate a phase summary header
 */
export function phaseHeader(phase: number, title: string, description: string): string {
  return [
    h1(`Phase ${phase}: ${title}`),
    '',
    description,
    '',
    hr(),
    '',
  ].join('');
}

/**
 * Write markdown content to file, ensuring directory exists
 */
export async function writeMarkdown(
  filePath: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Read markdown file and return content
 */
export async function readMarkdown(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Generate a task list in markdown format
 */
export function taskList(tasks: Array<{ done: boolean; text: string }>): string {
  return tasks.map(t => checklist(t.text, t.done)).join('');
}

/**
 * Generate an API endpoint documentation entry
 */
export function apiEndpoint(
  method: string,
  path: string,
  description: string,
  params?: { name: string; type: string; required: boolean; description: string }[],
  response?: { status: number; description: string },
): string {
  const lines = [
    `### ${method.toUpperCase()} ${path}`,
    '',
    description,
    '',
  ];

  if (params && params.length > 0) {
    lines.push('**Parameters:**', '');
    lines.push(
      table(
        ['Name', 'Type', 'Required', 'Description'],
        params.map(p => ({
          Name: code(p.name),
          Type: code(p.type),
          Required: p.required ? 'Yes' : 'No',
          Description: p.description,
        })),
      ),
    );
  }

  if (response) {
    lines.push(`**Response:** \`${response.status}\` — ${response.description}`, '');
  }

  return lines.join('');
}

/**
 * Generate a changelog entry
 */
export function changelogEntry(version: string, date: string, changes: string[]): string {
  return [
    `## ${version} — ${date}`,
    '',
    ul(changes),
    '',
  ].join('');
}

/**
 * Generate a README.md scaffold for a project
 */
export function readmeScaffold(title: string, description: string, setup: string, usage: string): string {
  return [
    h1(title),
    '',
    description,
    '',
    hr(),
    '',
    h2('Setup'),
    '',
    setup,
    '',
    h2('Usage'),
    '',
    usage,
    '',
    hr(),
    '',
    `*Generated by Pakalon Phase 6 — ${new Date().toISOString().split('T')[0]}*`,
  ].join('');
}

export default {
  h1, h2, h3, h4,
  bold, italic, code, codeBlock,
  ul, ol, table,
  hr, blockquote, link, checklist,
  document, fileHeader, phaseHeader,
  writeMarkdown, readMarkdown,
  taskList, apiEndpoint, changelogEntry, readmeScaffold,
};