import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

export interface DesignVerificationOptions {
  targetUrl: string;
  referencePath?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  comparisonMode?: 'layout' | 'pixel' | 'structural';
  outputDir?: string;
}

export interface DesignVerificationResult {
  success: boolean;
  matchPercentage: number;
  differences: Array<{ x: number; y: number; severity: 'minor' | 'major' | 'critical' }>;
  screenshotPath: string;
  diffImagePath?: string;
  summary: string;
  duration: number;
}

type CompareMode = 'layout' | 'pixel';

type RawImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
};

const DEFAULT_VIEWPORT = { width: 1440, height: 1024 };
const DEFAULT_THRESHOLD = 85;

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function resolveOutputDir(outputDir?: string): string {
  return path.resolve(outputDir ?? path.join(process.cwd(), ".pakalon", "design-verification"));
}

function severityFor(delta: number): 'minor' | 'major' | 'critical' {
  if (delta >= 0.66) return 'critical';
  if (delta >= 0.33) return 'major';
  return 'minor';
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

async function loadRawImage(inputPath: string, targetWidth?: number, targetHeight?: number): Promise<RawImage> {
  const image = sharp(inputPath, { failOn: 'none' });
  const metadata = await image.metadata();
  const width = targetWidth ?? metadata.width;
  const height = targetHeight ?? metadata.height;

  if (!width || !height) {
    throw new Error(`Unable to resolve image dimensions for ${inputPath}`);
  }

  const { data, info } = await image
    .resize(width, height, { fit: 'fill', withoutEnlargement: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: Buffer.from(data), width: info.width, height: info.height, channels: info.channels };
}

function blockSizeFor(mode: CompareMode): number {
  return mode === 'pixel' ? 1 : 16;
}

function compareImages(reference: RawImage, actual: RawImage, mode: CompareMode): {
  match: number;
  diffData: Buffer;
  differences: Array<{ x: number; y: number; severity: 'minor' | 'major' | 'critical' }>;
} {
  const width = actual.width;
  const height = actual.height;
  const diffData = Buffer.alloc(width * height * 4, 255);
  const blockSize = blockSizeFor(mode);
  const differences: Array<{ x: number; y: number; severity: 'minor' | 'major' | 'critical' }> = [];

  let totalDelta = 0;
  let sampledUnits = 0;

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      const blockWidth = Math.min(blockSize, width - bx);
      const blockHeight = Math.min(blockSize, height - by);

      let refSum = 0;
      let actSum = 0;
      let count = 0;

      for (let y = 0; y < blockHeight; y += 1) {
        for (let x = 0; x < blockWidth; x += 1) {
          const offset = ((by + y) * width + (bx + x)) * 4;
          const refR = reference.data[offset];
          const refG = reference.data[offset + 1];
          const refB = reference.data[offset + 2];
          const refA = reference.data[offset + 3];
          const actR = actual.data[offset];
          const actG = actual.data[offset + 1];
          const actB = actual.data[offset + 2];
          const actA = actual.data[offset + 3];

          const refLuma = (0.2126 * refR) + (0.7152 * refG) + (0.0722 * refB) + (refA / 255) * 8;
          const actLuma = (0.2126 * actR) + (0.7152 * actG) + (0.0722 * actB) + (actA / 255) * 8;
          refSum += refLuma;
          actSum += actLuma;
          count += 1;

          const delta = (Math.abs(refR - actR) + Math.abs(refG - actG) + Math.abs(refB - actB) + Math.abs(refA - actA)) / (255 * 4);

          if (blockSize === 1) {
            const intensity = Math.min(1, delta * 1.5);
            diffData[offset] = clampByte(actR * (1 - intensity) + 255 * intensity);
            diffData[offset + 1] = clampByte(actG * (1 - intensity));
            diffData[offset + 2] = clampByte(actB * (1 - intensity));
            diffData[offset + 3] = 255;
            totalDelta += delta;
            sampledUnits += 1;
          }
        }
      }

      const blockDelta = Math.min(1, Math.abs(refSum - actSum) / Math.max(1, count * 255));
      totalDelta += blockDelta;
      sampledUnits += 1;

      if (blockSize > 1) {
        const intensity = Math.min(1, blockDelta * 1.8);
        for (let y = 0; y < blockHeight; y += 1) {
          for (let x = 0; x < blockWidth; x += 1) {
            const offset = ((by + y) * width + (bx + x)) * 4;
            diffData[offset] = clampByte(actual.data[offset] * (1 - intensity) + 255 * intensity);
            diffData[offset + 1] = clampByte(actual.data[offset + 1] * (1 - intensity));
            diffData[offset + 2] = clampByte(actual.data[offset + 2] * (1 - intensity));
            diffData[offset + 3] = 255;
          }
        }
      }

      if (blockDelta >= 0.08) {
        differences.push({
          x: Math.floor(bx + blockWidth / 2),
          y: Math.floor(by + blockHeight / 2),
          severity: severityFor(blockDelta),
        });
      }
    }
  }

  return {
    match: Math.max(0, 100 - (totalDelta / Math.max(1, sampledUnits)) * 100),
    diffData,
    differences,
  };
}

