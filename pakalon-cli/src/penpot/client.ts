/**
 * Penpot integration — pure TypeScript via REST API + Docker lifecycle.
 * Replaces Python bridge /penpot/* endpoints.
 */
import * as fs from "fs";
import * as path from "path";
import { executeBash } from "@/tools/bash.js";
import logger from "@/utils/logger.js";
import { exec as execCb } from "child_process";
import { promisify } from "util";

const execAsync = promisify(execCb);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PenpotProject {
  id: string;
  name: string;
  createdAt: string;
}

export interface PenpotPage {
  id: string;
  name: string;
  projectId: string;
}

export interface PenpotFile {
  id: string;
  name: string;
  projectId: string;
  pages: PenpotPage[];
}

// ---------------------------------------------------------------------------
// Docker Lifecycle
// ---------------------------------------------------------------------------

const PENPOT_DOCKER_COMPOSE = `version: "3.8"
services:
  penpot:
    image: penpotapp/penpot:latest
    ports:
      - "3000:3000"
    environment:
      - PENPOT_DATABASE_URI=postgresql://postgres:postgres@penpot-db:5432/penpot
      - PENPOT_REDIS_URI=redis://penpot-redis:6379/0
      - PENPOT_PUBLIC_URI=http://localhost:3000
      - PENPOT_TELEMETRY_ENABLED=false
    volumes:
      - penpot-data:/opt/penoto/data
    depends_on:
      - penpot-db
      - penpot-redis

  penpot-db:
    image: postgres:15
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=penpot
    volumes:
      - penpot-db-data:/var/lib/postgresql/data

  penpot-redis:
    image: redis:7-alpine
    volumes:
      - penpot-redis-data:/data

volumes:
  penpot-data:
  penpot-db-data:
  penpot-redis-data:
`;

export async function checkPenpotDockerInstalled(): Promise<boolean> {
  try {
    await execAsync("docker --version");
    await execAsync("docker compose version");
    return true;
  } catch {
    return false;
  }
}

