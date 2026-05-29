import * as fs from 'fs/promises';
import * as path from 'path';
import { chromium } from 'playwright';
import sharp from 'sharp';

export interface ScreenshotCompareResult {
  matched: boolean;
  diffPercentage: number;
  diffPath?: string;
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function captureScreenshot(url: string, outputPath: string): Promise<string> {
  await ensureDir(outputPath);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outputPath, fullPage: true });
    return outputPath;
  } finally {
    await browser.close();
  }
}

async function imageBuffer(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

export async function compareScreenshots(
  baselinePath: string,
  currentPath: string,
  threshold = 0.2,
): Promise<ScreenshotCompareResult> {
  const [baselineBuffer, currentBuffer] = await Promise.all([
    imageBuffer(baselinePath),
    imageBuffer(currentPath),
  ]);

  const baseline = sharp(baselineBuffer);
  const current = sharp(currentBuffer);

  const baselineMeta = await baseline.metadata();
  const currentMeta = await current.metadata();

  const width = Math.max(baselineMeta.width ?? 0, currentMeta.width ?? 0);
  const height = Math.max(baselineMeta.height ?? 0, currentMeta.height ?? 0);

  if (!width || !height) {
    return { matched: false, diffPercentage: 100 };
  }

  const [baselineRaw, currentRaw] = await Promise.all([
    baseline.ensureAlpha().resize(width, height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }),
    current.ensureAlpha().resize(width, height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }),
  ]);

  const diff = Buffer.alloc(width * height * 4);
  let changedPixels = 0;

  for (let i = 0; i < baselineRaw.data.length; i += 4) {
    const r1 = baselineRaw.data[i] ?? 0;
    const g1 = baselineRaw.data[i + 1] ?? 0;
    const b1 = baselineRaw.data[i + 2] ?? 0;
    const a1 = baselineRaw.data[i + 3] ?? 0;
    const r2 = currentRaw.data[i] ?? 0;
    const g2 = currentRaw.data[i + 1] ?? 0;
    const b2 = currentRaw.data[i + 2] ?? 0;
    const a2 = currentRaw.data[i + 3] ?? 0;

    const delta = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) + Math.abs(a1 - a2);
    const changed = delta > 12;

    if (changed) {
      changedPixels += 1;
      diff[i] = 255;
      diff[i + 1] = 64;
      diff[i + 2] = 64;
      diff[i + 3] = 255;
    } else {
      diff[i] = r2;
      diff[i + 1] = g2;
      diff[i + 2] = b2;
      diff[i + 3] = a2;
    }
  }

  const diffPercentage = (changedPixels / (width * height)) * 100;
  const matched = diffPercentage <= threshold;

  let diffPath: string | undefined;
  if (!matched) {
    diffPath = currentPath.replace(/\.(png|jpe?g)$/i, '.diff.png');
    await fs.writeFile(diffPath, await sharp(diff, { raw: { width, height, channels: 4 } }).png().toBuffer());
  }

  return {
    matched,
    diffPercentage,
    diffPath,
  };
}

export async function runTDDTest(
  baselineDir: string,
  targetUrl: string,
): Promise<Array<{ page: string; result: ScreenshotCompareResult }>> {
  const results: Array<{ page: string; result: ScreenshotCompareResult }> = [];
  const pages = await fs.readdir(baselineDir, { withFileTypes: true });

  for (const entry of pages) {
    if (!entry.isFile() || !/\.(png|jpe?g)$/i.test(entry.name)) {
      continue;
    }

    const baselinePath = path.join(baselineDir, entry.name);
    const currentPath = path.join(baselineDir, `${entry.name}.current.png`);
    const pageUrl = new URL(entry.name.replace(/\.(png|jpe?g)$/i, ''), targetUrl).toString();

    await captureScreenshot(pageUrl, currentPath);
    const result = await compareScreenshots(baselinePath, currentPath);
    results.push({ page: entry.name, result });
  }

  return results;
}
