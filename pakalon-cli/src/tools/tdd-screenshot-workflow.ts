import { exec as execCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";
import { chromium } from "playwright";

import { compareScreenshots } from "./design-verifier.js";
import { extractWireframeElements } from "./wireframe-element-extractor.js";

const exec = promisify(execCallback);

export interface TddScreenshotOptions {
  wireframePath: string;
  targetUrl: string;
  viewport?: { width: number; height: number };
  outputDir?: string;
  threshold?: number;
  extractElements?: boolean;
  generateReport?: boolean;
  appBuildCommand?: string;
}

export interface TddTestResult {
  testName: string;
  passed: boolean;
  matchPercentage: number;
  wireframeScreenshot: string;
  actualScreenshot: string;
  diffImage: string;
  differences: Array<{ x: number; y: number; severity: string }>;
  duration: number;
}

export interface TddScreenshotReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  summary: string;
  results: TddTestResult[];
  outputDir: string;
}

type ImageSize = { width: number; height: number };

const DEFAULT_VIEWPORT = { width: 1440, height: 1024 };
const DEFAULT_THRESHOLD = 85;
const DEFAULT_BASE_OUTPUT_DIR = path.join(process.cwd(), ".pakalon", "tdd-screenshots");

function safeTimestamp(value = new Date()): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "wireframe";
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readImageSize(filePath: string): Promise<ImageSize> {
  const meta = await sharp(filePath, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) {
    return { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height };
  }
  return { width: meta.width, height: meta.height };
}

async function renderWireframeScreenshot(sourcePath: string, outputPath: string, size: ImageSize): Promise<string> {
  await ensureDir(path.dirname(outputPath));
  await sharp(sourcePath, { failOn: "none" })
    .resize(size.width, size.height, { fit: "fill", withoutEnlargement: false })
    .png()
    .toFile(outputPath);
  return outputPath;
}

async function captureActualScreenshot(targetUrl: string, outputPath: string, viewport: ImageSize): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();

    try {
      const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (!response) {
        throw new Error(`No response received while loading ${targetUrl}`);
      }
      if (!response.ok()) {
        throw new Error(`Navigation failed with status ${response.status()} for ${targetUrl}`);
      }

      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      await page.screenshot({ path: outputPath, fullPage: true, animations: "disabled" });
      return outputPath;
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function scanDiffHotspots(diffPath: string): Promise<Array<{ x: number; y: number; severity: string }>> {
  const image = sharp(diffPath, { failOn: "none" });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) return [];

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const blockSize = Math.max(8, Math.min(32, Math.round(Math.min(width, height) / 36)));
  const hotspots: Array<{ x: number; y: number; severity: string }> = [];

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      const blockWidth = Math.min(blockSize, width - bx);
      const blockHeight = Math.min(blockSize, height - by);
      let totalDelta = 0;
      let totalPixels = 0;

      for (let y = 0; y < blockHeight; y += 1) {
        for (let x = 0; x < blockWidth; x += 1) {
          const offset = ((by + y) * width + (bx + x)) * 4;
          const r = data[offset] ?? 255;
          const g = data[offset + 1] ?? 255;
          const b = data[offset + 2] ?? 255;
          const a = data[offset + 3] ?? 255;
          const delta = ((255 - r) + (255 - g) + (255 - b) + (255 - a)) / (255 * 4);
          totalDelta += delta;
          totalPixels += 1;
        }
      }

      const averageDelta = totalDelta / Math.max(1, totalPixels);
      if (averageDelta >= 0.08) {
        hotspots.push({
          x: Math.floor(bx + blockWidth / 2),
          y: Math.floor(by + blockHeight / 2),
          severity: averageDelta >= 0.33 ? "critical" : averageDelta >= 0.18 ? "major" : "minor",
        });
      }
    }
  }

  return hotspots.slice(0, 250);
}

async function compareRasterizedImages(referencePath: string, actualPath: string, diffPath: string): Promise<{ match: number; diffPath: string; differences: Array<{ x: number; y: number; severity: string }> }> {
  const comparison = await compareScreenshots(referencePath, actualPath, diffPath, "pixel");
  const differences = await scanDiffHotspots(diffPath).catch(() => []);
  return { match: comparison.match, diffPath: comparison.diffPath, differences };
}

