/**
 * Voice Mode System
 *
 * Voice input handling for the CLI with speech-to-text capabilities.
 * Requires authentication and feature flag checks.
 */

import { Config } from "../config/config"
import { Log } from "../util/log"

/**
 * Voice mode state
 */
export interface VoiceState {
  enabled: boolean
  listening: boolean
  processing: boolean
  lastTranscript: string
  error: string | null
}

/**
 * Voice configuration
 */
export interface VoiceConfig {
  language?: string
  continuous?: boolean
  interimResults?: boolean
  maxAlternatives?: number
}

/**
 * Creates initial voice state
 */
export function createInitialVoiceState(): VoiceState {
  return {
    enabled: false,
    listening: false,
    processing: false,
    lastTranscript: "",
    error: null,
  }
}

/**
 * Check if voice mode is enabled via feature flag
 * In production this would check GrowthBook or similar feature flag service
 */
export function isVoiceGrowthBookEnabled(): boolean {
  // For now, check config setting
  const config = Config.get()
  const disabled = config.get("voice_disabled")
  return disabled !== true
}

/**
 * Check if user has valid voice authentication
 * Voice mode requires OAuth authentication
 */
export function hasVoiceAuth(): boolean {
  // Check if user is authenticated with OAuth
  const config = Config.get()
  const authProvider = config.get("auth_provider")

  // Voice mode requires Anthropic OAuth
  if (authProvider !== "anthropic") {
    return false
  }

  // Check for valid access token
  const accessToken = config.get("access_token")
  return Boolean(accessToken)
}

/**
 * Full runtime check: auth + feature flag
 * Use this for command-time paths where a fresh check is acceptable
 */
export function isVoiceModeEnabled(): boolean {
  return hasVoiceAuth() && isVoiceGrowthBookEnabled()
}

/**
 * Voice Service for handling voice input/output
 */
export class VoiceService {
  private state: VoiceState
  private config: VoiceConfig
  private onTranscript?: (transcript: string) => void
  private onError?: (error: Error) => void

  constructor(config: VoiceConfig = {}) {
    this.state = createInitialVoiceState()
    this.config = {
      language: "en-US",
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
      ...config,
    }
  }

  /**
   * Initialize voice service
   */
  async initialize(): Promise<boolean> {
    if (!isVoiceModeEnabled()) {
      Log.info("Voice mode is not enabled")
      return false
    }

    this.state.enabled = true
    return true
  }

  /**
   * Start listening for voice input
   */
  async startListening(): Promise<void> {
    if (!this.state.enabled) {
      throw new Error("Voice service not initialized")
    }

    if (this.state.listening) {
      return
    }

    this.state.listening = true
    this.state.error = null

    Log.info("Voice listening started")
    // In a full implementation, this would connect to a voice stream endpoint
  }

  /**
   * Stop listening for voice input
   */
  async stopListening(): Promise<void> {
    if (!this.state.listening) {
      return
    }

    this.state.listening = false
    Log.info("Voice listening stopped")
  }

  /**
   * Process voice transcript
   */
  processTranscript(transcript: string): void {
    this.state.lastTranscript = transcript
    this.state.processing = true

    if (this.onTranscript) {
      this.onTranscript(transcript)
    }

    this.state.processing = false
  }

  /**
   * Set transcript callback
   */
  setOnTranscript(callback: (transcript: string) => void): void {
    this.onTranscript = callback
  }

  /**
   * Set error callback
   */
  setOnError(callback: (error: Error) => void): void {
    this.onError = callback
  }

  /**
   * Get current state
   */
  getState(): VoiceState {
    return { ...this.state }
  }

  /**
   * Handle error
   */
  handleError(error: Error): void {
    this.state.error = error.message
    this.state.listening = false
    this.state.processing = false

    if (this.onError) {
      this.onError(error)
    }

    Log.error("Voice error:", error.message)
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.stopListening()
    this.state = createInitialVoiceState()
  }
}

/**
 * Voice context for React hooks
 */
export interface VoiceContext {
  state: VoiceState
  service: VoiceService
  startListening: () => Promise<void>
  stopListening: () => Promise<void>
  toggle: () => Promise<void>
}

/**
 * Create voice context
 */
export function createVoiceContext(config?: VoiceConfig): VoiceContext {
  const service = new VoiceService(config)

  return {
    state: service.getState(),
    service,
    startListening: () => service.startListening(),
    stopListening: () => service.stopListening(),
    toggle: async () => {
      const state = service.getState()
      if (state.listening) {
        await service.stopListening()
      } else {
        await service.startListening()
      }
    },
  }
}

/**
 * Voice keyterms for command recognition
 */
export const VOICE_KEYTERMS = {
  // Command triggers
  commands: [
    "hey claude",
    "okay claude",
    "claude",
    "assistant",
    "hey assistant",
  ],

  // Action keywords
  actions: {
    run: ["run", "execute", "perform", "do"],
    stop: ["stop", "cancel", "abort", "quit"],
    help: ["help", "assist", "what can you do"],
    clear: ["clear", "reset", "start over"],
    undo: ["undo", "go back", "revert"],
    save: ["save", "keep", "store"],
    copy: ["copy", "clipboard"],
    paste: ["paste", "insert"],
  },

  // Confirmation keywords
  confirmation: {
    yes: ["yes", "yeah", "yep", "correct", "confirm", "okay", "ok"],
    no: ["no", "nope", "cancel", "never mind", "wrong"],
  },
}

/**
 * Match voice input against keyterms
 */
export function matchVoiceKeyterm(
  input: string,
  category: keyof typeof VOICE_KEYTERMS.actions
): boolean {
  const terms = VOICE_KEYTERMS.actions[category]
  if (!terms) return false

  const normalized = input.toLowerCase().trim()
  return terms.some((term) => normalized.includes(term))
}

/**
 * Check if input starts with a command trigger
 */
export function isCommandTrigger(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  return VOICE_KEYTERMS.commands.some((trigger) =>
    normalized.startsWith(trigger)
  )
}

/**
 * Extract command from voice input
 */
export function extractVoiceCommand(input: string): string {
  const normalized = input.toLowerCase().trim()

  for (const trigger of VOICE_KEYTERMS.commands) {
    if (normalized.startsWith(trigger)) {
      return normalized.slice(trigger.length).trim()
    }
  }

  return normalized
}

export default {
  VoiceService,
  isVoiceModeEnabled,
  isVoiceGrowthBookEnabled,
  hasVoiceAuth,
  createVoiceContext,
  VOICE_KEYTERMS,
  matchVoiceKeyterm,
  isCommandTrigger,
  extractVoiceCommand,
}
