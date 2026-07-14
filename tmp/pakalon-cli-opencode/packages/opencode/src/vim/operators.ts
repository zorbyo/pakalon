/**
 * Vim Operator Functions
 *
 * Pure functions for executing vim operators (delete, change, yank, etc.)
 */

import type { Cursor } from "./motions"
import { isInclusiveMotion, isLinewiseMotion, resolveMotion } from "./motions"
import { findTextObject } from "./text-objects"
import type {
  FindType,
  Operator,
  RecordedChange,
  TextObjScope,
} from "./types"

/**
 * Get the first grapheme from a string
 */
function firstGrapheme(str: string): string {
  if (!str) return ""
  // Simple implementation - in production use Intl.Segmenter
  return [...str][0] || ""
}

/**
 * Get the last grapheme from a string
 */
function lastGrapheme(str: string): string {
  if (!str) return ""
  const chars = [...str]
  return chars[chars.length - 1] || ""
}

/**
 * Count occurrences of a character in a string
 */
function countCharInString(str: string, char: string): number {
  let count = 0
  for (const c of str) {
    if (c === char) count++
  }
  return count
}

/**
 * Context for operator execution.
 */
export type OperatorContext = {
  cursor: Cursor
  text: string
  setText: (text: string) => void
  setOffset: (offset: number) => void
  enterInsert: (offset: number) => void
  getRegister: () => string
  setRegister: (content: string, linewise: boolean) => void
  getLastFind: () => { type: FindType; char: string } | null
  setLastFind: (type: FindType, char: string) => void
  recordChange: (change: RecordedChange) => void
}

/**
 * Extended cursor interface for operators
 */
interface OperatorCursor extends Cursor {
  isAtEnd(): boolean
  findCharacter(char: string, findType: FindType, count: number): number | null
  getPosition(): { line: number; column: number }
  goToLine(line: number): Cursor
  startOfFirstLine(): Cursor
  measuredText: {
    nextOffset(offset: number): number
  }
  snapOutOfImageRef(offset: number, direction: "start" | "end"): number
}

/**
 * Execute an operator with a simple motion.
 */
export function executeOperatorMotion(
  op: Operator,
  motion: string,
  count: number,
  ctx: OperatorContext
): void {
  const target = resolveMotion(motion, ctx.cursor, count)
  if (target.equals(ctx.cursor)) return

  const range = getOperatorRange(
    ctx.cursor as OperatorCursor,
    target as OperatorCursor,
    motion,
    op,
    count
  )
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: "operator", op, motion, count })
}

/**
 * Execute an operator with a find motion.
 */
export function executeOperatorFind(
  op: Operator,
  findType: FindType,
  char: string,
  count: number,
  ctx: OperatorContext
): void {
  const cursor = ctx.cursor as OperatorCursor
  const targetOffset = cursor.findCharacter(char, findType, count)
  if (targetOffset === null) return

  // Create a simple cursor-like object for the target
  const target = {
    offset: targetOffset,
    equals: () => false,
  }

  const from = Math.min(cursor.offset, targetOffset)
  const maxOffset = Math.max(cursor.offset, targetOffset)
  const to = cursor.measuredText.nextOffset(maxOffset)

  applyOperator(op, from, to, ctx)
  ctx.setLastFind(findType, char)
  ctx.recordChange({ type: "operatorFind", op, find: findType, char, count })
}

/**
 * Execute an operator with a text object.
 */
export function executeOperatorTextObj(
  op: Operator,
  scope: TextObjScope,
  objType: string,
  count: number,
  ctx: OperatorContext
): void {
  const range = findTextObject(
    ctx.text,
    ctx.cursor.offset,
    objType,
    scope === "inner"
  )
  if (!range) return

  applyOperator(op, range.start, range.end, ctx)
  ctx.recordChange({ type: "operatorTextObj", op, objType, scope, count })
}

/**
 * Execute a line operation (dd, cc, yy).
 */