export async function createDockerCompose(projectDir: string): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const composePath = path.join(projectDir, "docker-compose.penpot.yml");
    await fs.promises.writeFile(composePath, PENPOT_DOCKER_COMPOSE, "utf-8");
    return { success: true, path: composePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Start Penpot containers via docker-compose.
 */
export async function startPenpot(projectDir: string): Promise<{ success: boolean; error?: string }> {
  try {
    const composeFile = path.join(projectDir, "docker-compose.penpot.yml");
    if (!fs.existsSync(composeFile)) {
      const created = await createDockerCompose(projectDir);
      if (!created.success) {
        return { success: false, error: created.error };
      }
    }

    const result = await executeBash({
      command: `docker compose -f "${composeFile}" up -d`,
      cwd: projectDir,
      timeout: 120000,
    });

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || "Failed to start Penpot" };
    }

    logger.info("[penpot] Penpot containers started");
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Stop Penpot containers.
 */
export async function stopPenpot(projectDir: string): Promise<{ success: boolean; error?: string }> {
  try {
    const composeFile = path.join(projectDir, "docker-compose.penpot.yml");
    const result = await executeBash({
      command: `docker compose -f "${composeFile}" down`,
      cwd: projectDir,
      timeout: 60000,
    });

    return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Check if Penpot is running.
 */
export async function checkPenpotStatus(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:3000/api/health", {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for Penpot to be ready (up to 60 seconds).
 */
export async function waitForPenpotReady(maxWaitMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkPenpotStatus()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

/**
 * Start Penpot with full lifecycle management (Docker + sync.js).
 */
export async function startPenpotWithLifecycle(
  projectDir: string,
  options: { autoOpenBrowser?: boolean; syncJsPath?: string } = {}
): Promise<{ success: boolean; error?: string; url?: string }> {
  const { autoOpenBrowser = true, syncJsPath } = options;

  const dockerInstalled = await checkPenpotDockerInstalled();
  if (!dockerInstalled) {
    return { success: false, error: "Docker is not installed. Please install Docker to use Penpot integration." };
  }

  const composeResult = await startPenpot(projectDir);
  if (!composeResult.success) {
    return { success: false, error: composeResult.error };
  }

  logger.info("[penpot] Waiting for Penpot to be ready...");
  const ready = await waitForPenpotReady();
  if (!ready) {
    return { success: false, error: "Penpot did not start within 60 seconds" };
  }

  logger.info("[penpot] Penpot is ready at http://localhost:3000");

  if (syncJsPath) {
    logger.info(`[penpot] Sync.js can be started with: node "${syncJsPath}"`);
  }

  if (autoOpenBrowser) {
    await openPenpotInBrowser();
  }

  return { success: true, url: "http://localhost:3000" };
}

/**
 * Stop Penpot with full lifecycle management.
 */
export async function stopPenpotWithLifecycle(projectDir: string): Promise<{ success: boolean; error?: string }> {
  return stopPenpot(projectDir);
}

/**
 * Open Penpot in the default browser.
 */
export async function openPenpotInBrowser(): Promise<void> {
  try {
    const platform = process.platform;
    const url = "http://localhost:3000";

    if (platform === "win32") {
      await execAsync(`start ${url}`);
    } else if (platform === "darwin") {
      await execAsync(`open ${url}`);
    } else {
      await execAsync(`xdg-open ${url}`);
    }
    logger.info("[penpot] Opened Penpot in browser");
  } catch (err) {
    logger.warn("[penpot] Could not open browser:", err);
  }
}

/**
 * Get Penpot container status.
 */
export async function getPenpotContainerStatus(): Promise<{
  running: boolean;
  containers: Array<{ name: string; status: string }>;
}> {
  try {
    const { stdout } = await execAsync("docker compose -f docker-compose.penpot.yml ps --format json 2>/dev/null", {
      cwd: process.cwd(),
    });

    const containers = JSON.parse(stdout || "[]").map((c: any) => ({
      name: c.Service || c.Name,
      status: c.State || c.Status,
    }));

    const running = containers.every((c: any) =>
      c.status === "running" || c.status === "Up"
    );

    return { running, containers };
  } catch {
    return { running: false, containers: [] };
  }
}

// ---------------------------------------------------------------------------
// Penpot REST API Client
// ---------------------------------------------------------------------------

const PENPOT_BASE_URL = process.env.PENPOT_BASE_URL ?? "http://localhost:3000";
const PENPOT_API_TOKEN = process.env.PENPOT_API_TOKEN ?? "";

async function penpotApi(method: string, endpoint: string, body?: object): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (PENPOT_API_TOKEN) {
    headers["Authorization"] = `Token ${PENPOT_API_TOKEN}`;
  }

  const response = await fetch(`${PENPOT_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Penpot API ${method} ${endpoint} → HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * List Penpot projects.
 */
export async function listPenpotProjects(): Promise<PenpotProject[]> {
  try {
    const data = await penpotApi("GET", "/api/rpc/command/get-projects");
    return (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
    }));
  } catch (err) {
    logger.error("[penpot] Failed to list projects", { error: String(err) });
    return [];
  }
}

/**
 * Create a Penpot project.
 */
export async function createPenpotProject(name: string): Promise<PenpotProject | null> {
  try {
    const data = await penpotApi("POST", "/api/rpc/command/create-project", { name });
    return {
      id: data.id,
      name: data.name,
      createdAt: data.created_at,
    };
  } catch (err) {
    logger.error("[penpot] Failed to create project", { error: String(err) });
    return null;
  }
}

/**
 * List files in a Penpot project.
 */
export async function listPenpotFiles(projectId: string): Promise<PenpotFile[]> {
  try {
    const data = await penpotApi("GET", `/api/rpc/command/get-project-files?project-id=${projectId}`);
    return (data ?? []).map((f: any) => ({
      id: f.id,
      name: f.name,
      projectId,
      pages: [],
    }));
  } catch {
    return [];
  }
}

/**
 * Get a Penpot file with pages.
 */
export async function getPenpotFile(fileId: string): Promise<PenpotFile | null> {
  try {
    const data = await penpotApi("GET", `/api/rpc/command/get-file?file-id=${fileId}`);
    return {
      id: data.id,
      name: data.name,
      projectId: data.project_id,
      pages: (data.pages ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        projectId: data.project_id,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Export a Penpot page as SVG.
 */
export async function exportPenpotPageSvg(fileId: string, pageId: string): Promise<string | null> {
  try {
    const data = await penpotApi("POST", "/api/rpc/command/get-page-blob", {
      fileId,
      pageId,
      type: "svg",
    });
    return data?.svg ?? null;
  } catch {
    return null;
  }
}

/**
 * Export a Penpot page as JSON (Penpot native format).
 */
export async function exportPenpotPageJson(fileId: string, pageId: string): Promise<string | null> {
  try {
    const data = await penpotApi("POST", "/api/rpc/command/get-page-blob", {
      fileId,
      pageId,
      type: "json",
    });
    return JSON.stringify(data, null, 2);
  } catch {
    return null;
  }
}

/**
 * Export a Penpot page as .penpot file (Penpot bundle format).
 * Returns the raw JSON data that can be saved as a .penpot file.
 */
export async function exportPenpotAsBundle(fileId: string): Promise<{ fileId: string; name: string; data: string } | null> {
  try {
    const fileData = await penpotApi("GET", `/api/rpc/command/get-file?file-id=${fileId}`);
    const bundle = {
      version: "1.0",
      type: "penpot-bundle",
      exportedAt: new Date().toISOString(),
      fileId: fileData.id,
      name: fileData.name,
      data: fileData,
    };
    return {
      fileId: fileData.id,
      name: fileData.name,
      data: JSON.stringify(bundle, null, 2),
    };
  } catch {
    return null;
  }
}

/**
 * Export all pages in a file as individual SVGs.
 * Returns a map of pageId -> svg content.
 */
export async function exportAllPagesAsSvg(fileId: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    const fileData = await penpotApi("GET", `/api/rpc/command/get-file?file-id=${fileId}`);
    const pages = fileData.pages ?? [];
    for (const page of pages) {
      const svg = await exportPenpotPageSvg(fileId, page.id);
      if (svg) {
        result.set(page.id, svg);
      }
    }
  } catch {
    // ignore
  }
  return result;
}

/**
 * Export all pages in a file as individual JSON files.
 * Returns a map of pageId -> json content.
 */
export async function exportAllPagesAsJson(fileId: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    const fileData = await penpotApi("GET", `/api/rpc/command/get-file?file-id=${fileId}`);
    const pages = fileData.pages ?? [];
    for (const page of pages) {
      const json = await exportPenpotPageJson(fileId, page.id);
      if (json) {
        result.set(page.id, json);
      }
    }
  } catch {
    // ignore
  }
  return result;
}

/**
 * Save exported content to file system.
 */
export async function saveExport(
  content: string,
  outputPath: string,
  format: "svg" | "json" | "penpot"
): Promise<{ success: boolean; path: string; error?: string }> {
  try {
    const finalPath = format !== "svg" && !outputPath.endsWith(`.${format}`)
      ? `${outputPath}.${format}`
      : outputPath;

    await fs.promises.writeFile(finalPath, content, "utf-8");
    return { success: true, path: finalPath };
  } catch (err) {
    return { success: false, path: outputPath, error: String(err) };
  }
}

/**
 * Full export workflow: export pages and save to files.
 */
export async function exportPenpotPages(
  fileId: string,
  outputDir: string,
  options: { format?: "svg" | "json" | "penpot"; openInBrowser?: boolean } = {}
): Promise<{ success: boolean; exportedFiles: string[]; errors: string[] }> {
  const { format = "svg", openInBrowser = false } = options;
  const exportedFiles: string[] = [];
  const errors: string[] = [];

  try {
    await fs.promises.mkdir(outputDir, { recursive: true });

    if (format === "penpot") {
      const bundle = await exportPenpotAsBundle(fileId);
      if (bundle) {
        const result = await saveExport(bundle.data, path.join(outputDir, `${bundle.name}.penpot`), "penpot");
        if (result.success) {
          exportedFiles.push(result.path);
        } else {
          errors.push(result.error ?? "Unknown error");
        }
      }
      return { success: errors.length === 0, exportedFiles, errors };
    }

    const exporter = format === "json" ? exportAllPagesAsJson : exportAllPagesAsSvg;
    const pages = await exporter(fileId);

    for (const [pageId, content] of pages.entries()) {
      const fileName = `page-${pageId.slice(0, 8)}.${format}`;
      const filePath = path.join(outputDir, fileName);
      const result = await saveExport(content, filePath, format);
      if (result.success) {
        exportedFiles.push(result.path);
      } else {
        errors.push(result.error ?? `Failed to save ${fileName}`);
      }
    }

    if (openInBrowser && exportedFiles.length > 0) {
      const firstFile = exportedFiles[0];
      logger.info(`[penpot] Exported to ${firstFile} - open in browser to view`);
    }

    return { success: errors.length === 0, exportedFiles, errors };
  } catch (err) {
    return { success: false, exportedFiles, errors: [String(err)] };
  }
}
