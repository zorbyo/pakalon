import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'

export interface TranscriptionSegment {
  id?: number
  start?: number
  end?: number
  text: string
  words?: Array<{ word: string; start?: number; end?: number }>
}

export interface TranscriptionResult {
  text: string
  segments: TranscriptionSegment[]
  language?: string
  duration: number
}

export interface TranscriptionOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
  language?: string
  prompt?: string
  temperature?: number
  provider?: 'auto' | 'api' | 'cli'
}

type ResolvedInput = { filePath: string; cleanup?: () => Promise<void> }

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const DEFAULT_MODEL = 'whisper-1'

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath)
}

export function isTranscriptionAvailable(): boolean {
  return hasApiCredentials() || hasWhisperCli()
}

export function hasApiCredentials(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.WHISPER_API_KEY,
  )
}

export function hasWhisperCli(): boolean {
  return probeCommand('whisper') || probeCommand('whisper.exe')
}

export async function transcribeAudio(
  audioPath: string,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const service = new VoiceTranscriptionService(options)
  await service.initialize()
  return service.transcribe(audioPath)
}

export class VoiceTranscriptionService {
  private ready = false
  private apiKey: string | undefined
  private baseUrl: string
  private model: string
  private provider: 'auto' | 'api' | 'cli'

  constructor(options: TranscriptionOptions = {}) {
    this.apiKey = options.apiKey
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1'
    this.model = options.model ?? DEFAULT_MODEL
    this.provider = options.provider ?? 'auto'
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      this.apiKey = process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY || process.env.OPENROUTER_API_KEY
    }
    if (process.env.WHISPER_API_BASE_URL) {
      this.baseUrl = process.env.WHISPER_API_BASE_URL
    }
    this.ready = true
  }

  isAvailable(): boolean {
    return hasApiCredentials() || hasWhisperCli()
  }

  async transcribe(input: Buffer | string): Promise<TranscriptionResult> {
    if (!this.ready) {
      await this.initialize()
    }

    const resolved = await this.resolveInput(input)
    try {
      if (this.provider !== 'cli' && this.canUseApi(resolved.filePath)) {
        try {
          return await this.transcribeWithApi(resolved.filePath)
        } catch (error) {
          if (this.provider === 'api') {
            throw error
          }
        }
      }

      if (hasWhisperCli()) {
        return await this.transcribeWithCli(resolved.filePath)
      }

      throw new Error('No transcription backend available. Set OPENAI_API_KEY or install whisper CLI.')
    } finally {
      if (resolved.cleanup) {
        await resolved.cleanup()
      }
    }
  }

  private canUseApi(filePath: string): boolean {
    if (!this.apiKey) return false
    const stats = fs.statSync(filePath)
    return stats.size <= MAX_AUDIO_BYTES
  }

  private async resolveInput(input: Buffer | string): Promise<ResolvedInput> {
    if (Buffer.isBuffer(input)) {
      if (input.byteLength > MAX_AUDIO_BYTES) {
        throw new Error(`Audio file exceeds the 25MB limit (${input.byteLength} bytes).`)
      }
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pakalon-stt-'))
      const tempFile = path.join(tempDir, 'audio.wav')
      await fs.promises.writeFile(tempFile, input)
      return {
        filePath: tempFile,
        cleanup: async () => {
          await fs.promises.rm(tempDir, { recursive: true, force: true })
        },
      }
    }

    const stats = await fs.promises.stat(input)
    if (stats.size > MAX_AUDIO_BYTES && this.provider === 'api') {
      throw new Error(`Audio file exceeds the 25MB API limit (${stats.size} bytes).`)
    }
    return { filePath: input }
  }

  private async transcribeWithApi(filePath: string): Promise<TranscriptionResult> {
    const audioBuffer = await fs.promises.readFile(filePath)
    const form = new FormData()
    const blob = new Blob([audioBuffer])
    form.append('file', blob, path.basename(filePath))
    form.append('model', this.model)
    form.append('response_format', 'verbose_json')
    if (process.env.WHISPER_LANGUAGE) form.append('language', process.env.WHISPER_LANGUAGE)
    if (process.env.WHISPER_PROMPT) form.append('prompt', process.env.WHISPER_PROMPT)

    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey ?? ''}`,
      },
      body: form,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Whisper API request failed (${response.status}): ${errorText}`)
    }

    const payload = (await response.json()) as Record<string, unknown>
    return this.normalizeResult(payload)
  }

  private async transcribeWithCli(filePath: string): Promise<TranscriptionResult> {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pakalon-whisper-'))
    const wavPath = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.wav`)
    const normalized = await this.convertToWav(filePath, wavPath)

    try {
      const args = [normalized, '--output_format', 'json', '--output_dir', tempDir, '--verbose', 'False', '--model', this.model]
      const language = process.env.WHISPER_LANGUAGE
      if (language) {
        args.push('--language', language)
      }
      const prompt = process.env.WHISPER_PROMPT
      if (prompt) {
        args.push('--initial_prompt', prompt)
      }

      const cli = spawnSync('whisper', args, { encoding: 'utf-8' })
      if (cli.error) {
        const alt = spawnSync('whisper.exe', args, { encoding: 'utf-8' })
        if (alt.error) {
          throw cli.error
        }
      } else if (cli.status !== 0) {
        throw new Error(cli.stderr || cli.stdout || 'Whisper CLI failed')
      }

      const jsonPath = path.join(tempDir, `${path.basename(normalized, path.extname(normalized))}.json`)
      const raw = await fs.promises.readFile(jsonPath, 'utf-8')
      return this.normalizeResult(JSON.parse(raw) as Record<string, unknown>)
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  }

  private convertToWav(sourcePath: string, targetPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(sourcePath)
        .audioChannels(1)
        .audioFrequency(16000)
        .format('wav')
        .on('error', reject)
        .on('end', () => resolve(targetPath))
        .save(targetPath)
    })
  }

  private normalizeResult(payload: Record<string, unknown>): TranscriptionResult {
    const segments = Array.isArray(payload.segments)
      ? payload.segments
          .map((segment, index) => normalizeSegment(segment, index))
          .filter((segment): segment is TranscriptionSegment => Boolean(segment))
      : []
    const duration = resolveDuration(payload.duration, segments)
    const text = typeof payload.text === 'string' ? payload.text : segments.map(segment => segment.text).join(' ').trim()
    return {
      text,
      segments,
      language: typeof payload.language === 'string' ? payload.language : undefined,
      duration,
    }
  }
}

function normalizeSegment(value: unknown, index: number): TranscriptionSegment | null {
  if (!value || typeof value !== 'object') return null
  const segment = value as Record<string, unknown>
  const text = typeof segment.text === 'string' ? segment.text : ''
  if (!text) return null
  return {
    id: typeof segment.id === 'number' ? segment.id : index,
    start: typeof segment.start === 'number' ? segment.start : undefined,
    end: typeof segment.end === 'number' ? segment.end : undefined,
    text,
    words: Array.isArray(segment.words)
      ? segment.words
          .map(word => {
            if (!word || typeof word !== 'object') return null
            const item = word as Record<string, unknown>
            return {
              word: typeof item.word === 'string' ? item.word : '',
              start: typeof item.start === 'number' ? item.start : undefined,
              end: typeof item.end === 'number' ? item.end : undefined,
            }
          })
          .filter((word): word is { word: string; start?: number; end?: number } => Boolean(word?.word))
      : undefined,
  }
}

function resolveDuration(duration: unknown, segments: TranscriptionSegment[]): number {
  if (typeof duration === 'number') return duration
  if (typeof duration === 'string') {
    const parsed = Number(duration)
    if (!Number.isNaN(parsed)) return parsed
  }
  const lastSegment = segments[segments.length - 1]
  return lastSegment?.end ?? 0
}

function probeCommand(command: string): boolean {
  const result = spawnSync(command, ['--version'], { encoding: 'utf-8' })
  return !result.error
}
