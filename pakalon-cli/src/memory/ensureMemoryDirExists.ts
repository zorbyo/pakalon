/**
 * Ensure Memory Directory Exists
 *
 * Provides directory creation for the memory system.
 */

import { getFsImplementation } from '../utils/fsOperations.js'
import { logForDebugging } from '../utils/debug.js'

/**
 * Ensure a memory directory exists. Idempotent — called from loadMemoryPrompt
 * so the model can always write without checking existence first.
 */
export async function ensureMemoryDirExists(memoryDir: string): Promise<void> {
  const fs = getFsImplementation()
  try {
    await fs.mkdir(memoryDir, { recursive: true })
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? (e.code as string | undefined) : undefined
    logForDebugging(`ensureMemoryDirExists failed for ${memoryDir}: ${code ?? String(e)}`, {
      level: 'debug',
    })
  }
}