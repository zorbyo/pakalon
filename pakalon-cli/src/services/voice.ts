import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { exec, spawn, type ChildProcess } from 'child_process'

export interface RecordingAvailability {
  available: boolean
  reason?: string
}

export interface VoiceDependencies {
  available: boolean
  tool: string | null
  installCommand?: string
}

export interface RecordingOptions {
  silenceDetection?: boolean
}

let activeProcess: ChildProcess | null = null
let activeTempFile: string | null = null
let onChunkCallback: ((chunk: Buffer) => void) | null = null
let onEndCallback: (() => void) | null = null

export async function checkRecordingAvailability(): Promise<RecordingAvailability> {
  try {
    const deps = await checkVoiceDependencies()
    if (!deps.available) {
      return {
        available: false,
        reason: `No audio recording tool found. Install: ${deps.installCommand ?? 'SoX or equivalent'}`,
      }
    }
    return { available: true }
  } catch (err) {
    return {
      available: false,
      reason: `Audio check failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export async function checkVoiceDependencies(): Promise<VoiceDependencies> {
  const platform = process.platform

  if (platform === 'darwin') {
    return { available: true, tool: 'coreaudio' }
  }

  if (platform === 'win32') {
    return { available: true, tool: 'wasapi' }
  }

  const tools = ['sox', 'arecord', 'ffmpeg']
  for (const tool of tools) {
    try {
      await execAsync(`${tool} --version`)
      return { available: true, tool }
    } catch {
      // Not found
    }
  }

  return {
    available: false,
    tool: null,
    installCommand: 'apt-get install sox libsox-fmt-all',
  }
}

export async function requestMicrophonePermission(): Promise<boolean> {
  const platform = process.platform

  if (platform === 'darwin') {
    try {
      const { stdout } = await execAsync(
        'tccutil reset Microphone com.pakalon.cli 2>/dev/null; echo ok',
      )
      return stdout.includes('ok')
    } catch {
      // Try recording a short sample to trigger the permission prompt
      return true
    }
  }

  if (platform === 'win32') {
    return true
  }

  // Linux - try a short recording
  const deps = await checkVoiceDependencies()
  return deps.available
}

export async function startRecording(
  onChunk: (chunk: Buffer) => void,
  onEnd: () => void,
  options: RecordingOptions = {},
): Promise<boolean> {
  const platform = process.platform
  onChunkCallback = onChunk
  onEndCallback = onEnd

  try {
    if (platform === 'darwin') {
      return startRecordingMacOS(options)
    }

    if (platform === 'win32') {
      return startRecordingWindows(options)
    }

    return startRecordingLinux(options)
  } catch (err) {
    console.error('[voice] Failed to start recording:', err)
    return false
  }
}

function startRecordingMacOS(options: RecordingOptions): boolean {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pakalon-voice-'))
  activeTempFile = path.join(tempDir, 'audio.raw')

  const args = [
    '-f', 's16le',
    '-ac', '1',
    '-ar', '16000',
    '-i', 'default:none',
    '-f', 's16le',
    activeTempFile,
  ]

  activeProcess = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })

  activeProcess.stderr?.on('data', () => {
    // FFmpeg logs to stderr, ignore
  })

  activeProcess.on('close', () => {
    if (onEndCallback) {
      onEndCallback()
    }
    cleanupTempFile()
  })

  activeProcess.on('error', () => {
    if (onEndCallback) {
      onEndCallback()
    }
    cleanupTempFile()
  })

  // Poll the temp file for new chunks
  startFilePolling(activeTempFile)

  return true
}

function startRecordingWindows(options: RecordingOptions): boolean {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pakalon-voice-'))
  activeTempFile = path.join(tempDir, 'audio.raw')

  const args = [
    '-f', 'dshow',
    '-audio_buffer_size', '50',
    '-i', 'audio=Microphone',
    '-f', 's16le',
    '-ac', '1',
    '-ar', '16000',
    activeTempFile,
  ]

  activeProcess = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })

  activeProcess.on('close', () => {
    if (onEndCallback) {
      onEndCallback()
    }
    cleanupTempFile()
  })

  activeProcess.on('error', () => {
    if (onEndCallback) {
      onEndCallback()
    }
    cleanupTempFile()
  })

  startFilePolling(activeTempFile)

  return true
}

function startRecordingLinux(options: RecordingOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const deps = checkVoiceDependenciesSync()

    if (deps.tool === 'sox') {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pakalon-voice-'))
      activeTempFile = path.join(tempDir, 'audio.raw')

      activeProcess = spawn('sox', [
        '-t', 'pulseaudio', 'default',
        '-t', 'raw',
        '-r', '16000',
        '-e', 'signed-integer',
        '-b', '16',
        '-c', '1',
        activeTempFile,
      ], { stdio: ['ignore', 'ignore', 'pipe'] })

      activeProcess.on('close', () => {
        if (onEndCallback) onEndCallback()
        cleanupTempFile()
      })

      startFilePolling(activeTempFile)
      resolve(true)
    } else if (deps.tool === 'arecord') {
      activeProcess = spawn('arecord', [
        '-f', 'S16_LE',
        '-r', '16000',
        '-c', '1',
        '-t', 'raw',
      ], { stdio: ['ignore', 'pipe', 'pipe'] })

      activeProcess.stdout?.on('data', (chunk: Buffer) => {
        if (onChunkCallback) {
          onChunkCallback(Buffer.from(chunk))
        }
      })

      activeProcess.on('close', () => {
        if (onEndCallback) onEndCallback()
      })

      activeProcess.on('error', () => {
        if (onEndCallback) onEndCallback()
      })

      resolve(true)
    } else if (deps.tool === 'ffmpeg') {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pakalon-voice-'))
      activeTempFile = path.join(tempDir, 'audio.raw')

      activeProcess = spawn('ffmpeg', [
        '-f', 'pulse',
        '-i', 'default',
        '-f', 's16le',
        '-ac', '1',
        '-ar', '16000',
        activeTempFile,
      ], { stdio: ['ignore', 'ignore', 'pipe'] })

      activeProcess.on('close', () => {
        if (onEndCallback) onEndCallback()
        cleanupTempFile()
      })

      startFilePolling(activeTempFile)
      resolve(true)
    } else {
      resolve(false)
    }
  })
}

function startFilePolling(filePath: string): void {
  let offset = 0
  const pollInterval = setInterval(() => {
    if (!activeProcess || activeProcess.killed) {
      clearInterval(pollInterval)
      return
    }

    try {
      const stats = fs.statSync(filePath)
      if (stats.size > offset) {
        const fd = fs.openSync(filePath, 'r')
        const buffer = Buffer.alloc(stats.size - offset)
        fs.readSync(fd, buffer, 0, buffer.length, offset)
        fs.closeSync(fd)
        offset = stats.size

        if (onChunkCallback) {
          onChunkCallback(buffer)
        }
      }
    } catch {
      // File not ready yet
    }
  }, 50)

  // Store interval for cleanup
  ;(globalThis as Record<string, unknown>).__pakalon_voice_poll = pollInterval
}

export function stopRecording(): void {
  if (activeProcess) {
    try {
      activeProcess.kill('SIGTERM')
    } catch {
      try {
        activeProcess.kill('SIGKILL')
      } catch {
        // Ignore
      }
    }
    activeProcess = null
  }

  const pollInterval = (globalThis as Record<string, unknown>).__pakalon_voice_poll
  if (pollInterval) {
    clearInterval(pollInterval as NodeJS.Timeout)
    delete (globalThis as Record<string, unknown>).__pakalon_voice_poll
  }

  cleanupTempFile()
  onChunkCallback = null
  onEndCallback = null
}

function cleanupTempFile(): void {
  if (activeTempFile) {
    try {
      fs.unlinkSync(activeTempFile)
    } catch {
      // Ignore
    }
    const dir = path.dirname(activeTempFile)
    try {
      fs.rmdirSync(dir, { recursive: true })
    } catch {
      // Ignore
    }
    activeTempFile = null
  }
}

function checkVoiceDependenciesSync(): VoiceDependencies {
  const platform = process.platform

  if (platform === 'darwin') {
    return { available: true, tool: 'coreaudio' }
  }

  if (platform === 'win32') {
    return { available: true, tool: 'wasapi' }
  }

  const tools = ['sox', 'arecord', 'ffmpeg']
  for (const tool of tools) {
    try {
      const { execSync } = require('child_process')
      execSync(`${tool} --version`, { stdio: 'ignore' })
      return { available: true, tool }
    } catch {
      // Not found
    }
  }

  return {
    available: false,
    tool: null,
    installCommand: 'apt-get install sox libsox-fmt-all',
  }
}
