/**
 * Notebook Edit Tool for Pakalon CLI
 * 
 * Jupyter notebook (.ipynb) editing support.
 * Features:
 * - Cell-level editing (add, remove, update, move)
 * - Markdown and code cell support
 * - Cell output management
 * - Metadata handling
 */

import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotebookCellOutput {
  output_type: "stream" | "execute_result" | "display_data" | "error";
  name?: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

export interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  source: string | string[];
  metadata: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: NotebookCellOutput[];
}

export interface NotebookMetadata {
  kernelspec?: {
    display_name: string;
    language: string;
    name: string;
  };
  language_info?: {
    name: string;
    version?: string;
    mimetype?: string;
    file_extension?: string;
  };
  [key: string]: unknown;
}

export interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: NotebookMetadata;
  cells: NotebookCell[];
}

export interface NotebookEditResult {
  success: boolean;
  action: string;
  notebookPath: string;
  cellIndex?: number;
  cellCount?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Notebook Operations
// ---------------------------------------------------------------------------

/**
 * Read a notebook from disk
 */
export async function readNotebook(filePath: string): Promise<Notebook> {
  const content = await fs.readFile(filePath, "utf-8");
  const notebook = JSON.parse(content) as Notebook;
  
  // Validate basic structure
  if (!notebook.cells || !Array.isArray(notebook.cells)) {
    throw new Error("Invalid notebook format: missing cells array");
  }
  if (typeof notebook.nbformat !== "number") {
    throw new Error("Invalid notebook format: missing nbformat");
  }

  return notebook;
}

/**
 * Write a notebook to disk
 */
export async function writeNotebook(filePath: string, notebook: Notebook): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Format with 1-space indentation (standard for notebooks)
  const content = JSON.stringify(notebook, null, 1);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Create a new empty notebook
 */
export function createNotebook(
  kernel: { name: string; displayName: string; language: string } = {
    name: "python3",
    displayName: "Python 3",
    language: "python",
  }
): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: kernel.displayName,
        language: kernel.language,
        name: kernel.name,
      },
      language_info: {
        name: kernel.language,
      },
    },
    cells: [],
  };
}

/**
 * Normalize cell source to string
 */
function normalizeSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source;
}

/**
 * Convert source string to array format for storage
 */
function sourceToArray(source: string): string[] {
  return source.split(/(?<=\n)/); // Keep newlines with lines
}

/**
 * Add a cell to the notebook
 */
export function addCell(
  notebook: Notebook,
  cellType: "code" | "markdown" | "raw",
  source: string,
  index?: number
): NotebookCell {
  const cell: NotebookCell = {
    cell_type: cellType,
    source: sourceToArray(source),
    metadata: {},
  };

  if (cellType === "code") {
    cell.execution_count = null;
    cell.outputs = [];
  }

  if (index !== undefined && index >= 0 && index <= notebook.cells.length) {
    notebook.cells.splice(index, 0, cell);
  } else {
    notebook.cells.push(cell);
  }

  return cell;
}

/**
 * Update a cell in the notebook
 */
export function updateCell(
  notebook: Notebook,
  index: number,
  options: {
    source?: string;
    cellType?: "code" | "markdown" | "raw";
    clearOutputs?: boolean;
    metadata?: Record<string, unknown>;
  }
): NotebookCell {
  if (index < 0 || index >= notebook.cells.length) {
    throw new Error(`Invalid cell index: ${index} (notebook has ${notebook.cells.length} cells)`);
  }

  const cell = notebook.cells[index]!;

  if (options.source !== undefined) {
    cell.source = sourceToArray(options.source);
  }

  if (options.cellType !== undefined && options.cellType !== cell.cell_type) {
    cell.cell_type = options.cellType;
    if (options.cellType === "code") {
      cell.execution_count = null;
      cell.outputs = [];
    } else {
      delete cell.execution_count;
      delete cell.outputs;
    }
  }

  if (options.clearOutputs && cell.cell_type === "code") {
    cell.outputs = [];
    cell.execution_count = null;
  }

  if (options.metadata) {
    cell.metadata = { ...cell.metadata, ...options.metadata };
  }

  return cell;
}

