/**
 * Text-to-Speech (TTS) Module
 *
 * Converts AI response text to spoken audio.
 * Uses browser Web Speech API when available (via Ink terminal),
 * falls back to OpenAI TTS API (via OpenRouter), or system audio player.
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TtsVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

export interface TtsOptions {
  /** Voice to use for speech synthesis */
  voice?: TtsVoice;
  /** Speech speed (0.25 to 4.0) */
  speed?: number;
  /** Output format */
  format?: "mp3" | "opus" | "aac" | "flac" | "wav";
  /** TTS provider: auto, openai, system */
  provider?: "auto" | "openai" | "system";
}

export interface TtsState {
  speaking: boolean;
  currentText: string;
  queue: string[];
  voice: TtsVoice;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: TtsOptions = {
  voice: "alloy",
  speed: 1.0,
  format: "mp3",
  provider: "auto",
};

const AVAILABLE_VOICES: TtsVoice[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
];

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const OPENROUTER_TTS_URL = "https://openrouter.ai/api/v1/audio/speech";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state: TtsState = {
  speaking: false,
  currentText: "",
  queue: [],
  voice: "alloy",
  enabled: false,
};

// ---------------------------------------------------------------------------
// Voice management
// ---------------------------------------------------------------------------

export function getAvailableVoices(): TtsVoice[] {
  return [...AVAILABLE_VOICES];
}

export function setVoice(voice: TtsVoice): void {
  state.voice = voice;
}

export function getCurrentVoice(): TtsVoice {
  return state.voice;
}

export function isTtsEnabled(): boolean {
  return state.enabled;
}

export function setTtsEnabled(enabled: boolean): void {
  state.enabled = enabled;
  if (!enabled) {
    stopSpeaking();
  }
}

// ---------------------------------------------------------------------------
// Speaking state
// ---------------------------------------------------------------------------

export function isSpeaking(): boolean {
  return state.speaking;
}

export function getTtsState(): TtsState {
  return { ...state, queue: [...state.queue] };
}

// ---------------------------------------------------------------------------
// API-based TTS (OpenRouter / OpenAI)
// ---------------------------------------------------------------------------

async function speakViaApi(
  text: string,
  options: TtsOptions,
): Promise<boolean> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return false;

  // Try OpenRouter first, fall back to OpenAI
  const urls = [OPENROUTER_TTS_URL, OPENAI_TTS_URL];
  const modelName = options.provider === "openai" ? "tts-1" : undefined;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName ?? "openai/tts-1",
          input: text,
          voice: options.voice ?? "alloy",
          response_format: options.format ?? "mp3",
          speed: options.speed ?? 1.0,
        }),
      });

      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        await playAudioBuffer(audioBuffer);
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// System audio playback (platform-specific)
// ---------------------------------------------------------------------------

async function playAudioBuffer(buffer: ArrayBuffer): Promise<void> {
  // In a terminal environment, save to temp file and play via system player
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs/promises");
  const { execFile } = await import("child_process");

  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `pakalon-tts-${Date.now()}.mp3`);

  try {
    await fs.writeFile(tmpFile, Buffer.from(buffer));

    const platform = process.platform;
    if (platform === "darwin") {
      await new Promise<void>((resolve, reject) => {
        const proc = execFile("afplay", [tmpFile], (error) => {
          if (error) reject(error);
          else resolve();
        });
        proc.on("error", reject);
      });
    } else if (platform === "win32") {
      await new Promise<void>((resolve, reject) => {
        const proc = execFile("powershell", [
          "-c",
          `(New-Object Media.SoundPlayer '${tmpFile}').PlaySync()`,
        ], { timeout: 30000 }, (error) => {
          if (error) reject(error);
          else resolve();
        });
        proc.on("error", reject);
      });
    } else {
      // Linux: try paplay, aplay, or ffplay
      const players = ["paplay", "aplay", "ffplay", "play"];
      for (const player of players) {
        try {
          await new Promise<void>((resolve, reject) => {
            const proc = execFile(player, [tmpFile], { timeout: 30000 }, (error) => {
              if (error) reject(error);
              else resolve();
            });
            proc.on("error", reject);
          });
          break;
        } catch {
          continue;
        }
      }
    }
  } catch (error) {
    logger.warn(`[TTS] Audio playback failed: ${error}`);
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tmpFile).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------

export async function textToSpeech(
  text: string,
  options?: Partial<TtsOptions>,
): Promise<boolean> {
  if (!state.enabled || !text.trim()) return false;

  const opts: TtsOptions = { ...DEFAULT_OPTIONS, ...options };

  state.speaking = true;
  state.currentText = text;

  try {
    // Try API-based TTS first
    const apiSuccess = await speakViaApi(text, opts);
    if (apiSuccess) return true;

    // Fallback: system speech (SSML-based or say command)
    return await speakViaSystem(text);
  } catch (error) {
    logger.warn(`[TTS] Failed: ${error}`);
    return false;
  } finally {
    state.speaking = false;
    state.currentText = "";
    processQueue();
  }
}

async function speakViaSystem(text: string): Promise<boolean> {
  try {
    const { execFile } = await import("child_process");
    const platform = process.platform;

    if (platform === "darwin") {
      // macOS: use `say` command
      const voice = state.voice === "alloy" ? "" : `-v ${state.voice}`;
      await new Promise<void>((resolve, reject) => {
        const proc = execFile("say", [voice, text].filter(Boolean), (error) => {
          if (error) reject(error);
          else resolve();
        });
        proc.on("error", reject);
      });
      return true;
    } else if (platform === "linux") {
      // Linux: try espeak or festival
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = execFile("espeak", [text], { timeout: 60000 }, (error) => {
            if (error) reject(error);
            else resolve();
          });
          proc.on("error", reject);
        });
        return true;
      } catch {
        return false;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------

export function speakResponse(
  text: string,
  options?: Partial<TtsOptions>,
): void {
  if (!state.enabled || !text.trim()) return;

  if (isSpeaking()) {
    state.queue.push(text);
    return;
  }

  textToSpeech(text, options);
}

export function stopSpeaking(): void {
  state.speaking = false;
  state.queue = [];
  state.currentText = "";
}

function processQueue(): void {
  if (state.queue.length > 0 && !state.speaking) {
    const next = state.queue.shift();
    if (next) {
      textToSpeech(next);
    }
  }
}

export function clearTtsQueue(): void {
  state.queue = [];
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initializeTts(): void {
  state.enabled = Boolean(process.env.PAKALON_TTS_ENABLED) || false;
  if (process.env.PAKALON_TTS_VOICE) {
    const voice = process.env.PAKALON_TTS_VOICE as TtsVoice;
    if (AVAILABLE_VOICES.includes(voice)) {
      state.voice = voice;
    }
  }
  logger.info(`[TTS] Initialized (enabled: ${state.enabled}, voice: ${state.voice})`);
}

export default {
  textToSpeech,
  speakResponse,
  stopSpeaking,
  isSpeaking,
  isTtsEnabled,
  setTtsEnabled,
  getTtsState,
  getAvailableVoices,
  setVoice,
  getCurrentVoice,
  clearTtsQueue,
  initializeTts,
};