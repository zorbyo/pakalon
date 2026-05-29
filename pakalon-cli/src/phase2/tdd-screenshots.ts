import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export interface ScreenshotConfig {
  wireframesDir: string;
  baselineDir: string;
  diffDir: string;
  threshold: number;
}

export interface ScreenshotResult {
  name: string;
  passed: boolean;
  similarity: number;
  baselinePath: string;
  newPath?: string;
  diffPath?: string;
  errors: string[];
}

export interface ScreenshotViewport {
  name: string;
  width: number;
  height: number;
}

export interface TddScreenshotRunOptions {
  currentDir?: string;
  resultsPath?: string;
  viewports?: ScreenshotViewport[];
  threshold?: number;
}

export interface TddScreenshotRunSummary {
  results: ScreenshotResult[];
  passed: number;
  failed: number;
  resultsPath: string;
}

export interface TddRegenerationPlan {
  failedWireframes: string[];
  reasons: string[];
  suggestedChanges: string[];
  remainingIterations: number;
}

export interface TddLoopConfig extends Omit<ScreenshotConfig, "threshold"> {
  maxIterations?: number;
  threshold?: number;
  viewports?: ScreenshotViewport[];
  autoRegenerate?: boolean;
  currentDir?: string;
  resultsPath?: string;
  summaryPath?: string;
  regenerateWireframes?: (
    plan: TddRegenerationPlan,
    results: ScreenshotResult[],
    iteration: number,
  ) => Promise<void>;
}

export interface TddFullLoopSummary extends TddScreenshotRunSummary {
  generatedAt: string;
  regenerated: number;
  iterations: number;
  threshold: number;
  lastPlan?: TddRegenerationPlan;
  summaryPath?: string;
}

type PlaywrightRuntime = {
  chromium: {
    launch(options?: { headless?: boolean }): Promise<{ close(): Promise<void> }>;
  };
};

const DEFAULT_VIEWPORTS: ScreenshotViewport[] = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 1024 },
];

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0.95;
  return Math.min(1, Math.max(0, value));
}