async function writeDiffImage(diffData: Buffer, width: number, height: number, outputPath: string): Promise<string> {
  await ensureDirectory(path.dirname(outputPath));
  await sharp(diffData, { raw: { width, height, channels: 4 } }).png().toFile(outputPath);
  return outputPath;
}

export async function captureScreenshot(url: string, outputPath: string, viewport?: { width: number; height: number }): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      viewport: viewport ?? DEFAULT_VIEWPORT,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!response) {
        throw new Error(`No response received while loading ${url}`);
      }

      if (!response.ok()) {
        throw new Error(`Navigation failed with status ${response.status()} for ${url}`);
      }

      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      await page.screenshot({ path: outputPath, fullPage: true, animations: 'disabled' });
      return outputPath;
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function compareScreenshots(reference: string, actual: string, outputPath: string, mode: CompareMode = 'pixel'): Promise<{ match: number; diffPath: string }> {
  const referenceExists = await fs.access(reference).then(() => true).catch(() => false);
  const actualExists = await fs.access(actual).then(() => true).catch(() => false);

  if (!referenceExists) {
    throw new Error(`Reference image not found: ${reference}`);
  }

  if (!actualExists) {
    throw new Error(`Actual screenshot not found: ${actual}`);
  }

  const actualImage = await loadRawImage(actual);
  const referenceImage = await loadRawImage(reference, actualImage.width, actualImage.height);
  const compared = compareImages(referenceImage, actualImage, mode);
  await writeDiffImage(compared.diffData, actualImage.width, actualImage.height, outputPath);

  return { match: compared.match, diffPath: outputPath };
}

export async function verifyDesign(options: DesignVerificationOptions): Promise<DesignVerificationResult> {
  const startedAt = Date.now();
  const outputDir = resolveOutputDir(options.outputDir);
  await ensureDirectory(outputDir);

  const screenshotPath = path.join(outputDir, `design-${startedAt}.png`);
  const diffImagePath = path.join(outputDir, `design-${startedAt}.diff.png`);
  const viewport = {
    width: options.viewportWidth ?? DEFAULT_VIEWPORT.width,
    height: options.viewportHeight ?? DEFAULT_VIEWPORT.height,
  };
  const mode: CompareMode = options.comparisonMode === 'pixel' ? 'pixel' : 'layout';

  try {
    await captureScreenshot(options.targetUrl, screenshotPath, viewport);

    const pageSummary = `Captured screenshot for ${options.targetUrl} at ${viewport.width}x${viewport.height}.`;

    if (!options.referencePath) {
      return {
        success: true,
        matchPercentage: 100,
        differences: [],
        screenshotPath,
        summary: `${pageSummary} No reference wireframe supplied, so comparison was skipped.`,
        duration: Date.now() - startedAt,
      };
    }

    try {
      const comparison = await compareScreenshots(options.referencePath, screenshotPath, diffImagePath, mode);
      const matchPercentage = Number(comparison.match.toFixed(2));
      const success = matchPercentage >= DEFAULT_THRESHOLD;

      return {
        success,
        matchPercentage,
        differences: comparison.match >= 100 ? [] : (await summarizeDifferences(options.referencePath, screenshotPath, mode)),
        screenshotPath,
        diffImagePath: comparison.diffPath,
        summary: success
          ? `Design matches reference closely (${matchPercentage.toFixed(2)}%).`
          : `Design drift detected (${matchPercentage.toFixed(2)}%). Review the diff image for layout, spacing, and palette changes.`,
        duration: Date.now() - startedAt,
      };
    } catch (comparisonError) {
      const message = comparisonError instanceof Error ? comparisonError.message : String(comparisonError);
      return {
        success: false,
        matchPercentage: 0,
        differences: [],
        screenshotPath,
        summary: `Screenshot captured, but comparison failed: ${message}`,
        duration: Date.now() - startedAt,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      matchPercentage: 0,
      differences: [],
      screenshotPath,
      summary: `Design verification failed: ${message}`,
      duration: Date.now() - startedAt,
    };
  }
}

async function summarizeDifferences(referencePath: string, actualPath: string, mode: CompareMode): Promise<Array<{ x: number; y: number; severity: 'minor' | 'major' | 'critical' }>> {
  try {
    const actualImage = await loadRawImage(actualPath);
    const referenceImage = await loadRawImage(referencePath, actualImage.width, actualImage.height);
    return compareImages(referenceImage, actualImage, mode).differences.slice(0, 50);
  } catch {
    return [];
  }
}
