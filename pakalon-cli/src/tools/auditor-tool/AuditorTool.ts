import { z } from 'zod/v4';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { AUDIT_TOOL_NAME } from './constants.js';
import { DESCRIPTION, generatePrompt } from './prompt.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    scope: z
      .enum(['full', 'security', 'quality', 'structure', 'tech'])
      .optional()
      .default('full')
      .describe('Audit scope: full, security, quality, structure, or tech'),
    path: z
      .string()
      .optional()
      .describe('Path to audit (defaults to current directory)'),
    includePatterns: z
      .array(z.string())
      .optional()
      .describe('File patterns to include (e.g., ["*.ts", "*.py"])'),
    excludePatterns: z
      .array(z.string())
      .optional()
      .describe('File patterns to exclude (e.g., ["node_modules", "*.test.ts"])'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    scope: z.string(),
    summary: z.object({
      totalFiles: z.number(),
      languages: z.record(z.string()),
      healthScore: z.number(),
      criticalIssues: z.number(),
      highIssues: z.number(),
      mediumIssues: z.number(),
      lowIssues: z.number(),
    }),
    technologies: z.array(z.string()),
    issues: z.array(
      z.object({
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
        file: z.string(),
        line: z.number().optional(),
        category: z.string(),
        message: z.string(),
        suggestion: z.string().optional(),
      }),
    ),
    recommendations: z.array(z.string()),
    structure: z
      .object({
        directories: z.number(),
        averageFileSize: z.number(),
        largestFiles: z.array(
          z.object({
            path: z.string(),
            lines: z.number(),
          }),
        ),
      })
      .optional(),
    scannedAt: z.string(),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Input = z.infer<InputSchema>;
export type Output = z.infer<OutputSchema>;

export const AuditorTool = buildTool({
  name: AUDIT_TOOL_NAME,
  searchHint: 'audit codebase, scan for security issues, analyze code quality',
  maxResultSizeChars: 500_000,
  async description() {
    return DESCRIPTION;
  },
  async prompt() {
    return generatePrompt();
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  async execute(input: Input, extras) {
    const { workspacePath } = extras.agent;
    const scope = input.scope || 'full';
    const targetPath = input.path || workspacePath || process.cwd();

    const { scanCodebase } = await import('./scanner.js');

    const result = await scanCodebase(targetPath, {
      scope,
      includePatterns: input.includePatterns,
      excludePatterns: input.excludePatterns,
    });

    return result;
  },
});

export type AuditorToolDef = ToolDef<Input, Output>;