function getEnvThreshold(): number | undefined {
  const raw = process.env.SCREENSHOT_THRESHOLD;
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeSlug(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("__")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function getWireframeBaseName(resultName: string): string {
  return resultName.split(":")[0] ?? resultName;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function summarizeSimilarity(similarity: number, threshold: number): string {
  const delta = Math.max(0, threshold - similarity);
  if (delta === 0) return "within threshold";
  if (delta < 0.05) return "slightly below threshold";
  if (delta < 0.15) return "moderately below threshold";
  return "well below threshold";
}

function stripSvgWrapper(svg: string): string {
  return svg
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function walkSvgFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".svg") {
        results.push(absolute);
      }
    }
  }

  await visit(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

async function renderSvgToScreenshot(svgPath: string, outputPath: string, viewport: ScreenshotViewport): Promise<void> {
  const svg = stripSvgWrapper(await fs.readFile(svgPath, "utf8"));
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #ffffff;
      }
      body {
        display: flex;
        align-items: stretch;
        justify-content: stretch;
      }
      svg {
        width: 100vw;
        height: 100vh;
        display: block;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    ${svg}
  </body>
</html>`;

  let playwright: PlaywrightRuntime | null = null;
  try {
    const moduleName = "play" + "wright";
    playwright = await import(/* @vite-ignore */ moduleName) as PlaywrightRuntime;
  } catch {
    playwright = null;
  }

  if (!playwright) {
    await sharp(Buffer.from(svg))
      .resize(viewport.width, viewport.height, { fit: "fill" })
      .png()
      .toFile(outputPath);
    return;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  let context: { close(): Promise<void> } | null = null;
  try {
    const browserAny = browser as unknown as {
      newPage?: (options?: { viewport?: { width: number; height: number }; deviceScaleFactor?: number }) => Promise<{
        setContent(html: string, options?: { waitUntil?: "load" }): Promise<void>;
        screenshot(options: { path: string }): Promise<Buffer>;
        close(): Promise<void>;
      }>;
      newContext?: (options?: { viewport?: { width: number; height: number } }) => Promise<{
        newPage(): Promise<{
          setContent(html: string, options?: { waitUntil?: "load" }): Promise<void>;
          screenshot(options: { path: string }): Promise<Buffer>;
          close(): Promise<void>;
        }>;
        close(): Promise<void>;
      }>;
    };
    const page = browserAny.newPage
      ? await browserAny.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 })
      : await (async () => {
          context = await browserAny.newContext?.({ viewport: { width: viewport.width, height: viewport.height } }) ?? null;
          if (!context || !("newPage" in context)) throw new Error("Playwright browser context could not create a page.");
          return await (context as { newPage(): Promise<{
            setContent(html: string, options?: { waitUntil?: "load" }): Promise<void>;
            screenshot(options: { path: string }): Promise<Buffer>;
            close(): Promise<void>;
          }> }).newPage();
        })();
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: outputPath });
    await page.close();
  } finally {
    await (context as { close(): Promise<void> } | null)?.close();
    await browser.close();
  }
}

async function loadRawImage(filePath: string): Promise<{ data: Buffer; width: number; height: number }> {
  const image = sharp(filePath).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function compareRawImages(
  baseline: { data: Buffer; width: number; height: number },
  current: { data: Buffer; width: number; height: number },
): { similarity: number; diff: Buffer } {
  const width = baseline.width;
  const height = baseline.height;
  const totalPixels = Math.max(1, width * height);
  const diff = Buffer.alloc(width * height * 4);

  let differentPixels = 0;
  const baselineData = baseline.data;
  const currentData = current.data;

  for (let i = 0; i < diff.length; i += 4) {
    const dr = Math.abs((baselineData[i] ?? 0) - (currentData[i] ?? 0));
    const dg = Math.abs((baselineData[i + 1] ?? 0) - (currentData[i + 1] ?? 0));
    const db = Math.abs((baselineData[i + 2] ?? 0) - (currentData[i + 2] ?? 0));
    const da = Math.abs((baselineData[i + 3] ?? 0) - (currentData[i + 3] ?? 0));
    const delta = (dr + dg + db + da) / 4;

    if (delta > 12) {
      differentPixels += 1;
      diff[i] = 255;
      diff[i + 1] = 54;
      diff[i + 2] = 54;
      diff[i + 3] = 255;
    } else {
      diff[i] = 255;
      diff[i + 1] = 255;
      diff[i + 2] = 255;
      diff[i + 3] = 0;
    }
  }

  return {
    similarity: Math.max(0, 1 - differentPixels / totalPixels),
    diff,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildTddSummaryMarkdown(summary: TddFullLoopSummary): string {
  const failedResults = summary.results.filter((result) => !result.passed);
  const passedResults = summary.results.filter((result) => result.passed);
  const lines: string[] = [];

  lines.push("# TDD Screenshot Summary");
  lines.push("");
  lines.push(`- Generated at: ${summary.generatedAt}`);
  lines.push(`- Iterations: ${summary.iterations}`);
  lines.push(`- Threshold: ${(summary.threshold * 100).toFixed(1)}%`);
  lines.push(`- Passed: ${summary.passed}`);
  lines.push(`- Failed: ${summary.failed}`);
  lines.push(`- Regenerated: ${summary.regenerated}`);
  lines.push("");

  if (summary.lastPlan) {
    lines.push("## Regeneration Plan");
    lines.push("");
    lines.push(`- Remaining iterations: ${summary.lastPlan.remainingIterations}`);
    lines.push(`- Failed wireframes: ${summary.lastPlan.failedWireframes.join(", ") || "none"}`);
    lines.push("");
    lines.push("### Reasons");
    for (const reason of summary.lastPlan.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
    lines.push("### Suggested Changes");
    for (const change of summary.lastPlan.suggestedChanges) {
      lines.push(`- ${change}`);
    }
    lines.push("");
  }

  lines.push("## Results");
  lines.push("");
  for (const result of summary.results) {
    lines.push(`### ${result.name}`);
    lines.push(`- Status: ${result.passed ? "passed" : "failed"}`);
    lines.push(`- Similarity: ${(result.similarity * 100).toFixed(2)}%`);
    lines.push(`- Baseline: ${result.baselinePath}`);
    if (result.newPath) lines.push(`- Current: ${result.newPath}`);
    if (result.diffPath) lines.push(`- Diff: ${result.diffPath}`);
    if (result.errors.length > 0) {
      lines.push("- Errors:");
      for (const error of result.errors) {
        lines.push(`  - ${error}`);
      }
    }
    lines.push("");
  }

  if (passedResults.length > 0 || failedResults.length > 0) {
    lines.push("## Rollup");
    lines.push("");
    lines.push(`- Passed screenshots: ${passedResults.length}`);
    lines.push(`- Failed screenshots: ${failedResults.length}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function createRegenerationPlan(
  results: ScreenshotResult[],
  config: Pick<TddLoopConfig, "threshold" | "maxIterations" | "viewports" | "autoRegenerate"> & {
    remainingIterations: number;
  },
): TddRegenerationPlan {
  const failedResults = results.filter((result) => !result.passed || result.similarity < clampThreshold(config.threshold ?? 0.95));
  const failedWireframes = uniqueStrings(failedResults.map((result) => getWireframeBaseName(result.name)));
  const reasons = uniqueStrings(
    failedResults.flatMap((result) => {
      const mismatch = summarizeSimilarity(result.similarity, clampThreshold(config.threshold ?? 0.95));
      const detail = result.errors.length > 0 ? result.errors.join("; ") : "Visual mismatch detected";
      return [`${result.name} is ${mismatch} (${(result.similarity * 100).toFixed(2)}% vs ${(clampThreshold(config.threshold ?? 0.95) * 100).toFixed(1)}% threshold): ${detail}`];
    }),
  );

  const suggestedChanges = uniqueStrings(
    failedResults.map((result) => {
      const similarityGap = Math.max(0, clampThreshold(config.threshold ?? 0.95) - result.similarity);
      const severity = similarityGap > 0.15 ? "substantial" : similarityGap > 0.05 ? "moderate" : "minor";
      return `Regenerate ${getWireframeBaseName(result.name)} with ${severity} layout, spacing, and component alignment adjustments for ${result.name}`;
    }),
  );

  return {
    failedWireframes,
    reasons,
    suggestedChanges,
    remainingIterations: Math.max(0, config.remainingIterations),
  };
}

export async function exportTddSummary(results: TddFullLoopSummary, outputPath: string): Promise<void> {
  await ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, buildTddSummaryMarkdown(results), "utf8");
}

async function runTddFullLoopInner(
  config: TddLoopConfig,
  state: {
    iteration: number;
    regenerated: number;
    lastPlan?: TddRegenerationPlan;
  },
): Promise<TddFullLoopSummary> {
  const threshold = clampThreshold(config.threshold ?? 0.95);
  const maxIterations = Math.max(1, Math.floor(config.maxIterations ?? 3));
  const viewports = config.viewports?.length ? config.viewports : DEFAULT_VIEWPORTS;
  const resultsPath = config.resultsPath;
  const comparison = await runTddScreenshotComparison(
    {
      wireframesDir: config.wireframesDir,
      baselineDir: config.baselineDir,
      diffDir: config.diffDir,
      threshold,
    },
    {
      currentDir: config.currentDir,
      resultsPath,
      viewports,
      threshold,
    },
  );

  const summary: TddFullLoopSummary = {
    generatedAt: new Date().toISOString(),
    ...comparison,
    regenerated: state.regenerated,
    iterations: state.iteration,
    threshold,
    lastPlan: state.lastPlan,
    summaryPath: config.summaryPath,
  };

  const failed = comparison.results.filter((result) => result.similarity < threshold);
  if (failed.length === 0) {
    if (config.summaryPath) {
      await exportTddSummary(summary, config.summaryPath);
    }
    return summary;
  }

  if (!config.autoRegenerate || state.iteration >= maxIterations) {
    if (config.summaryPath) {
      await exportTddSummary(summary, config.summaryPath);
    }
    return summary;
  }

  const remainingIterations = maxIterations - state.iteration;
  const plan = createRegenerationPlan(comparison.results, {
    threshold,
    maxIterations,
    viewports,
    autoRegenerate: true,
    remainingIterations,
  });

  console.log(`[TDD] Regenerating wireframes: ${plan.failedWireframes.join(", ") || "none"}`);

  if (config.regenerateWireframes) {
    await config.regenerateWireframes(plan, comparison.results, state.iteration);
  }

  return await runTddFullLoopInner(config, {
    iteration: state.iteration + 1,
    regenerated: state.regenerated + plan.failedWireframes.length,
    lastPlan: plan,
  });
}

export async function runTddFullLoop(config: TddLoopConfig): Promise<TddFullLoopSummary> {
  return await runTddFullLoopInner(config, {
    iteration: 1,
    regenerated: 0,
  });
}

export async function runTddScreenshotComparison(
  config: ScreenshotConfig,
  options: TddScreenshotRunOptions = {},
): Promise<TddScreenshotRunSummary> {
  const threshold = clampThreshold(options.threshold ?? config.threshold ?? getEnvThreshold() ?? 0.95);
  const currentDir = options.currentDir ?? path.join(path.dirname(config.baselineDir), "current");
  const resultsPath = options.resultsPath ?? path.join(path.dirname(config.baselineDir), "results.json");
  const viewports = options.viewports?.length ? options.viewports : DEFAULT_VIEWPORTS;

  await Promise.all([
    ensureDir(config.wireframesDir),
    ensureDir(config.baselineDir),
    ensureDir(config.diffDir),
    ensureDir(currentDir),
  ]);

  const svgFiles = await walkSvgFiles(config.wireframesDir);
  const results: ScreenshotResult[] = [];

  for (const svgPath of svgFiles) {
    const svgName = path.basename(svgPath, path.extname(svgPath));
    const slug = safeSlug(path.relative(config.wireframesDir, svgPath) || svgName);

    for (const viewport of viewports) {
      const name = `${svgName}:${viewport.name}`;
      const currentPath = path.join(currentDir, `${slug}__${viewport.name}.png`);
      const baselinePath = path.join(config.baselineDir, `${slug}__${viewport.name}.png`);
      const diffPath = path.join(config.diffDir, `${slug}__${viewport.name}.png`);
      const errors: string[] = [];

      try {
        await renderSvgToScreenshot(svgPath, currentPath, viewport);
      } catch (error) {
        results.push({
          name,
          passed: false,
          similarity: 0,
          baselinePath,
          newPath: currentPath,
          diffPath,
          errors: [`Screenshot capture failed: ${String(error)}`],
        });
        continue;
      }

      try {
        const baselineExists = await fs
          .access(baselinePath)
          .then(() => true)
          .catch(() => false);

        if (!baselineExists) {
          await fs.copyFile(currentPath, baselinePath);
          results.push({
            name,
            passed: true,
            similarity: 1,
            baselinePath,
            newPath: currentPath,
            diffPath,
            errors,
          });
          continue;
        }

        const baseline = await loadRawImage(baselinePath);
        const current = await loadRawImage(currentPath);

        let normalizedCurrent = current;
        if (baseline.width !== current.width || baseline.height !== current.height) {
          const resized = await sharp(currentPath)
            .resize(baseline.width, baseline.height, { fit: "fill" })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          normalizedCurrent = {
            data: resized.data,
            width: resized.info.width,
            height: resized.info.height,
          };
        }

        const comparison = compareRawImages(baseline, normalizedCurrent);
        await sharp(comparison.diff, {
          raw: { width: baseline.width, height: baseline.height, channels: 4 },
        })
          .png()
          .toFile(diffPath);

        results.push({
          name,
          passed: comparison.similarity >= threshold,
          similarity: comparison.similarity,
          baselinePath,
          newPath: currentPath,
          diffPath,
          errors,
        });
      } catch (error) {
        results.push({
          name,
          passed: false,
          similarity: 0,
          baselinePath,
          newPath: currentPath,
          diffPath,
          errors: [...errors, `Comparison failed: ${String(error)}`],
        });
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    config: {
      wireframesDir: config.wireframesDir,
      baselineDir: config.baselineDir,
      diffDir: config.diffDir,
      threshold,
      currentDir,
      viewports,
    },
    results,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
  };

  await writeJson(resultsPath, summary);

  console.log(`[TDD] Screenshot threshold: ${(threshold * 100).toFixed(1)}%`);

  return {
    results,
    passed: summary.passed,
    failed: summary.failed,
    resultsPath,
  };
}

export function getDefaultTddScreenshotPaths(projectDir: string): {
  wireframesDir: string;
  baselineDir: string;
  diffDir: string;
  currentDir: string;
  resultsPath: string;
} {
  const base = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2", "tdd-screenshots");
  return {
    wireframesDir: path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2"),
    baselineDir: path.join(base, "baseline"),
    diffDir: path.join(base, "diff"),
    currentDir: path.join(base, "current"),
    resultsPath: path.join(base, "results.json"),
  };
}
