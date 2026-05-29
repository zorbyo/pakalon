import * as fs from "fs/promises";
import path from "path";
import logger from "@/utils/logger.js";
import { scrapeUrl } from "@/scrape/scraper.js";

export interface ComponentImportOptions {
  url: string;
  componentName?: string;
  outputDir?: string;
  framework?: "react" | "vue" | "svelte";
  installDependencies?: boolean;
}

export interface ComponentImportResult {
  success: boolean;
  componentName: string;
  filePath: string;
  sourceCode: string;
  dependencies?: string[];
  warnings?: string[];
}

type ComponentFramework = "react" | "vue" | "svelte" | "unknown";

type CodeBlock = {
  language: string;
  code: string;
};

const REACT_COMPONENT_HINTS = [
  /from\s+["']react["']/i,
  /from\s+["']next\//i,
  /\bclassName=/i,
  /\buse(State|Effect|Memo|Callback|Ref)\s*\(/,
  /\bcreateElement\s*\(/i,
  /export\s+default\s+(function|class)\s+/i,
  /=>\s*<[^>]+>/,
];

const VUE_COMPONENT_HINTS = [
  /<template[\s>]/i,
  /<script\s+setup[\s>]/i,
  /from\s+["']vue["']/i,
  /defineComponent\s*\(/i,
  /\bv-[a-z-]+=/i,
  /\bref\s*\(/i,
  /\breactive\s*\(/i,
];

const SVELTE_COMPONENT_HINTS = [
  /<svelte:head>/i,
  /<script[^>]*>\s*[\s\S]*\bexport\s+let\b/i,
  /\bexport\s+let\b/i,
  /\bbind:/i,
  /\bon:/i,
  /from\s+["']svelte["']/i,
  /<style[\s>]/i,
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function toPascalCase(input: string): string {
  const cleaned = input
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();

  if (!cleaned) return "ImportedComponent";

  const parts = cleaned.split(/\s+/).filter(Boolean);
  const pascal = parts
    .map(part => part.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ""))
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return pascal || "ImportedComponent";
}

function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "imported-component";
}

function extractNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts.at(-1);
    if (!last) return null;
    const cleaned = last.replace(/\.[a-z0-9]+$/i, "");
    return cleaned ? toPascalCase(cleaned) : null;
  } catch {
    return null;
  }
}

function extractComponentNameFromSource(sourceCode: string): string | null {
  const namedMatch = sourceCode.match(/(?:export\s+default\s+)?(?:function|class)\s+([A-Z][A-Za-z0-9_]*)\b/);
  if (namedMatch?.[1]) return namedMatch[1];

  const constMatch = sourceCode.match(/const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\(|async\s*)?(?:function)?\s*\(?/);
  if (constMatch?.[1]) return constMatch[1];

  const vueNameMatch = sourceCode.match(/name\s*:\s*['"]([A-Z][A-Za-z0-9_]*)['"]/);
  if (vueNameMatch?.[1]) return vueNameMatch[1];

  return null;
}

function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const fence = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(markdown))) {
    blocks.push({
      language: (match[1] || "").trim().toLowerCase(),
      code: match[2].trim(),
    });
  }

  return blocks;
}

function looksLikeComponentSource(sourceCode: string): boolean {
  const text = sourceCode.trim();
  if (!text) return false;

  const hasJsx = /<\s*[A-Z][A-Za-z0-9]*(\s|>|\/)/.test(text) || /return\s*\(\s*<[^>]+>/.test(text);
  const hasSfc = /<template[\s>]/i.test(text) || /<script\s+setup[\s>]/i.test(text) || /<style[\s>]/i.test(text);
  const hasImports = /\bimport\s+.*from\s+["'][^"']+["']/.test(text) || /\bexport\s+default\s+/.test(text);

  return hasJsx || hasSfc || hasImports;
}

function scoreFramework(text: string, framework: Exclude<ComponentFramework, "unknown">): number {
  const hints = framework === "react" ? REACT_COMPONENT_HINTS : framework === "vue" ? VUE_COMPONENT_HINTS : SVELTE_COMPONENT_HINTS;
  return hints.reduce((score, hint) => score + (hint.test(text) ? 1 : 0), 0);
}

function guessFrameworkFromUrl(url: string): Exclude<ComponentFramework, "unknown"> | null {
  if (/ui\.shadcn\.com\/r\//i.test(url) || /magicui\.design\/r\//i.test(url)) {
    return "react";
  }

  if (/\.vue(?:\?|#|$)/i.test(url)) return "vue";
  if (/\.svelte(?:\?|#|$)/i.test(url)) return "svelte";
  if (/\.tsx?(?:\?|#|$)/i.test(url)) return "react";

  return null;
}

function detectFrameworkSync(sourceCode: string): ComponentFramework {
  const scores = {
    react: scoreFramework(sourceCode, "react"),
    vue: scoreFramework(sourceCode, "vue"),
    svelte: scoreFramework(sourceCode, "svelte"),
  };

  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [winner, score] = ordered[0] ?? ["unknown", 0];
  const second = ordered[1]?.[1] ?? 0;

  if (score === 0 || score === second) return "unknown";
  return winner as Exclude<ComponentFramework, "unknown">;
}

function extractDependenciesFromText(sourceCode: string): string[] {
  const dependencies = new Set<string>();

  const importRegex = /(?:import\s+(?:type\s+)?(?:[\w*\s{},]+?\s+from\s+)?|export\s+[^'"`]*\s+from\s+|require\()\s*["']([^"']+)["']/g;
  const cssImportRegex = /@import\s+["']([^"']+)["']/g;
  const dynamicImportRegex = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const regex of [importRegex, cssImportRegex, dynamicImportRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sourceCode))) {
      const specifier = match[1];
      if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:")) continue;
      dependencies.add(specifier);
    }
  }

  return Array.from(dependencies).sort();
}

function extractStyleImports(sourceCode: string): string[] {
  const imports = new Set<string>();
  const cssImportRegex = /import\s+["']([^"']+\.(?:css|scss|sass|less|styl)(?:\?[^"']*)?)["'];?/g;
  let match: RegExpExecArray | null;
  while ((match = cssImportRegex.exec(sourceCode))) {
    imports.add(match[1]);
  }
  return Array.from(imports);
}

function chooseSourceCode(markdown: string | undefined, html: string | undefined, url: string): {
  sourceCode: string;
  styleBlocks: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const styleBlocks: string[] = [];

  const candidates: Array<{ sourceCode: string; language?: string; score: number }> = [];
  const rawCandidates = [html, markdown].filter((value): value is string => Boolean(value));

  for (const candidate of rawCandidates) {
    if (looksLikeComponentSource(candidate)) {
      candidates.push({ sourceCode: candidate.trim(), score: 1 });
    }
  }

  if (markdown) {
    for (const block of extractCodeBlocks(markdown)) {
      if (!block.code) continue;
      if (/^(css|scss|sass|less|styl)$/i.test(block.language)) {
        styleBlocks.push(block.code);
        continue;
      }

      let score = 1;
      if (/^(tsx?|jsx?|vue|svelte)$/i.test(block.language)) score += 2;
      score += scoreFramework(block.code, "react");
      score += scoreFramework(block.code, "vue");
      score += scoreFramework(block.code, "svelte");
      candidates.push({ sourceCode: block.code.trim(), language: block.language, score });
    }
  }

  const ordered = candidates.sort((a, b) => b.score - a.score);
  const sourceCode = ordered[0]?.sourceCode ?? html?.trim() ?? markdown?.trim() ?? "";

  if (!sourceCode) {
    throw new Error(`No component source could be extracted from ${url}`);
  }

  return { sourceCode, styleBlocks, warnings };
}

function validateComponentSource(sourceCode: string, framework: ComponentFramework): boolean {
  const text = sourceCode.trim();
  if (!text) return false;

  if (framework === "react") {
    return looksLikeComponentSource(text) && (/<[A-Z][A-Za-z0-9]*/.test(text) || /export\s+default\s+(function|class)\s+[A-Z]/.test(text) || /const\s+[A-Z][A-Za-z0-9_]*\s*=/.test(text));
  }

  if (framework === "vue") {
    return /<template[\s>]/i.test(text) || /<script\s+setup[\s>]/i.test(text) || /defineComponent\s*\(/i.test(text);
  }

  if (framework === "svelte") {
    return /<script[^>]*>\s*[\s\S]*\bexport\s+let\b/i.test(text) || /<style[\s>]/i.test(text) || /<svelte:head>/i.test(text);
  }

  return false;
}

function resolveOutputDirectory(baseDir: string, framework: Exclude<ComponentFramework, "unknown">, url: string): string {
  const registryLike = /ui\.shadcn\.com\/r\//i.test(url) || /magicui\.design\/r\//i.test(url);

  if (framework === "svelte") {
    const libComponents = path.join(baseDir, "src", "lib", "components");
    const srcComponents = path.join(baseDir, "src", "components");
    return registryLike ? path.join(libComponents, "ui") : libComponents;
  }

  const srcComponents = path.join(baseDir, "src", "components");
  const components = path.join(baseDir, "components");
  return registryLike ? path.join(srcComponents, "ui") : srcComponents;
}

async function preferredDirectoryExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function ensureFrameworkDirectory(baseDir: string, framework: Exclude<ComponentFramework, "unknown">, url: string): Promise<string> {
  const candidates: string[] = [];

  if (framework === "svelte") {
    candidates.push(path.join(baseDir, "src", "lib", "components"));
    candidates.push(path.join(baseDir, "src", "components"));
    candidates.push(path.join(baseDir, "components"));
  } else {
    candidates.push(path.join(baseDir, "src", "components"));
    candidates.push(path.join(baseDir, "components"));
  }

  const registryLike = /ui\.shadcn\.com\/r\//i.test(url) || /magicui\.design\/r\//i.test(url);

  for (const candidate of candidates) {
    if (await preferredDirectoryExists(candidate)) {
      return registryLike ? path.join(candidate, "ui") : candidate;
    }
  }

  const fallback = resolveOutputDirectory(baseDir, framework, url);
  await fs.mkdir(fallback, { recursive: true });
  return fallback;
}

async function writeStyleFiles(targetDir: string, componentName: string, styleBlocks: string[], sourceCode: string): Promise<string[]> {
  if (styleBlocks.length === 0) return [];

  const written: string[] = [];
  const styleImports = extractStyleImports(sourceCode);
  const baseName = toKebabCase(componentName);

  if (styleImports.length > 0) {
    for (let i = 0; i < styleImports.length; i += 1) {
      const importedPath = styleImports[i];
      const fileName = path.basename(importedPath);
      const outputPath = path.join(targetDir, fileName);
      await fs.writeFile(outputPath, styleBlocks[i] ?? styleBlocks[0], "utf8");
      written.push(outputPath);
    }
    return written;
  }

  const outputPath = path.join(targetDir, `${baseName}.css`);
  await fs.writeFile(outputPath, styleBlocks.join("\n\n"), "utf8");
  written.push(outputPath);
  return written;
}

export async function detectComponentFramework(sourceCode: string): Promise<"react" | "vue" | "svelte" | "unknown"> {
  return detectFrameworkSync(sourceCode);
}

export async function extractDependencies(sourceCode: string): Promise<string[]> {
  return extractDependenciesFromText(sourceCode);
}

export async function importComponentFromUrl(options: ComponentImportOptions): Promise<ComponentImportResult> {
  const warnings: string[] = [];

  if (!options.url) {
    return {
      success: false,
      componentName: options.componentName ?? "ImportedComponent",
      filePath: "",
      sourceCode: "",
      warnings: ["URL is required"],
    };
  }

  const scrapeResult = await scrapeUrl({
    url: options.url,
    formats: ["markdown", "html"],
    timeout: 25_000,
    maxChars: 200_000,
  });

  if (!scrapeResult.success) {
    return {
      success: false,
      componentName: options.componentName ?? extractNameFromUrl(options.url) ?? "ImportedComponent",
      filePath: "",
      sourceCode: "",
      warnings: [scrapeResult.error ? `Failed to fetch component: ${scrapeResult.error}` : "Failed to fetch component source"],
    };
  }

  const extracted = chooseSourceCode(scrapeResult.markdown, scrapeResult.html, options.url);
  warnings.push(...extracted.warnings);

  let sourceCode = extracted.sourceCode;
  let framework = options.framework ?? detectFrameworkSync(sourceCode);

  if (framework === "unknown") {
    framework = guessFrameworkFromUrl(options.url) ?? detectFrameworkSync(sourceCode);
  }

  if (framework === "unknown") {
    return {
      success: false,
      componentName: options.componentName ?? extractNameFromUrl(options.url) ?? extractComponentNameFromSource(sourceCode) ?? "ImportedComponent",
      filePath: "",
      sourceCode,
      warnings: ["Unable to detect a valid component framework from the source or URL"],
    };
  }

  const componentName = options.componentName
    ?? extractComponentNameFromSource(sourceCode)
    ?? extractNameFromUrl(options.url)
    ?? "ImportedComponent";

  if (!validateComponentSource(sourceCode, framework)) {
    return {
      success: false,
      componentName,
      filePath: "",
      sourceCode,
      warnings: ["The fetched source does not look like a valid component for the detected framework"],
    };
  }

  const baseDir = path.resolve(options.outputDir ?? process.cwd());
  const targetDir = await ensureFrameworkDirectory(baseDir, framework, options.url);
  await fs.mkdir(targetDir, { recursive: true });

  const dependencies = await extractDependencies(sourceCode);
  const styleImportPaths = extractStyleImports(sourceCode);

  if (options.installDependencies) {
    warnings.push("installDependencies was requested, but dependency installation is not performed by this tool; dependencies are reported only");
  }

  if (styleImportPaths.length > 0) {
    warnings.push(...styleImportPaths.map(stylePath => `Found stylesheet import: ${stylePath}`));
  }

  const styleBlocks: string[] = extracted.sourceCode === sourceCode ? [] : [];
  if (extracted.sourceCode !== sourceCode) {
    // no-op; the extraction step already selected the best source candidate
  }

  const sourceStyleBlocks = extractCodeBlocks(scrapeResult.markdown ?? "").filter(block => /^(css|scss|sass|less|styl)$/i.test(block.language)).map(block => block.code);
  const writtenStyleFiles = await writeStyleFiles(targetDir, componentName, sourceStyleBlocks, sourceCode);

  if (writtenStyleFiles.length > 0) {
    warnings.push(...writtenStyleFiles.map(filePath => `Wrote style file: ${path.relative(baseDir, filePath)}`));
  }

  const ext = framework === "react" ? "tsx" : framework === "vue" ? "vue" : "svelte";
  const componentFile = path.join(targetDir, `${toKebabCase(componentName)}.${ext}`);

  if (framework === "react" && sourceStyleBlocks.length > 0 && styleImportPaths.length === 0 && !/\bimport\s+["'][^"']+\.css["'];?/i.test(sourceCode)) {
    sourceCode = `import \"./${path.basename(writtenStyleFiles[0] ?? `${toKebabCase(componentName)}.css`)}\";\n\n${sourceCode}`;
  }

  await fs.writeFile(componentFile, sourceCode.trimEnd() + "\n", "utf8");

  logger.info(`[component-url-import] Wrote ${componentName} to ${path.relative(baseDir, componentFile)}`);

  return {
    success: true,
    componentName,
    filePath: componentFile,
    sourceCode,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