async function compareElementCrops(
  wireframePng: string,
  actualScreenshot: string,
  outputDir: string,
  elements: Array<{ id: string; name: string; x: number; y: number; width: number; height: number }>,
): Promise<TddTestResult[]> {
  const results: TddTestResult[] = [];
  const actualSize = await readImageSize(actualScreenshot);
  const wireframe = sharp(wireframePng, { failOn: "none" });
  const actual = sharp(actualScreenshot, { failOn: "none" });
  const elementBaseDir = path.join(outputDir, "elements");
  await ensureDir(elementBaseDir);

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const testSlug = slugify(`${index + 1}-${element.name || element.id}`);
    const testDir = path.join(elementBaseDir, testSlug);
    await ensureDir(testDir);

    const left = Math.max(0, Math.floor(element.x));
    const top = Math.max(0, Math.floor(element.y));
    const maxWidth = actualSize.width - left;
    const maxHeight = actualSize.height - top;
    if (maxWidth <= 0 || maxHeight <= 0) continue;

    const width = Math.max(1, Math.min(Math.floor(element.width), maxWidth));
    const height = Math.max(1, Math.min(Math.floor(element.height), maxHeight));

    if (width <= 0 || height <= 0) continue;

    const wireframeCrop = path.join(testDir, "wireframe.png");
    const actualCrop = path.join(testDir, "actual.png");
    const diffPath = path.join(testDir, "diff.png");

    await wireframe.clone().extract({ left, top, width, height }).png().toFile(wireframeCrop);
    await actual.clone().extract({ left, top, width, height }).png().toFile(actualCrop);

    const startedAt = Date.now();
    const comparison = await compareRasterizedImages(wireframeCrop, actualCrop, diffPath);
    results.push({
      testName: `element:${element.name || element.id}`,
      passed: comparison.match >= DEFAULT_THRESHOLD,
      matchPercentage: Number(comparison.match.toFixed(2)),
      wireframeScreenshot: wireframeCrop,
      actualScreenshot: actualCrop,
      diffImage: comparison.diffPath,
      differences: comparison.differences,
      duration: Date.now() - startedAt,
    });
  }

  return results;
}

function relativeToOutput(outputDir: string, filePath: string): string {
  return path.relative(outputDir, filePath).split(path.sep).join("/");
}

export async function compareWireframeToActual(
  wireframePath: string,
  actualScreenshot: string,
  outputDir: string,
): Promise<{ match: number; diffPath: string; differences: any[] }> {
  await ensureDir(outputDir);
  const diffPath = path.join(outputDir, `${path.basename(wireframePath, path.extname(wireframePath))}-diff.png`);
  const comparison = await compareRasterizedImages(wireframePath, actualScreenshot, diffPath);
  return { match: comparison.match, diffPath: comparison.diffPath, differences: comparison.differences };
}