export function executeLineOp(
  op: Operator,
  count: number,
  ctx: OperatorContext
): void {
  const text = ctx.text
  const lines = text.split("\n")
  const cursor = ctx.cursor as OperatorCursor
  
  // Calculate logical line by counting newlines before cursor offset
  const currentLine = countCharInString(text.slice(0, cursor.offset), "\n")
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const lineStart = cursor.startOfLogicalLine().offset
  let lineEnd = lineStart
  
  for (let i = 0; i < linesToAffect; i++) {
    const nextNewline = text.indexOf("\n", lineEnd)
    lineEnd = nextNewline === -1 ? text.length : nextNewline + 1
  }

  let content = text.slice(lineStart, lineEnd)
  // Ensure linewise content ends with newline for paste detection
  if (!content.endsWith("\n")) {
    content = content + "\n"
  }
  ctx.setRegister(content, true)

  if (op === "yank") {
    ctx.setOffset(lineStart)
  } else if (op === "delete") {
    let deleteStart = lineStart
    const deleteEnd = lineEnd

    // If deleting to end of file and there's a preceding newline, include it
    if (
      deleteEnd === text.length &&
      deleteStart > 0 &&
      text[deleteStart - 1] === "\n"
    ) {
      deleteStart -= 1
    }

    const newText = text.slice(0, deleteStart) + text.slice(deleteEnd)
    ctx.setText(newText || "")
    const maxOff = Math.max(
      0,
      newText.length - (lastGrapheme(newText).length || 1)
    )
    ctx.setOffset(Math.min(deleteStart, maxOff))
  } else if (op === "change") {
    // For single line, just clear it
    if (lines.length === 1) {
      ctx.setText("")
      ctx.enterInsert(0)
    } else {
      // Delete all affected lines, replace with single empty line, enter insert
      const beforeLines = lines.slice(0, currentLine)
      const afterLines = lines.slice(currentLine + linesToAffect)
      const newText = [...beforeLines, "", ...afterLines].join("\n")
      ctx.setText(newText)
      ctx.enterInsert(lineStart)
    }
  }

  ctx.recordChange({ type: "operator", op, motion: op[0]!, count })
}

/**
 * Execute delete character (x command).
 */
export function executeX(count: number, ctx: OperatorContext): void {
  const from = ctx.cursor.offset

  if (from >= ctx.text.length) return

  // Advance by graphemes, not code units
  let endCursor = ctx.cursor
  const cursor = ctx.cursor as OperatorCursor
  for (let i = 0; i < count && !cursor.isAtEnd(); i++) {
    endCursor = endCursor.right()
  }
  const to = endCursor.offset

  const deleted = ctx.text.slice(from, to)
  const newText = ctx.text.slice(0, from) + ctx.text.slice(to)

  ctx.setRegister(deleted, false)
  ctx.setText(newText)
  const maxOff = Math.max(
    0,
    newText.length - (lastGrapheme(newText).length || 1)
  )
  ctx.setOffset(Math.min(from, maxOff))
  ctx.recordChange({ type: "x", count })
}

/**
 * Execute replace character (r command).
 */
export function executeReplace(
  char: string,
  count: number,
  ctx: OperatorContext
): void {
  let offset = ctx.cursor.offset
  let newText = ctx.text

  for (let i = 0; i < count && offset < newText.length; i++) {
    const graphemeLen = firstGrapheme(newText.slice(offset)).length || 1
    newText =
      newText.slice(0, offset) + char + newText.slice(offset + graphemeLen)
    offset += char.length
  }

  ctx.setText(newText)
  ctx.setOffset(Math.max(0, offset - char.length))
  ctx.recordChange({ type: "replace", char, count })
}

/**
 * Execute toggle case (~ command).
 */
export function executeToggleCase(count: number, ctx: OperatorContext): void {
  const startOffset = ctx.cursor.offset

  if (startOffset >= ctx.text.length) return

  let newText = ctx.text
  let offset = startOffset
  let toggled = 0

  while (offset < newText.length && toggled < count) {
    const grapheme = firstGrapheme(newText.slice(offset))
    const graphemeLen = grapheme.length

    const toggledGrapheme =
      grapheme === grapheme.toUpperCase()
        ? grapheme.toLowerCase()
        : grapheme.toUpperCase()

    newText =
      newText.slice(0, offset) +
      toggledGrapheme +
      newText.slice(offset + graphemeLen)
    offset += toggledGrapheme.length
    toggled++
  }

  ctx.setText(newText)
  ctx.setOffset(offset)
  ctx.recordChange({ type: "toggleCase", count })
}

