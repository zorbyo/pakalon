import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";
import { type Diagnostic, getLSPDiagnosticRegistry } from "./LSPDiagnosticRegistry.js";
import { getLSPServerManager } from "./LSPServerManager.js";

export interface ExtensionRecommendation {
  extensionId: string;
  name: string;
  description: string;
  language: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface DiagnosticSuggestion {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
  suggestedFix?: string;
  canAutoFix: boolean;
}

type LanguageKey =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "cpp"
  | "c"
  | "php"
  | "kotlin"
  | "ruby"
  | "html"
  | "css"
  | "json"
  | "yaml"
  | "xml";

type RecommendationTemplate = Omit<ExtensionRecommendation, "reason"> & {
  server: string;
  trigger?: string[];
};

const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/.next/**",
  "**/.pakalon/**",
  "**/.pakalon-agents/**",
  "**/vendor/**",
];

const PROJECT_PATTERNS = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "pyproject.toml",
  "requirements*.txt",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,cs,cpp,c,h,hpp,php,kt,kts,rb,html,htm,css,scss,less,json,yaml,yml,xml,vue,svelte,astro}",
];

const EXTENSION_TEMPLATES: Record<LanguageKey, RecommendationTemplate[]> = {
  typescript: [
    {
      extensionId: "vscode.typescript-language-features",
      name: "TypeScript and JavaScript Language Features",
      description: "Built-in TS/JS language intelligence, diagnostics, and navigation.",
      language: "typescript",
      confidence: "high",
      server: "typescript-language-server",
      trigger: ["package.json", "tsconfig.json", "jsconfig.json", ".ts", ".tsx", ".js", ".jsx"],
    },
    {
      extensionId: "dbaeumer.vscode-eslint",
      name: "ESLint",
      description: "Real-time lint diagnostics and code actions for JavaScript and TypeScript.",
      language: "typescript",
      confidence: "high",
      server: "eslint-language-server",
      trigger: ["package.json", "eslint.config.js", ".eslintrc", ".ts", ".tsx", ".js", ".jsx"],
    },
  ],
  javascript: [
    {
      extensionId: "vscode.typescript-language-features",
      name: "TypeScript and JavaScript Language Features",
      description: "Built-in JS language intelligence, diagnostics, and navigation.",
      language: "javascript",
      confidence: "high",
      server: "typescript-language-server",
      trigger: ["package.json", "jsconfig.json", ".js", ".jsx", ".mjs", ".cjs"],
    },
    {
      extensionId: "dbaeumer.vscode-eslint",
      name: "ESLint",
      description: "Linting and quick fixes for JavaScript projects.",
      language: "javascript",
      confidence: "high",
      server: "eslint-language-server",
      trigger: ["package.json", "eslint.config.js", ".eslintrc", ".js", ".jsx", ".mjs", ".cjs"],
    },
  ],
  python: [
    {
      extensionId: "ms-python.python",
      name: "Python",
      description: "Python language support with linting, completion, and diagnostics.",
      language: "python",
      confidence: "high",
      server: "pylsp",
      trigger: ["pyproject.toml", "requirements.txt", "Pipfile", ".py"],
    },
  ],
  go: [
    {
      extensionId: "golang.go",
      name: "Go",
      description: "Go language support with gopls integration.",
      language: "go",
      confidence: "high",
      server: "gopls",
      trigger: ["go.mod", ".go"],
    },
  ],
  rust: [
    {
      extensionId: "rust-lang.rust-analyzer",
      name: "rust-analyzer",
      description: "Best-in-class Rust language server with diagnostics and code actions.",
      language: "rust",
      confidence: "high",
      server: "rust-analyzer",
      trigger: ["Cargo.toml", ".rs"],
    },
  ],
  java: [
    {
      extensionId: "redhat.java",
      name: "Extension Pack for Java",
      description: "Java language support and LSP-backed project navigation.",
      language: "java",
      confidence: "high",
      server: "jdtls",
      trigger: ["pom.xml", "build.gradle", "build.gradle.kts", ".java"],
    },
  ],
  csharp: [
    {
      extensionId: "ms-dotnettools.csharp",
      name: "C#",
      description: "C# language support with OmniSharp-style diagnostics and navigation.",
      language: "csharp",
      confidence: "high",
      server: "omnisharp",
      trigger: [".csproj", ".sln", ".cs"],
    },
  ],
  cpp: [
    {
      extensionId: "ms-vscode.cpptools",
      name: "C/C++",
      description: "C/C++ IntelliSense and clangd-compatible diagnostics.",
      language: "cpp",
      confidence: "high",
      server: "clangd",
      trigger: [".cpp", ".cc", ".cxx", ".hpp", ".h"],
    },
  ],
  c: [
    {
      extensionId: "ms-vscode.cpptools",
      name: "C/C++",
      description: "C IntelliSense and clangd-compatible diagnostics.",
      language: "c",
      confidence: "high",
      server: "clangd",
      trigger: [".c", ".h"],
    },
  ],
  php: [
    {
      extensionId: "bmewburn.vscode-intelephense-client",
      name: "Intelephense",
      description: "PHP language server with navigation, completion, and diagnostics.",
      language: "php",
      confidence: "high",
      server: "php-language-server",
      trigger: ["composer.json", ".php"],
    },
  ],
  kotlin: [
    {
      extensionId: "fwcd.kotlin",
      name: "Kotlin Language",
      description: "Kotlin language support and LSP integration for Gradle projects.",
      language: "kotlin",
      confidence: "high",
      server: "kotlin-language-server",
      trigger: ["build.gradle.kts", ".kt", ".kts"],
    },
  ],
  ruby: [
    {
      extensionId: "rebornix.ruby",
      name: "Ruby",
      description: "Ruby language support with Solargraph-compatible intelligence.",
      language: "ruby",
      confidence: "high",
      server: "solargraph",
      trigger: ["Gemfile", ".rb"],
    },
  ],
  html: [
    {
      extensionId: "vscode.html-language-features",
      name: "HTML Language Features",
      description: "Built-in HTML language features and diagnostics.",
      language: "html",
      confidence: "high",
      server: "html-languageserver",
      trigger: [".html", ".htm", ".vue", ".svelte", ".astro"],
    },
  ],
  css: [
    {
      extensionId: "vscode.css-language-features",
      name: "CSS Language Features",
      description: "Built-in CSS/SCSS/Less diagnostics and completion.",
      language: "css",
      confidence: "high",
      server: "css-languageserver",
      trigger: [".css", ".scss", ".less"],
    },
  ],
  json: [
    {
      extensionId: "vscode.json-language-features",
      name: "JSON Language Features",
      description: "Built-in JSON diagnostics and schema-aware validation.",
      language: "json",
      confidence: "high",
      server: "json-languageserver",
      trigger: ["package.json", ".json"],
    },
  ],
  yaml: [
    {
      extensionId: "redhat.vscode-yaml",
      name: "YAML",
      description: "YAML diagnostics, schema validation, and completion.",
      language: "yaml",
      confidence: "high",
      server: "yaml-language-server",
      trigger: [".yml", ".yaml"],
    },
  ],
  xml: [
    {
      extensionId: "redhat.vscode-xml",
      name: "XML",
      description: "XML language support for schema-aware diagnostics.",
      language: "xml",
      confidence: "medium",
      server: "xml-language-server",
      trigger: ["pom.xml", ".xml"],
    },
  ],
};

const FILE_EXT_TO_LANGUAGE: Record<string, LanguageKey> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  php: "php",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
};

const SEVERITY_MAP: Record<number, DiagnosticSuggestion["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "info",
};

function normalizeProjectDir(projectDir: string): string {
  return path.resolve(projectDir || process.cwd());
}

function getDiagnosticFilePath(diagnostic: Diagnostic): string {
  const filePath = (diagnostic as Diagnostic & { filePath?: string }).filePath;
  return filePath && filePath.trim() ? filePath : "<unknown>";
}

function getDiagnosticLine(diagnostic: Diagnostic): number {
  const line = diagnostic.range?.start.line;
  return typeof line === "number" && Number.isFinite(line) ? line : 0;
}

function getDiagnosticColumn(diagnostic: Diagnostic): number {
  const column = diagnostic.range?.start.character;
  return typeof column === "number" && Number.isFinite(column) ? column : 0;
}

function getSeverityLabel(diagnostic: Diagnostic): DiagnosticSuggestion["severity"] {
  return SEVERITY_MAP[diagnostic.severity ?? 3] ?? "info";
}

async function readJsonFile<T = Record<string, unknown>>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function collectProjectFiles(projectDir: string): Promise<string[]> {
  return fg(PROJECT_PATTERNS, {
    cwd: projectDir,
    absolute: true,
    onlyFiles: true,
    dot: true,
    unique: true,
    ignore: IGNORE_GLOBS,
    followSymbolicLinks: false,
    stats: false,
    deep: 8,
    suppressErrors: true,
    limit: 500,
  });
}

async function collectProjectSignals(projectDir: string): Promise<{
  files: string[];
  extensions: Set<string>;
  filenames: Set<string>;
  packageDeps: Set<string>;
  packageDevDeps: Set<string>;
}> {
  const files = await collectProjectFiles(projectDir);
  const extensions = new Set<string>();
  const filenames = new Set<string>();

  for (const file of files) {
    const name = path.basename(file).toLowerCase();
    filenames.add(name);
    const ext = path.extname(name).replace(/^\./, "");
    if (ext) extensions.add(ext);
  }

  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJson = (await fileExists(packageJsonPath)) ? await readJsonFile<Record<string, unknown>>(packageJsonPath) : null;
  const dependencies = new Set<string>();
  const devDependencies = new Set<string>();

  const depGroups = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
  for (const group of depGroups) {
    const value = packageJson?.[group];
    if (value && typeof value === "object") {
      for (const depName of Object.keys(value as Record<string, unknown>)) {
        dependencies.add(depName.toLowerCase());
      }
      if (group === "devDependencies") {
        for (const depName of Object.keys(value as Record<string, unknown>)) {
          devDependencies.add(depName.toLowerCase());
        }
      }
    }
  }

  return { files, extensions, filenames, packageDeps: dependencies, packageDevDeps: devDependencies };
}

function hasAny(set: Set<string>, values: string[]): boolean {
  return values.some((value) => set.has(value.toLowerCase()));
}

function inferLanguagesFromSignals(signals: Awaited<ReturnType<typeof collectProjectSignals>>): Set<LanguageKey> {
  const languages = new Set<LanguageKey>();
  const { extensions, filenames, packageDeps } = signals;

  for (const ext of extensions) {
    const language = FILE_EXT_TO_LANGUAGE[ext];
    if (language) languages.add(language);
  }

  if (hasAny(filenames, ["tsconfig.json", "jsconfig.json"]) || hasAny(packageDeps, ["typescript", "ts-node", "tsx", "vite", "next", "nuxt", "react", "vue", "svelte"])) {
    languages.add("typescript");
    languages.add("javascript");
  }

  if (hasAny(filenames, ["package.json"])) {
    languages.add("typescript");
    languages.add("javascript");
  }

  if (hasAny(filenames, ["pyproject.toml", "requirements.txt", "pipfile"]) || extensions.has("py") || hasAny(packageDeps, ["python"])) {
    languages.add("python");
  }

  if (hasAny(filenames, ["go.mod"]) || extensions.has("go")) languages.add("go");
  if (hasAny(filenames, ["cargo.toml"]) || extensions.has("rs")) languages.add("rust");
  if (hasAny(filenames, ["pom.xml", "build.gradle", "build.gradle.kts"]) || extensions.has("java")) languages.add("java");
  if (hasAny(filenames, [".csproj", ".sln"]) || extensions.has("cs")) languages.add("csharp");
  if (hasAny(filenames, ["composer.json"]) || extensions.has("php")) languages.add("php");
  if (hasAny(filenames, ["gemfile"]) || extensions.has("rb")) languages.add("ruby");
  if (extensions.has("kt") || extensions.has("kts")) languages.add("kotlin");
  if (extensions.has("html") || extensions.has("htm") || extensions.has("vue") || extensions.has("svelte") || extensions.has("astro")) languages.add("html");
  if (extensions.has("css") || extensions.has("scss") || extensions.has("less")) languages.add("css");
  if (extensions.has("json") || hasAny(filenames, ["package.json"])) languages.add("json");
  if (extensions.has("yaml") || extensions.has("yml")) languages.add("yaml");
  if (extensions.has("xml") || hasAny(filenames, ["pom.xml"])) languages.add("xml");

  return languages;
}

function buildReason(language: LanguageKey, signals: Awaited<ReturnType<typeof collectProjectSignals>>): string {
  const { extensions, filenames, packageDeps } = signals;
  const extHits = (EXTENSION_TEMPLATES[language] ?? []).flatMap((template) => template.trigger ?? []).filter((trigger) => trigger.startsWith("." ) ? extensions.has(trigger.slice(1)) : filenames.has(trigger.toLowerCase()));

  if (extHits.length > 0) {
    return `Detected ${extHits[0]} in the project.`;
  }

  if (language === "typescript" || language === "javascript") {
    if (filenames.has("package.json")) return "package.json suggests a JavaScript/TypeScript workspace.";
    if (hasAny(packageDeps, ["typescript", "react", "next", "vite", "vue", "svelte"])) return "Project dependencies indicate a JavaScript/TypeScript stack.";
  }

  return `Detected ${language} project files in the workspace.`;
}

function recommendationConfidence(language: LanguageKey, signals: Awaited<ReturnType<typeof collectProjectSignals>>): ExtensionRecommendation["confidence"] {
  const { extensions, filenames } = signals;
  const templates = EXTENSION_TEMPLATES[language] ?? [];
  const triggerHits = templates.some((template) => (template.trigger ?? []).some((trigger) => trigger.startsWith(".") ? extensions.has(trigger.slice(1)) : filenames.has(trigger.toLowerCase())));
  if (triggerHits) return "high";
  return language === "typescript" || language === "javascript" ? "high" : "medium";
}

function templateMatches(language: LanguageKey, signals: Awaited<ReturnType<typeof collectProjectSignals>>): boolean {
  const templates = EXTENSION_TEMPLATES[language] ?? [];
  const { extensions, filenames } = signals;

  return templates.some((template) => {
    const trigger = template.trigger ?? [];
    return trigger.length === 0 || trigger.some((entry) => {
      if (entry.startsWith(".")) return extensions.has(entry.slice(1));
      return filenames.has(entry.toLowerCase());
    });
  });
}

export async function getRecommendedExtensions(projectDir: string): Promise<ExtensionRecommendation[]> {
  const normalizedDir = normalizeProjectDir(projectDir);
  const signals = await collectProjectSignals(normalizedDir);
  const languages = inferLanguagesFromSignals(signals);

  const recommendations: ExtensionRecommendation[] = [];
  for (const language of languages) {
    if (!templateMatches(language, signals)) continue;

    for (const template of EXTENSION_TEMPLATES[language] ?? []) {
      const matches = (template.trigger ?? []).some((entry) => {
        if (entry.startsWith(".")) return signals.extensions.has(entry.slice(1));
        return signals.filenames.has(entry.toLowerCase());
      });

      if (!matches && language !== "typescript" && language !== "javascript") continue;

      recommendations.push({
        extensionId: template.extensionId,
        name: template.name,
        description: template.description,
        language: template.language,
        confidence: recommendationConfidence(language, signals),
        reason: buildReason(language, signals),
      });
    }
  }

  if (recommendations.length === 0 && (signals.filenames.has("package.json") || signals.extensions.has("ts") || signals.extensions.has("tsx") || signals.extensions.has("js") || signals.extensions.has("jsx"))) {
    const templates = EXTENSION_TEMPLATES.typescript;
    recommendations.push(
      ...templates.map((template) => ({
        extensionId: template.extensionId,
        name: template.name,
        description: template.description,
        language: template.language,
        confidence: "medium" as const,
        reason: "Default JavaScript/TypeScript support is recommended for package-based projects.",
      })),
    );
  }

  const seen = new Set<string>();
  return recommendations.filter((entry) => {
    const key = `${entry.extensionId}:${entry.language}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getLanguageServersForProject(projectDir: string): Promise<string[]> {
  const normalizedDir = normalizeProjectDir(projectDir);
  const signals = await collectProjectSignals(normalizedDir);
  const languages = inferLanguagesFromSignals(signals);

  const servers = new Set<string>();
  for (const language of languages) {
    for (const template of EXTENSION_TEMPLATES[language] ?? []) {
      servers.add(template.server);
    }
  }

  if (signals.filenames.has("package.json") || signals.extensions.has("ts") || signals.extensions.has("tsx") || signals.extensions.has("js") || signals.extensions.has("jsx")) {
    servers.add("typescript-language-server");
  }

  // Keep the LSP manager import exercised so this subsystem stays aligned with the existing LSP layer.
  void getLSPServerManager(normalizedDir);

  return [...servers];
}

export function suggestFix(diagnostic: Diagnostic): string | null {
  const message = diagnostic.message.toLowerCase();
  const source = (diagnostic.source ?? "").toLowerCase();
  const code = String(diagnostic.code ?? "").toLowerCase();

  if (message.includes("unused import") || message.includes("is declared but its value is never read") || message.includes("unused variable")) {
    return "Remove the unused import/variable, or prefix it with `_` if it is intentional.";
  }

  if (message.includes("cannot find module") || message.includes("module not found") || message.includes("cannot resolve")) {
    return "Install the missing dependency or fix the import path.";
  }

  if (message.includes("cannot find name") || message.includes("is not defined") || message.includes("undefined symbol")) {
    return "Declare the symbol or import it from the correct module.";
  }

  if (message.includes("implicit any") || code.includes("ts7006") || code.includes("ts7031")) {
    return "Add an explicit type annotation for the parameter or variable.";
  }

  if (message.includes("not all code paths return a value") || message.includes("missing return")) {
    return "Return a value on every code path, or change the function signature to allow `void`/`undefined`.";
  }

  if (message.includes("unexpected token") || message.includes("parse error") || message.includes("syntax error")) {
    return "Check the surrounding syntax; a missing bracket, quote, or comma is likely.";
  }

  if (message.includes("missing semicolon") || code.includes("semi")) {
    return "Add the missing semicolon.";
  }

  if (message.includes("duplicate identifier") || message.includes("already been declared")) {
    return "Rename one of the declarations or remove the duplicate.";
  }

  if (message.includes("property does not exist") || message.includes("has no exported member")) {
    return "Check the property/member name or update the import to match the exported API.";
  }

  if (source.includes("eslint") || code.startsWith("eslint")) {
    if (message.includes("react-hooks/exhaustive-deps")) return "Add the missing dependency to the hook dependency array, or refactor to avoid the dependency.";
    if (message.includes("no-unused-vars")) return "Remove the unused binding or mark it intentionally unused.";
    if (message.includes("prefer-const")) return "Change the binding to `const` if it is never reassigned.";
  }

  if (message.includes("undefined") && message.includes("property")) {
    return "Guard against `undefined` before accessing the property.";
  }

  if (source.includes("pyright") || source.includes("pylsp") || message.includes("import could not be resolved")) {
    if (message.includes("import could not be resolved") || message.includes("no module named")) {
      return "Install the missing Python package or fix the import path.";
    }
    if (message.includes("expected ") && message.includes("got ")) {
      return "Adjust the value to the expected Python type.";
    }
  }

  if (source.includes("gopls") || message.includes("cannot use") || message.includes("undefined: ")) {
    return "Fix the type mismatch or add the missing import/declaration.";
  }

  if (source.includes("rust-analyzer") || message.includes("unresolved import") || message.includes("cannot find crate")) {
    return "Add the missing crate or correct the import path, then run `cargo check`.";
  }

  if (source.includes("omnisharp") || source.includes("csharp")) {
    if (message.includes("does not exist in the current context")) return "Check the namespace/imports and ensure the symbol is declared.";
  }

  if (message.includes("xml") || message.includes("schema")) {
    return "Validate the XML against the expected schema and fix the malformed tag or attribute.";
  }

  return null;
}

export function getDiagnosticSuggestions(diagnostics: Diagnostic[]): DiagnosticSuggestion[] {
  return diagnostics.map((diagnostic) => {
    const suggestedFix = suggestFix(diagnostic);
    return {
      filePath: getDiagnosticFilePath(diagnostic),
      line: getDiagnosticLine(diagnostic),
      column: getDiagnosticColumn(diagnostic),
      message: diagnostic.message,
      severity: getSeverityLabel(diagnostic),
      suggestedFix: suggestedFix ?? undefined,
      canAutoFix: suggestedFix !== null,
    };
  });
}

export default {
  getRecommendedExtensions,
  getDiagnosticSuggestions,
  getLanguageServersForProject,
  suggestFix,
};