export async function runTddScreenshotTest(options: TddScreenshotOptions): Promise<TddScreenshotReport> {
  const timestamp = safeTimestamp();
  const baseOutputDir = path.resolve(options.outputDir ?? DEFAULT_BASE_OUTPUT_DIR);
  const outputDir = path.join(baseOutputDir, timestamp);
  await ensureDir(outputDir);

  if (!options.wireframePath?.trim()) {
    throw new Error("wireframePath is required for the TDD screenshot workflow");
  }

  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const generateReport = options.generateReport ?? true;
  const startedAt = Date.now();

  try {
    if (options.appBuildCommand?.trim()) {
      const buildStarted = Date.now();
      try {
        const { stdout, stderr } = await exec(options.appBuildCommand, { cwd: process.cwd(), windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
        await fs.writeFile(path.join(outputDir, "build.log"), [stdout, stderr].filter(Boolean).join("\n"), "utf8");
        void buildStarted;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await fs.writeFile(path.join(outputDir, "build.log"), `${message}\n`, "utf8");
        const failure: TddTestResult = {
          testName: "build",
          passed: false,
          matchPercentage: 0,
          wireframeScreenshot: "",
          actualScreenshot: "",
          diffImage: "",
          differences: [],
          duration: Date.now() - startedAt,
        };
        const report: TddScreenshotReport = {
          timestamp,
          totalTests: 1,
          passed: 0,
          failed: 1,
          summary: `Build failed: ${message}`,
          results: [failure],
          outputDir,
        };
        if (generateReport) {
          await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
          await fs.writeFile(path.join(outputDir, "report.html"), generateTddHtmlReport(report), "utf8");
        }
        return report;
      }
    }

    const actualScreenshot = path.join(outputDir, "actual.png");
    await captureActualScreenshot(options.targetUrl, actualScreenshot, viewport);

    const wireframeRaster = path.join(outputDir, "wireframe.png");
    await renderWireframeScreenshot(options.wireframePath, wireframeRaster, viewport);

    const comparison = await compareWireframeToActual(wireframeRaster, actualScreenshot, outputDir);
    const overall: TddTestResult = {
      testName: "wireframe-vs-actual",
      passed: comparison.match >= threshold,
      matchPercentage: Number(comparison.match.toFixed(2)),
      wireframeScreenshot: wireframeRaster,
      actualScreenshot,
      diffImage: comparison.diffPath,
      differences: comparison.differences,
      duration: Date.now() - startedAt,
    };

    const results: TddTestResult[] = [overall];

    if (options.extractElements && options.wireframePath.toLowerCase().endsWith(".svg")) {
      const extraction = await extractWireframeElements({ svgPath: options.wireframePath, outputDir: path.join(outputDir, "elements-source"), classifyElements: true, groupContainers: true });
      const elementResults = await compareElementCrops(
        wireframeRaster,
        actualScreenshot,
        outputDir,
        extraction.elements.map((element) => ({ id: element.id, name: element.name, x: element.x, y: element.y, width: element.width, height: element.height })),
      );
      results.push(...elementResults);
      await fs.writeFile(path.join(outputDir, "elements.json"), `${JSON.stringify({ success: extraction.success, elementCount: extraction.elementCount, typesFound: extraction.typesFound, warnings: extraction.warnings, results: elementResults }, null, 2)}\n`, "utf8");
    }

    const passed = results.filter((result) => result.passed).length;
    const failed = results.length - passed;
    const report: TddScreenshotReport = {
      timestamp,
      totalTests: results.length,
      passed,
      failed,
      summary: `${passed}/${results.length} passed | ${failed} failed | threshold ${threshold}%`,
      results,
      outputDir,
    };

    await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (generateReport) {
      await fs.writeFile(path.join(outputDir, "report.html"), generateTddHtmlReport(report), "utf8");
    }

    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure: TddTestResult = {
      testName: "tdd-screenshot-workflow",
      passed: false,
      matchPercentage: 0,
      wireframeScreenshot: "",
      actualScreenshot: "",
      diffImage: "",
      differences: [],
      duration: Date.now() - startedAt,
    };
    const report: TddScreenshotReport = {
      timestamp,
      totalTests: 1,
      passed: 0,
      failed: 1,
      summary: `TDD screenshot workflow failed: ${message}`,
      results: [failure],
      outputDir,
    };
    await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (generateReport) {
      await fs.writeFile(path.join(outputDir, "report.html"), generateTddHtmlReport(report), "utf8");
    }
    return report;
  }
}

export async function buildAndTestApp(
  buildCmd: string,
  testUrl: string,
  options: Partial<TddScreenshotOptions>,
): Promise<TddScreenshotReport> {
  if (!options.wireframePath?.trim()) {
    throw new Error("wireframePath is required for buildAndTestApp");
  }

  return runTddScreenshotTest({
    ...options,
    targetUrl: testUrl,
    appBuildCommand: buildCmd,
  });
}

function imageTag(outputDir: string, filePath: string, alt: string): string {
  if (!filePath) return `<div class="missing">${alt} unavailable</div>`;
  return `<img src="${relativeToOutput(outputDir, filePath)}" alt="${alt}" loading="lazy" />`;
}

export function generateTddHtmlReport(report: TddScreenshotReport): string {
  const rows = report.results.map((result) => {
    const overlay = result.diffImage
      ? `<div class="overlay-stack"><img src="${relativeToOutput(report.outputDir, result.actualScreenshot)}" alt="actual" /><img class="overlay" src="${relativeToOutput(report.outputDir, result.diffImage)}" alt="diff overlay" /></div>`
      : `<div class="missing">No diff image</div>`;

    return `
      <section class="card ${result.passed ? "pass" : "fail"}">
        <div class="row-head">
          <h2>${result.testName}</h2>
          <span class="badge">${result.passed ? "PASS" : "FAIL"}</span>
        </div>
        <p>${result.matchPercentage.toFixed(2)}% match · ${result.differences.length} differences</p>
        <div class="compare-grid">
          <div><h3>Wireframe</h3>${imageTag(report.outputDir, result.wireframeScreenshot, "wireframe")}</div>
          <div><h3>Actual</h3>${imageTag(report.outputDir, result.actualScreenshot, "actual")}</div>
          <div><h3>Diff Overlay</h3>${overlay}</div>
        </div>
      </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TDD Screenshot Report</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: Inter, system-ui, sans-serif; margin: 0; padding: 24px; background: #0b1020; color: #e5e7eb; }
    .wrap { max-width: 1400px; margin: 0 auto; }
    .hero, .card { background: #111827; border: 1px solid #243044; border-radius: 16px; padding: 20px; margin-bottom: 18px; }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
    .stat { padding: 10px 14px; border-radius: 12px; background: #0f172a; border: 1px solid #243044; }
    .compare-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
    img { width: 100%; height: auto; display: block; border-radius: 12px; background: #020617; }
    .overlay-stack { position: relative; }
    .overlay-stack .overlay { position: absolute; inset: 0; opacity: 0.7; mix-blend-mode: screen; }
    .badge { padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .pass .badge { background: #064e3b; color: #a7f3d0; }
    .fail .badge { background: #7f1d1d; color: #fecaca; }
    .row-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .missing { padding: 24px; border: 1px dashed #334155; border-radius: 12px; color: #94a3b8; }
    h1, h2, h3, p { margin: 0; }
    h3 { font-size: 14px; color: #94a3b8; margin-bottom: 10px; }
    .summary { font-size: 16px; color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>TDD Screenshot Report</h1>
      <p class="summary">${report.summary}</p>
      <div class="stats">
        <div class="stat">Total: ${report.totalTests}</div>
        <div class="stat">Passed: ${report.passed}</div>
        <div class="stat">Failed: ${report.failed}</div>
        <div class="stat">Output: ${report.outputDir}</div>
      </div>
    </section>
    ${rows}
  </div>
</body>
</html>`;
}

export default {
  runTddScreenshotTest,
  compareWireframeToActual,
  buildAndTestApp,
  generateTddHtmlReport,
};