/**
 * Execute join lines (J command).
 */
export function executeJoin(count: number, ctx: OperatorContext): void {
  const text = ctx.text
  const lines = text.split("\n")
  const cursor = ctx.cursor as OperatorCursor
  const { line: currentLine } = cursor.getPosition()

  if (currentLine >= lines.length - 1) return

  const linesToJoin = Math.min(count, lines.length - currentLine - 1)
  let joinedLine = lines[currentLine]!
  const cursorPos = joinedLine.length

  for (let i = 1; i <= linesToJoin; i++) {
    const nextLine = (lines[currentLine + i] ?? "").trimStart()
    if (nextLine.length > 0) {
      if (!joinedLine.endsWith(" ") && joinedLine.length > 0) {
        joinedLine += " "
      }
      joinedLine += nextLine
    }
  }

  const newLines = [
    ...lines.slice(0, currentLine),
    joinedLine,
    ...lines.slice(currentLine + linesToJoin + 1),
  ]

  const newText = newLines.join("\n")
  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(newLines, currentLine) + cursorPos)
  ctx.recordChange({ type: "join", count })
}

/**
 * Execute paste (p/P command).
 */
export function executePaste(
  after: boolean,
  count: number,
  ctx: OperatorContext
): void {
  const register = ctx.getRegister()
  if (!register) return

  const isLinewise = register.endsWith("\n")
  const content = isLinewise ? register.slice(0, -1) : register
  const cursor = ctx.cursor as OperatorCursor

  if (isLinewise) {
    const text = ctx.text
    const lines = text.split("\n")
    const { line: currentLine } = cursor.getPosition()

    const insertLine = after ? currentLine + 1 : currentLine
    const contentLines = content.split("\n")
    const repeatedLines: string[] = []
    for (let i = 0; i < count; i++) {
      repeatedLines.push(...contentLines)
    }

    const newLines = [
      ...lines.slice(0, insertLine),
      ...repeatedLines,
      ...lines.slice(insertLine),
    ]

    const newText = newLines.join("\n")
    ctx.setText(newText)
    ctx.setOffset(getLineStartOffset(newLines, insertLine))
  } else {
    const textToInsert = content.repeat(count)
    const insertPoint =
      after && cursor.offset < ctx.text.length
        ? cursor.measuredText.nextOffset(cursor.offset)
        : cursor.offset

    const newText =
      ctx.text.slice(0, insertPoint) +
      textToInsert +
      ctx.text.slice(insertPoint)
    const lastGr = lastGrapheme(textToInsert)
    const newOffset = insertPoint + textToInsert.length - (lastGr.length || 1)

    ctx.setText(newText)
    ctx.setOffset(Math.max(insertPoint, newOffset))
  }
}

/**
 * Execute indent (>> command).
 */
export function executeIndent(
  dir: ">" | "<",
  count: number,
  ctx: OperatorContext
): void {
  const text = ctx.text
  const lines = text.split("\n")
  const cursor = ctx.cursor as OperatorCursor
  const { line: currentLine } = cursor.getPosition()
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const indent = "  " // Two spaces

  for (let i = 0; i < linesToAffect; i++) {
    const lineIdx = currentLine + i
    const line = lines[lineIdx] ?? ""

    if (dir === ">") {
      lines[lineIdx] = indent + line
    } else if (line.startsWith(indent)) {
      lines[lineIdx] = line.slice(indent.length)
    } else if (line.startsWith("\t")) {
      lines[lineIdx] = line.slice(1)
    } else {
      // Remove as much leading whitespace as possible up to indent length
      let removed = 0
      let idx = 0
      while (
        idx < line.length &&
        removed < indent.length &&
        /\s/.test(line[idx]!)
      ) {
        removed++
        idx++
      }
      lines[lineIdx] = line.slice(idx)
    }
  }

  const newText = lines.join("\n")
  const currentLineText = lines[currentLine] ?? ""
  const firstNonBlank = (currentLineText.match(/^\s*/)?.[0] ?? "").length

  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(lines, currentLine) + firstNonBlank)
  ctx.recordChange({ type: "indent", dir, count })
}

/**
 * Execute open line (o/O command).
 */
