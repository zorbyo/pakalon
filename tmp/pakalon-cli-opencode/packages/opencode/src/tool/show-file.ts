import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./show-file.txt"
import * as fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

export const ShowFileTool = Tool.define("show_file", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to display"),
    highlight: z
      .string()
      .optional()
      .describe("Optional string to highlight in the file content"),
    startLine: z
      .number()
      .optional()
      .describe("Start line number (1-indexed) to show a section of the file"),
    endLine: z
      .number()
      .optional()
      .describe("End line number (1-indexed) to show a section of the file"),
  }),
  async execute(params) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    const stat = Filesystem.stat(filepath)
    if (!stat) throw new Error(`File not found: ${filepath}`)
    if (stat.isDirectory()) throw new Error(`Path is a directory, not a file: ${filepath}`)

    const content = await fs.readFile(filepath, "utf-8")
    const lines = content.split("\n")
    const title = path.relative(Instance.worktree, filepath)

    const startLine = Math.max(1, params.startLine ?? 1)
    const endLine = Math.min(lines.length, params.endLine ?? lines.length)

    const displayLines = lines.slice(startLine - 1, endLine)

    if (params.highlight) {
      const hl = params.highlight
      for (let i = 0; i < displayLines.length; i++) {
        if (displayLines[i].includes(hl)) {
          displayLines[i] = displayLines[i].replace(hl, `>>> ${hl} <<<`)
        }
      }
    }

    const numbered = displayLines.map((line, i) => `${(startLine + i).toString().padStart(4)} | ${line}`)

    const output = [
      `File: ${title}`,
      `Path: ${filepath}`,
      `Total lines: ${lines.length}`,
      "",
      "─".repeat(60),
      ...numbered,
      "─".repeat(60),
      "",
      `Showing lines ${startLine}-${endLine} of ${lines.length}`,
    ].join("\n")

    return {
      title: `Showing: ${title}`,
      output,
      metadata: {
        path: filepath,
        totalLines: lines.length,
        shownLines: displayLines.length,
        startLine,
        endLine,
      },
    }
  },
})
