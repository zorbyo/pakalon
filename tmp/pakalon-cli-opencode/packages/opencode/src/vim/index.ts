/**
 * Vim Mode System
 *
 * Complete vim-style editing support including motions, operators,
 * text objects, and state machine transitions.
 */

// Re-export types
export * from "./types"

// Re-export motions
export { resolveMotion, isInclusiveMotion, isLinewiseMotion } from "./motions"
export type { Cursor } from "./motions"

// Re-export text objects
export { findTextObject, isVimWhitespace, isVimWordChar, isVimPunctuation } from "./text-objects"
export type { TextObjectRange } from "./text-objects"

// Re-export operators
export {
  executeOperatorMotion,
  executeOperatorFind,
  executeOperatorTextObj,
  executeLineOp,
  executeX,
  executeReplace,
  executeToggleCase,
  executeJoin,
  executePaste,
  executeIndent,
  executeOpenLine,
  executeOperatorG,
  executeOperatorGg,
} from "./operators"
export type { OperatorContext } from "./operators"

// Re-export transitions
export { transition } from "./transitions"
export type { TransitionContext, TransitionResult } from "./transitions"

/**
 * Vim mode controller for managing editing state
 */
import {
  VimState,
  CommandState,
  PersistentState,
  createInitialVimState,
  createInitialPersistentState,
  RecordedChange,
  FindType,
} from "./types"
import { transition } from "./transitions"
import type { TransitionContext } from "./transitions"
import type { Cursor } from "./motions"

export class VimController {
  private state: VimState
  private persistent: PersistentState
  private text: string
  private cursorOffset: number
  private onTextChange?: (text: string) => void
  private onCursorChange?: (offset: number) => void
  private onModeChange?: (mode: "INSERT" | "NORMAL") => void

  constructor() {
    this.state = createInitialVimState()
    this.persistent = createInitialPersistentState()
    this.text = ""
    this.cursorOffset = 0
  }

  /**
   * Initialize with text and cursor position
   */
  initialize(text: string, cursorOffset: number = 0): void {
    this.text = text
    this.cursorOffset = cursorOffset
    this.state = createInitialVimState()
    this.persistent = createInitialPersistentState()
  }

  /**
   * Set callback for text changes
   */
  onText(callback: (text: string) => void): void {
    this.onTextChange = callback
  }

  /**
   * Set callback for cursor changes
   */
  onCursor(callback: (offset: number) => void): void {
    this.onCursorChange = callback
  }

  /**
   * Set callback for mode changes
   */
  onMode(callback: (mode: "INSERT" | "NORMAL") => void): void {
    this.onModeChange = callback
  }

  /**
   * Get current mode
   */
  getMode(): "INSERT" | "NORMAL" {
    return this.state.mode
  }

  /**
   * Get current state
   */
  getState(): VimState {
    return { ...this.state }
  }

  /**
   * Get persistent state
   */
  getPersistentState(): PersistentState {
    return { ...this.persistent }
  }

  /**
   * Get current text
   */
  getText(): string {
    return this.text
  }

  /**
   * Get cursor offset
   */
  getCursorOffset(): number {
    return this.cursorOffset
  }

  /**
   * Process a key input in NORMAL mode
   */
  processKey(key: string, cursor: Cursor): void {
    if (this.state.mode === "INSERT") {
      // In INSERT mode, track typed text
      if (key === "Escape") {
        // Exit INSERT mode
        this.state = { mode: "NORMAL", command: { type: "idle" } }
        this.persistent.lastChange = {
          type: "insert",
          text: (this.state as { insertedText: string }).insertedText || "",
        }
        this.onModeChange?.("NORMAL")
      } else {
        // Track inserted text
        const insertState = this.state as { mode: "INSERT"; insertedText: string }
        insertState.insertedText += key
      }
      return
    }

    // NORMAL mode - use transition table
    const normalState = this.state as { mode: "NORMAL"; command: CommandState }
    const ctx: TransitionContext = {
      cursor,
      text: this.text,
      setText: (text: string) => {
        this.text = text
        this.onTextChange?.(text)
      },
      setOffset: (offset: number) => {
        this.cursorOffset = offset
        this.onCursorChange?.(offset)
      },
      enterInsert: (offset: number) => {
        this.cursorOffset = offset
        this.state = { mode: "INSERT", insertedText: "" }
        this.onCursorChange?.(offset)
        this.onModeChange?.("INSERT")
      },
      getRegister: () => this.persistent.register,
      setRegister: (content: string, linewise: boolean) => {
        this.persistent.register = content
        this.persistent.registerIsLinewise = linewise
      },
      getLastFind: () => this.persistent.lastFind,
      setLastFind: (type: FindType, char: string) => {
        this.persistent.lastFind = { type, char }
      },
      recordChange: (change: RecordedChange) => {
        this.persistent.lastChange = change
      },
      onUndo: () => {
        // Undo implementation would go here
      },
      onDotRepeat: () => {
        // Dot repeat implementation would go here
      },
    }

    const result = transition(normalState.command, key, ctx)

    if (result.execute) {
      result.execute()
    }

    if (result.next) {
      normalState.command = result.next
    } else if (result.execute) {
      // After executing a command, return to idle
      normalState.command = { type: "idle" }
    }
  }

  /**
   * Enter NORMAL mode
   */
  enterNormalMode(): void {
    if (this.state.mode === "NORMAL") return
    
    this.state = { mode: "NORMAL", command: { type: "idle" } }
    this.onModeChange?.("NORMAL")
  }

  /**
   * Enter INSERT mode at current position
   */
  enterInsertMode(): void {
    if (this.state.mode === "INSERT") return
    
    this.state = { mode: "INSERT", insertedText: "" }
    this.onModeChange?.("INSERT")
  }

  /**
   * Reset state to initial
   */
  reset(): void {
    this.state = createInitialVimState()
    this.persistent = createInitialPersistentState()
    this.text = ""
    this.cursorOffset = 0
  }
}

// Default export
export default {
  VimController,
  createInitialVimState,
  createInitialPersistentState,
}
