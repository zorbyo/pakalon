/**
 * Codebase Scanner for Auditor Tool
 *
 * Scans directories and files to produce audit reports.
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, extname, relative } from 'path';

// File size thresholds
const LARGE_FILE_THRESHOLD = 500;
const COMPLEX_FUNCTION_THRESHOLD = 50;

// Patterns for detection
const SECRET_PATTERNS = [
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub Personal Access Token' },
  { pattern: /sk-[a-zA-Z0-9]{48}/, name: 'OpenAI API Key' },
  { pattern: /AKIA[0-9A-Z]{16}/, name: 'AWS Access Key' },
  { pattern: /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}:[a-zA-Z0-9._-]+/, name: 'Email:password pattern' },
  { pattern: /password\s*=\s*['"][^'"]+['"]/i, name: 'Hardcoded password' },
  { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/i, name: 'Hardcoded API key' },
  { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, name: 'Private key file' },
];

const TECH_PATTERNS = {
  // Frontend
  'React': /\bimport\s+.*\s+from\s+['"]react['"]/,
  'Vue': /\bimport\s+.*\s+from\s+['"]vue['"]/,
  'Svelte': /\bimport\s+.*\s+from\s+['"]svelte['"]/,
  'Angular': /\bimport\s+.*\s+from\s+['"]@angular\/core['"]/,
  'Next.js': /next[\\/]react|next[\\/]dist/,
  'Nuxt': /nuxt[\\/]dist|@nuxt/,
  'SvelteKit': /@sveltejs[\\/]kit/,

  // Backend
  'Express': /\bimport\s+.*\s+from\s+['"]express['"]/,
  'FastAPI': /\bfrom\s+fastapi\s+import|@app\.(get|post|put|delete)/,
  'Django': /\bfrom\s+django|import\s+django/,
  'Rails': /rails|ActiveRecord/,
  'Spring': /\bimport\s+org\.springframework/,
  'Gin': /\bimport\s+github\.com/gin-gonic/,
  'Axum': /\bimport\s+github\.com/tokio/axum/,

  // Databases
  'PostgreSQL': /postgres|pg_|postgresql/,
  'MySQL': /mysql|MySQL/,
  'MongoDB': /mongodb|mongoose/,
  'Redis': /redis|ioredis/,
  'SQLite': /sqlite|drizzle.*sqlite/,

  // Build Tools
  'Webpack': /webpack\.config|module\.rules/,
  'Vite': /vite|@vitejs/,
  'esbuild': /esbuild/,
  'Rollup': /rollup/,
  'Turbopack': /turbopack/,

  // Testing
  'Vitest': /vitest|@vitest/,
  'Jest': /jest|@jest/,
  'pytest': /import\s+pytest/,
  'Go test': /_test\.go\b/,
  'RSpec': /rspec/,

  // ORMs
  'Prisma': /prisma|@prisma/,
  'Drizzle': /drizzle|drizzle-orm/,
  'SQLAlchemy': /sqlalchemy/,
  'TypeORM': /typeorm|@typeorm/,
};

interface ScanOptions {
  scope: 'full' | 'security' | 'quality' | 'structure' | 'tech';
  includePatterns?: string[];
  excludePatterns?: string[];
}

interface ScanResult {
  success: boolean;
  scope: string;
  summary: {
    totalFiles: number;
    languages: Record<string, number>;
    healthScore: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
  };
  technologies: string[];
  issues: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    file: string;
    line?: number;
    category: string;
    message: string;
    suggestion?: string;
  }>;
  recommendations: string[];
  structure?: {
    directories: number;
    averageFileSize: number;
    largestFiles: Array<{ path: string; lines: number }>;
  };
  scannedAt: string;
}

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  'TypeScript': ['.ts', '.tsx'],
  'JavaScript': ['.js', '.jsx', '.mjs', '.cjs'],
  'Python': ['.py'],
  'Go': ['.go'],
  'Rust': ['.rs'],
  'Java': ['.java'],
  'CSharp': ['.cs'],
  'C++': ['.cpp', '.cc', '.cxx', '.h', '.hpp'],
  'Ruby': ['.rb'],
  'PHP': ['.php'],
  'Swift': ['.swift'],
  'Kotlin': ['.kt', '.kts'],
  'HTML': ['.html', '.htm'],
  'CSS': ['.css', '.scss', '.sass', '.less'],
  'JSON': ['.json'],
  'YAML': ['.yaml', '.yml'],
  'Markdown': ['.md'],
};

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
]);

export async function scanCodebase(
  rootPath: string,
  options: ScanOptions
): Promise<ScanResult> {
  const { scope = 'full' } = options;

  const files: Array<{ path: string; content: string; stats: Awaited<ReturnType<typeof stat>> }> = [];
  const issues: ScanResult['issues'] = [];
  const technologies = new Set<string>();
  const languages: Record<string, number> = {};
  let totalLines = 0;
  let scannedFiles = 0;

  // Collect files
  async function walkDir(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(rootPath, fullPath);

        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !relPath.includes('.')) {
            await walkDir(fullPath);
          }
          continue;
        }

        if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (!ext) continue;

          // Check excluded patterns
          if (options.excludePatterns?.some(p => matchesPattern(relPath, p))) {
            continue;
          }

          // Check included patterns
          if (options.includePatterns?.length && !options.includePatterns.some(p => matchesPattern(relPath, p))) {
            continue;
          }

          try {
            const stats = await stat(fullPath);
            const content = await readFile(fullPath, 'utf-8');

            files.push({ path: relPath, content, stats });
            scannedFiles++;
            totalLines += content.split('\n').length;

            // Detect language
            for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
              if (exts.includes(ext)) {
                languages[lang] = (languages[lang] || 0) + 1;
                break;
              }
            }

            // Detect technologies
            for (const [tech, pattern] of Object.entries(TECH_PATTERNS)) {
              if (pattern.test(content)) {
                technologies.add(tech);
              }
            }

            // Scan based on scope
            if (scope === 'full' || scope === 'security') {
              scanForSecurityIssues(content, relPath, issues);
            }

            if (scope === 'full' || scope === 'quality') {
              scanForQualityIssues(content, relPath, issues);
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  await walkDir(rootPath);

  // Generate recommendations
  const recommendations = generateRecommendations(issues, technologies);

  // Calculate health score
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const highCount = issues.filter(i => i.severity === 'high').length;
  const mediumCount = issues.filter(i => i.severity === 'medium').length;
  const healthScore = Math.max(0, 100 - (criticalCount * 20) - (highCount * 10) - (mediumCount * 3));

  // Calculate structure metrics
  let structure: ScanResult['structure'] | undefined;
  if (scope === 'full' || scope === 'structure') {
    const directories = new Set(files.map(f => f.path.split('/').slice(0, -1).join('/'))).size;
    const avgSize = scannedFiles > 0 ? Math.round(totalLines / scannedFiles) : 0;
    const largestFiles = files
      .map(f => ({ path: f.path, lines: f.content.split('\n').length }))
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 10);

    structure = {
      directories,
      averageFileSize: avgSize,
      largestFiles,
    };
  }

  return {
    success: true,
    scope,
    summary: {
      totalFiles: scannedFiles,
      languages,
      healthScore,
      criticalIssues: criticalCount,
      highIssues: highCount,
      mediumIssues: mediumCount,
      lowIssues: issues.filter(i => i.severity === 'low').length,
    },
    technologies: Array.from(technologies).sort(),
    issues: issues.slice(0, 100), // Limit to 100 issues
    recommendations,
    structure,
    scannedAt: new Date().toISOString(),
  };
}

function matchesPattern(path: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1);
    return path.endsWith(ext);
  }
  return path.includes(pattern);
}

function scanForSecurityIssues(
  content: string,
  filePath: string,
  issues: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    file: string;
    line?: number;
    category: string;
    message: string;
    suggestion?: string;
  }>
): void {
  const lines = content.split('\n');

  for (const { pattern, name } of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        issues.push({
          severity: 'critical',
          file: filePath,
          line: i + 1,
          category: 'secrets',
          message: `${name} detected`,
          suggestion: 'Use environment variables instead of hardcoded secrets',
        });
      }
    }
  }

  // SQL injection patterns
  for (let i = 0; i < lines.length; i++) {
    if (/\b(sql|query)\s*[+=]\s*['"`].*?\+.*?['"`]/.test(lines[i])) {
      issues.push({
        severity: 'high',
        file: filePath,
        line: i + 1,
        category: 'sql-injection',
        message: 'Potential SQL injection risk - string concatenation in query',
        suggestion: 'Use parameterized queries instead of string concatenation',
      });
    }
  }

  // XSS patterns
  for (let i = 0; i < lines.length; i++) {
    if (/innerHTML\s*=|dangerouslySetInnerHTML/.test(lines[i])) {
      issues.push({
        severity: 'medium',
        file: filePath,
        line: i + 1,
        category: 'xss',
        message: 'Potential XSS risk - innerHTML or dangerouslySetInnerHTML usage',
        suggestion: 'Use textContent or sanitize HTML before insertion',
      });
    }
  }
}

function scanForQualityIssues(
  content: string,
  filePath: string,
  issues: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    file: string;
    line?: number;
    category: string;
    message: string;
    suggestion?: string;
  }>
): void {
  const lines = content.split('\n');

  // Check for console.log
  for (let i = 0; i < lines.length; i++) {
    if (/\bconsole\.(log|debug|info)\s*\(/.test(lines[i])) {
      issues.push({
        severity: 'low',
        file: filePath,
        line: i + 1,
        category: 'code-quality',
        message: 'Console statement found',
        suggestion: 'Remove console.log/debug statements in production code',
      });
    }
  }

  // Check for TODO/FIXME
  for (let i = 0; i < lines.length; i++) {
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(lines[i])) {
      issues.push({
        severity: 'info',
        file: filePath,
        line: i + 1,
        category: 'code-quality',
        message: 'TODO/FIXME comment found',
        suggestion: 'Create a GitHub issue to track this task',
      });
    }
  }

  // Check for bare except
  for (let i = 0; i < lines.length; i++) {
    if (/\bexcept\s*:/.test(lines[i])) {
      issues.push({
        severity: 'medium',
        file: filePath,
        line: i + 1,
        category: 'error-handling',
        message: 'Bare except clause found',
        suggestion: 'Use specific exception types instead of bare except',
      });
    }
  }

  // Check for large files
  if (lines.length > LARGE_FILE_THRESHOLD) {
    issues.push({
      severity: 'medium',
      file: filePath,
      category: 'complexity',
      message: `Large file detected (${lines.length} lines)`,
      suggestion: 'Consider splitting into smaller, focused modules',
    });
  }

  // Check for 'any' type in TypeScript
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    for (let i = 0; i < lines.length; i++) {
      if (/: any\b/.test(lines[i])) {
        issues.push({
          severity: 'low',
          file: filePath,
          line: i + 1,
          category: 'type-safety',
          message: 'Usage of "any" type',
          suggestion: 'Use specific types or unknown instead of any',
        });
      }
    }
  }
}

function generateRecommendations(
  issues: Array<{ severity: string; category: string }>,
  technologies: Set<string>
): string[] {
  const recommendations: string[] = [];

  const criticalCategories = new Set(issues.filter(i => i.severity === 'critical').map(i => i.category));
  if (criticalCategories.has('secrets')) {
    recommendations.push('Implement proper secret management using environment variables or a secret manager');
  }
  if (criticalCategories.has('sql-injection')) {
    recommendations.push('Use parameterized queries or an ORM to prevent SQL injection attacks');
  }

  const highCategories = new Set(issues.filter(i => i.severity === 'high').map(i => i.category));
  if (highCategories.has('sql-injection')) {
    recommendations.push('Review all database queries for potential injection vulnerabilities');
  }

  const mediumCategories = new Set(issues.filter(i => i.severity === 'medium').map(i => i.category));
  if (mediumCategories.has('error-handling')) {
    recommendations.push('Improve error handling by using specific exception types');
  }
  if (mediumCategories.has('complexity')) {
    recommendations.push('Refactor large files into smaller, focused modules');
  }

  // Tech-based recommendations
  if (technologies.has('React') && !technologies.has('TypeScript')) {
    recommendations.push('Consider adding TypeScript for better type safety');
  }
  if (technologies.has('Express') || technologies.has('FastAPI')) {
    recommendations.push('Add rate limiting to protect against DDoS attacks');
  }

  if (recommendations.length === 0) {
    recommendations.push('Codebase looks healthy! Maintain current practices.');
  }

  return recommendations;
}