export function executeOpenLine(
  direction: "above" | "below",
  ctx: OperatorContext
): void {
  const text = ctx.text
  const lines = text.split("\n")
  const cursor = ctx.cursor as OperatorCursor
  const { line: currentLine } = cursor.getPosition()

  const insertLine = direction === "below" ? currentLine + 1 : currentLine
  const newLines = [
    ...lines.slice(0, insertLine),
    "",
    ...lines.slice(insertLine),
  ]

  const newText = newLines.join("\n")
  ctx.setText(newText)
  ctx.enterInsert(getLineStartOffset(newLines, insertLine))
  ctx.recordChange({ type: "openLine", direction })
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Calculate the offset of a line's start position.
 */
function getLineStartOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0)
}

function getOperatorRange(
  cursor: OperatorCursor,
  target: OperatorCursor,
  motion: string,
  op: Operator,
  count: number
): { from: number; to: number; linewise: boolean } {
  let from = Math.min(cursor.offset, target.offset)
  let to = Math.max(cursor.offset, target.offset)
  let linewise = false

  // Special case: cw/cW changes to end of word, not start of next word
  if (op === "change" && (motion === "w" || motion === "W")) {
    // For cw with count, move forward (count-1) words, then find end of that word
    let wordCursor = cursor
    for (let i = 0; i < count - 1; i++) {
      wordCursor =
        motion === "w"
          ? (wordCursor.nextVimWord() as OperatorCursor)
          : (wordCursor.nextWORD() as OperatorCursor)
    }
    const wordEnd =
      motion === "w"
        ? (wordCursor.endOfVimWord() as OperatorCursor)
        : (wordCursor.endOfWORD() as OperatorCursor)
    to = cursor.measuredText.nextOffset(wordEnd.offset)
  } else if (isLinewiseMotion(motion)) {
    // Linewise motions extend to include entire lines
    linewise = true
    const text = cursor.text
    const nextNewline = text.indexOf("\n", to)
    if (nextNewline === -1) {
      // Deleting to end of file - include the preceding newline if exists
      to = text.length
      if (from > 0 && text[from - 1] === "\n") {
        from -= 1
      }
    } else {
      to = nextNewline + 1
    }
  } else if (isInclusiveMotion(motion) && cursor.offset <= target.offset) {
    to = cursor.measuredText.nextOffset(to)
  }

  // Word motions can land inside an [Image #N] chip; extend the range
  from = cursor.snapOutOfImageRef(from, "start")
  to = cursor.snapOutOfImageRef(to, "end")

  return { from, to, linewise }
}

function applyOperator(
  op: Operator,
  from: number,
  to: number,
  ctx: OperatorContext,
  linewise: boolean = false
): void {
  let content = ctx.text.slice(from, to)
  // Ensure linewise content ends with newline for paste detection
  if (linewise && !content.endsWith("\n")) {
    content = content + "\n"
  }
  ctx.setRegister(content, linewise)

  if (op === "yank") {
    ctx.setOffset(from)
  } else if (op === "delete") {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    const maxOff = Math.max(
      0,
      newText.length - (lastGrapheme(newText).length || 1)
    )
    ctx.setOffset(Math.min(from, maxOff))
  } else if (op === "change") {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    ctx.enterInsert(from)
  }
}

export function executeOperatorG(
  op: Operator,
  count: number,
  ctx: OperatorContext
): void {
  const cursor = ctx.cursor as OperatorCursor
  // count=1 means no count given, target = end of file
  // otherwise target = line N
  const target =
    count === 1
      ? (cursor.startOfLastLine() as OperatorCursor)
      : (cursor.goToLine(count) as OperatorCursor)

  if (target.equals(cursor)) return

  const range = getOperatorRange(cursor, target, "G", op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: "operator", op, motion: "G", count })
}

export function executeOperatorGg(
  op: Operator,
  count: number,
  ctx: OperatorContext
): void {
  const cursor = ctx.cursor as OperatorCursor
  // count=1 means no count given, target = first line
  // otherwise target = line N
  const target =
    count === 1
      ? (cursor.startOfFirstLine() as OperatorCursor)
      : (cursor.goToLine(count) as OperatorCursor)

  if (target.equals(cursor)) return

  const range = getOperatorRange(cursor, target, "gg", op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: "operator", op, motion: "gg", count })
}