/**
 * Remove a cell from the notebook
 */
export function removeCell(notebook: Notebook, index: number): NotebookCell {
  if (index < 0 || index >= notebook.cells.length) {
    throw new Error(`Invalid cell index: ${index}`);
  }

  const [removed] = notebook.cells.splice(index, 1);
  return removed!;
}

/**
 * Move a cell within the notebook
 */
export function moveCell(
  notebook: Notebook,
  fromIndex: number,
  toIndex: number
): void {
  if (fromIndex < 0 || fromIndex >= notebook.cells.length) {
    throw new Error(`Invalid source index: ${fromIndex}`);
  }
  if (toIndex < 0 || toIndex >= notebook.cells.length) {
    throw new Error(`Invalid target index: ${toIndex}`);
  }

  const [cell] = notebook.cells.splice(fromIndex, 1);
  notebook.cells.splice(toIndex, 0, cell!);
}

/**
 * Clear all outputs from the notebook
 */
export function clearAllOutputs(notebook: Notebook): number {
  let cleared = 0;
  for (const cell of notebook.cells) {
    if (cell.cell_type === "code" && cell.outputs) {
      cell.outputs = [];
      cell.execution_count = null;
      cleared++;
    }
  }
  return cleared;
}

/**
 * Get cell preview (truncated source)
 */
