import z from "zod"
import { Tool } from "./tool"
import path from "path"
import fs from "fs/promises"
import DESCRIPTION from "./notebook-edit.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"

export const log = Log.create({ service: "notebook-edit-tool" })

// Jupyter notebook cell interface
interface NotebookCell {
  cell_type: "code" | "markdown" | "raw"
  id?: string
  source: string | string[]
  metadata: Record<string, unknown>
  execution_count?: number | null
  outputs?: unknown[]
}

// Jupyter notebook interface
interface NotebookContent {
  nbformat: number
  nbformat_minor: number
  metadata: {
    kernelspec?: {
      name: string
      display_name: string
      language?: string
    }
    language_info?: {
      name: string
      version?: string
    }
  }
  cells: NotebookCell[]
}

/**
 * Parse cell ID - supports both actual IDs and cell-N format
 */
function parseCellId(cellId: string): number | undefined {
  const match = cellId.match(/^cell-(\d+)$/)
  if (match) {
    return parseInt(match[1], 10)
  }
  return undefined
}

/**
 * Generate a random cell ID
 */
function generateCellId(): string {
  return Math.random().toString(36).substring(2, 15)
}

/**
 * Normalize source to string array
 */
function normalizeSource(source: string | string[]): string[] {
  if (Array.isArray(source)) {
    return source
  }
  return source.split("\n").map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line))
}

export const NotebookEditTool = Tool.define("notebook_edit", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      notebook_path: z
        .string()
        .describe(
          "The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)",
        ),
      cell_id: z
        .string()
        .optional()
        .describe(
          "The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.",
        ),
      new_source: z
        .string()
        .describe("The new source for the cell"),
      cell_type: z
        .enum(["code", "markdown"])
        .optional()
        .describe(
          "The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.",
        ),
      edit_mode: z
        .enum(["replace", "insert", "delete"])
        .optional()
        .describe(
          "The type of edit to make (replace, insert, delete). Defaults to replace.",
        ),
    }),
    async execute(params, ctx) {
      const { notebook_path, cell_id, new_source, cell_type, edit_mode = "replace" } = params

      // Validate path
      const fullPath = path.isAbsolute(notebook_path)
        ? notebook_path
        : path.resolve(Instance.directory, notebook_path)

      // Security: Block UNC paths
      if (fullPath.startsWith("\\\\") || fullPath.startsWith("//")) {
        throw new Error("UNC paths are not supported for security reasons")
      }

      // Validate file extension
      if (path.extname(fullPath) !== ".ipynb") {
        throw new Error(
          "File must be a Jupyter notebook (.ipynb file). For editing other file types, use the edit tool.",
        )
      }

      // Validate insert requires cell_type
      if (edit_mode === "insert" && !cell_type) {
        throw new Error("Cell type is required when using edit_mode=insert")
      }

      // Validate non-insert requires cell_id
      if (edit_mode !== "insert" && !cell_id) {
        throw new Error("Cell ID must be specified when not inserting a new cell")
      }

      // Request permission
      await ctx.ask({
        permission: "write",
        patterns: [fullPath],
        always: [path.dirname(fullPath) + "/*.ipynb"],
        metadata: {},
      })

      try {
        // Read the notebook
        const content = await fs.readFile(fullPath, "utf-8")
        let notebook: NotebookContent

        try {
          notebook = JSON.parse(content)
        } catch {
          throw new Error("Notebook is not valid JSON")
        }

        // Find cell index
        let cellIndex: number

        if (!cell_id) {
          cellIndex = 0 // Default to beginning
        } else {
          // Try to find by actual ID first
          cellIndex = notebook.cells.findIndex((cell) => cell.id === cell_id)

          // If not found, try cell-N format
          if (cellIndex === -1) {
            const parsedIndex = parseCellId(cell_id)
            if (parsedIndex !== undefined && parsedIndex < notebook.cells.length) {
              cellIndex = parsedIndex
            } else {
              throw new Error(`Cell with ID "${cell_id}" not found in notebook`)
            }
          }
        }

        // Adjust index for insert (insert after the specified cell)
        if (edit_mode === "insert" && cell_id) {
          cellIndex += 1
        }

        const language = notebook.metadata.language_info?.name ?? "python"
        let newCellId: string | undefined

        // Generate new ID for newer notebook formats
        if (
          notebook.nbformat > 4 ||
          (notebook.nbformat === 4 && notebook.nbformat_minor >= 5)
        ) {
          if (edit_mode === "insert") {
            newCellId = generateCellId()
          } else if (cell_id) {
            newCellId = cell_id
          }
        }

        // Perform the edit
        if (edit_mode === "delete") {
          notebook.cells.splice(cellIndex, 1)
        } else if (edit_mode === "insert") {
          const newCell: NotebookCell = {
            cell_type: cell_type!,
            id: newCellId,
            source: normalizeSource(new_source),
            metadata: {},
            ...(cell_type === "code" ? { execution_count: null, outputs: [] } : {}),
          }
          notebook.cells.splice(cellIndex, 0, newCell)
        } else {
          // Replace
          const targetCell = notebook.cells[cellIndex]
          if (!targetCell) {
            throw new Error(`Cell at index ${cellIndex} does not exist`)
          }

          targetCell.source = normalizeSource(new_source)

          if (targetCell.cell_type === "code") {
            targetCell.execution_count = null
            targetCell.outputs = []
          }

          if (cell_type && cell_type !== targetCell.cell_type) {
            targetCell.cell_type = cell_type
          }
        }

        // Write back to file
        const updatedContent = JSON.stringify(notebook, null, 1)
        await fs.writeFile(fullPath, updatedContent, "utf-8")

        log.info("notebook edited", {
          path: fullPath,
          edit_mode,
          cell_id: newCellId || cell_id,
        })

        return {
          title: `${edit_mode === "delete" ? "Delete" : edit_mode === "insert" ? "Insert" : "Edit"} Notebook Cell`,
          metadata: {
            notebook_path: fullPath,
            cell_id: newCellId || cell_id,
            cell_type: cell_type ?? "code",
            language,
            edit_mode,
          },
          output: edit_mode === "delete"
            ? `Deleted cell ${cell_id}`
            : edit_mode === "insert"
              ? `Inserted new ${cell_type} cell${newCellId ? ` with ID ${newCellId}` : ""}`
              : `Updated cell ${cell_id}`,
        }
      } catch (error) {
        log.error("notebook edit failed", { path: fullPath, error: String(error) })
        throw error
      }
    },
  }
})