export function getCellPreview(cell: NotebookCell, maxLength: number = 100): string {
  const source = normalizeSource(cell.source).trim();
  return source.length > maxLength
    ? source.slice(0, maxLength) + "..."
    : source;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const notebookEditSchema = z.object({
  action: z.enum([
    "create",      // Create new notebook
    "add",         // Add cell
    "update",      // Update cell
    "remove",      // Remove cell
    "move",        // Move cell
    "read",        // Read notebook info
    "clear",       // Clear all outputs
  ]).describe("Action to perform"),
  
  notebookPath: z.string().describe("Path to the notebook file"),
  
  cellIndex: z.number().optional()
    .describe("Cell index (0-based) for update/remove/move operations"),
  
  targetIndex: z.number().optional()
    .describe("Target index for move operation"),
  
  cellType: z.enum(["code", "markdown", "raw"]).optional()
    .default("code")
    .describe("Cell type for add/update operations"),
  
  source: z.string().optional()
    .describe("Cell source content for add/update operations"),
  
  clearOutputs: z.boolean().optional()
    .describe("Clear cell outputs (for update action)"),
  
  kernel: z.object({
    name: z.string(),
    displayName: z.string(),
    language: z.string(),
  }).optional()
    .describe("Kernel spec for create action"),
});

export type NotebookEditInput = z.infer<typeof notebookEditSchema>;

export interface NotebookReadResult extends NotebookEditResult {
  notebook?: {
    path: string;
    cellCount: number;
    nbformat: string;
    kernel?: string;
    cells: Array<{
      index: number;
      type: string;
      preview: string;
      hasOutput: boolean;
    }>;
  };
}

export async function executeNotebookEdit(
  input: NotebookEditInput
): Promise<NotebookEditResult | NotebookReadResult> {
  const { action, notebookPath, cellIndex, targetIndex, cellType, source, clearOutputs, kernel } = input;

  try {
    switch (action) {
      case "create": {
        const newNotebook = createNotebook(kernel);
        await writeNotebook(notebookPath, newNotebook);
        logger.info(`[notebook] Created: ${notebookPath}`);
        return {
          success: true,
          action,
          notebookPath,
          cellCount: 0,
        };
      }

      case "read": {
        const notebook = await readNotebook(notebookPath);
        return {
          success: true,
          action,
          notebookPath,
          cellCount: notebook.cells.length,
          notebook: {
            path: notebookPath,
            cellCount: notebook.cells.length,
            nbformat: `${notebook.nbformat}.${notebook.nbformat_minor}`,
            kernel: notebook.metadata.kernelspec?.display_name,
            cells: notebook.cells.map((cell, i) => ({
              index: i,
              type: cell.cell_type,
              preview: getCellPreview(cell),
              hasOutput: cell.cell_type === "code" && (cell.outputs?.length ?? 0) > 0,
            })),
          },
        };
      }

      case "add": {
        if (!source) {
          return {
            success: false,
            action,
            notebookPath,
            error: "source is required for add action",
          };
        }

        const notebook = await readNotebook(notebookPath);
        addCell(notebook, cellType ?? "code", source, cellIndex);
        await writeNotebook(notebookPath, notebook);

        logger.info(`[notebook] Added ${cellType} cell to: ${notebookPath}`);
        return {
          success: true,
          action,
          notebookPath,
          cellIndex: cellIndex ?? notebook.cells.length - 1,
          cellCount: notebook.cells.length,
        };
      }

      case "update": {
        if (cellIndex === undefined) {
          return {
            success: false,
            action,
            notebookPath,
            error: "cellIndex is required for update action",
          };
        }

        const notebook = await readNotebook(notebookPath);
        updateCell(notebook, cellIndex, {
          source,
          cellType,
          clearOutputs,
        });
        await writeNotebook(notebookPath, notebook);

        logger.info(`[notebook] Updated cell ${cellIndex} in: ${notebookPath}`);
        return {
          success: true,
          action,
          notebookPath,
          cellIndex,
          cellCount: notebook.cells.length,
        };
      }

      case "remove": {
        if (cellIndex === undefined) {
          return {
            success: false,
            action,
            notebookPath,
            error: "cellIndex is required for remove action",
          };
        }

        const notebook = await readNotebook(notebookPath);
        removeCell(notebook, cellIndex);
        await writeNotebook(notebookPath, notebook);

        logger.info(`[notebook] Removed cell ${cellIndex} from: ${notebookPath}`);
        return {
          success: true,
          action,
          notebookPath,
          cellIndex,
          cellCount: notebook.cells.length,
        };
      }

      case "move": {
        if (cellIndex === undefined || targetIndex === undefined) {
          return {
            success: false,
            action,
            notebookPath,
            error: "cellIndex and targetIndex are required for move action",
          };
        }

        const notebook = await readNotebook(notebookPath);
        moveCell(notebook, cellIndex, targetIndex);
        await writeNotebook(notebookPath, notebook);

        logger.info(`[notebook] Moved cell ${cellIndex} to ${targetIndex} in: ${notebookPath}`);
        return {
          success: true,
          action,
          notebookPath,
          cellIndex: targetIndex,
          cellCount: notebook.cells.length,
        };
      }

      case "clear": {
        const notebook = await readNotebook(notebookPath);
        const clearedCount = clearAllOutputs(notebook);
        await writeNotebook(notebookPath, notebook);

        logger.info(`[notebook] Cleared ${clearedCount} cell outputs in: ${notebookPath}`);
        return {
          success: true,
          action,
          notebookPath,
          cellCount: notebook.cells.length,
        };
      }

      default:
        return {
          success: false,
          action,
          notebookPath,
          error: `Unknown action: ${action}`,
        };
    }
  } catch (error) {
    logger.error(`[notebook] Error: ${error}`);
    return {
      success: false,
      action,
      notebookPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const notebookEditToolDefinition = {
  name: "notebook_edit",
  description: "Edit Jupyter notebooks (.ipynb) - add, update, remove, move cells",
  inputSchema: notebookEditSchema,

  async execute(input: NotebookEditInput): Promise<NotebookEditResult | NotebookReadResult> {
    return executeNotebookEdit(input);
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  readNotebook,
  writeNotebook,
  createNotebook,
  addCell,
  updateCell,
  removeCell,
  moveCell,
  clearAllOutputs,
  notebookEditSchema,
  notebookEditToolDefinition,
  executeNotebookEdit,
};
