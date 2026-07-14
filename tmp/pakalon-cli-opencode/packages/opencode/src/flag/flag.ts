function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

// Helper for backward compatibility: check PAKALON_* first, then fall back to OPENCODE_*
function truthyWithFallback(pakalonKey: string, opencodeKey: string) {
  const pakalonValue = process.env[pakalonKey]?.toLowerCase()
  if (pakalonValue === "true" || pakalonValue === "1") return true
  if (pakalonValue === "false" || pakalonValue === "0") return false
  const opencodeValue = process.env[opencodeKey]?.toLowerCase()
  return opencodeValue === "true" || opencodeValue === "1"
}

function stringWithFallback(pakalonKey: string, opencodeKey: string) {
  return process.env[pakalonKey] ?? process.env[opencodeKey]
}

export namespace Flag {
  export const PAKALON_AUTO_SHARE = truthy("PAKALON_AUTO_SHARE")
  export const PAKALON_GIT_BASH_PATH = process.env["PAKALON_GIT_BASH_PATH"]
  export const PAKALON_CONFIG = process.env["PAKALON_CONFIG"]
  export declare const PAKALON_TUI_CONFIG: string | undefined
  export declare const PAKALON_CONFIG_DIR: string | undefined
  export const PAKALON_CONFIG_CONTENT = process.env["PAKALON_CONFIG_CONTENT"]
  export const PAKALON_DISABLE_AUTOUPDATE = truthy("PAKALON_DISABLE_AUTOUPDATE")
  export const PAKALON_DISABLE_PRUNE = truthy("PAKALON_DISABLE_PRUNE")
  export const PAKALON_DISABLE_TERMINAL_TITLE = truthy("PAKALON_DISABLE_TERMINAL_TITLE")
  export const PAKALON_PERMISSION = process.env["PAKALON_PERMISSION"]
  export const PAKALON_DISABLE_DEFAULT_PLUGINS = truthy("PAKALON_DISABLE_DEFAULT_PLUGINS")
  export const PAKALON_DISABLE_LSP_DOWNLOAD = truthy("PAKALON_DISABLE_LSP_DOWNLOAD")
  export const PAKALON_ENABLE_EXPERIMENTAL_MODELS = truthy("PAKALON_ENABLE_EXPERIMENTAL_MODELS")
  export const PAKALON_DISABLE_AUTOCOMPACT = truthy("PAKALON_DISABLE_AUTOCOMPACT")
  export const PAKALON_DISABLE_MODELS_FETCH = truthy("PAKALON_DISABLE_MODELS_FETCH")
  export const PAKALON_DISABLE_CLAUDE_CODE = truthy("PAKALON_DISABLE_CLAUDE_CODE")
  export const PAKALON_DISABLE_CLAUDE_CODE_PROMPT =
    PAKALON_DISABLE_CLAUDE_CODE || truthy("PAKALON_DISABLE_CLAUDE_CODE_PROMPT")
  export const PAKALON_DISABLE_CLAUDE_CODE_SKILLS =
    PAKALON_DISABLE_CLAUDE_CODE || truthy("PAKALON_DISABLE_CLAUDE_CODE_SKILLS")
  export const PAKALON_DISABLE_EXTERNAL_SKILLS =
    PAKALON_DISABLE_CLAUDE_CODE_SKILLS || truthy("PAKALON_DISABLE_EXTERNAL_SKILLS")
  export declare const PAKALON_DISABLE_PROJECT_CONFIG: boolean
  export const PAKALON_FAKE_VCS = process.env["PAKALON_FAKE_VCS"]
  export declare const PAKALON_CLIENT: string
  export const PAKALON_SERVER_PASSWORD = process.env["PAKALON_SERVER_PASSWORD"]
  export const PAKALON_SERVER_USERNAME = process.env["PAKALON_SERVER_USERNAME"]
  export const PAKALON_ENABLE_QUESTION_TOOL = truthy("PAKALON_ENABLE_QUESTION_TOOL")

  // Experimental
  export const PAKALON_EXPERIMENTAL = truthy("PAKALON_EXPERIMENTAL")
  export const PAKALON_EXPERIMENTAL_FILEWATCHER = truthy("PAKALON_EXPERIMENTAL_FILEWATCHER")
  export const PAKALON_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("PAKALON_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const PAKALON_EXPERIMENTAL_ICON_DISCOVERY =
    PAKALON_EXPERIMENTAL || truthy("PAKALON_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["PAKALON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const PAKALON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("PAKALON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const PAKALON_ENABLE_EXA =
    truthy("PAKALON_ENABLE_EXA") || PAKALON_EXPERIMENTAL || truthy("PAKALON_EXPERIMENTAL_EXA")
  export const PAKALON_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("PAKALON_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const PAKALON_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("PAKALON_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const PAKALON_EXPERIMENTAL_OXFMT = PAKALON_EXPERIMENTAL || truthy("PAKALON_EXPERIMENTAL_OXFMT")
  export const PAKALON_EXPERIMENTAL_LSP_TY = truthy("PAKALON_EXPERIMENTAL_LSP_TY")
  export const PAKALON_EXPERIMENTAL_LSP_TOOL = PAKALON_EXPERIMENTAL || truthy("PAKALON_EXPERIMENTAL_LSP_TOOL")
  export const PAKALON_DISABLE_FILETIME_CHECK = truthy("PAKALON_DISABLE_FILETIME_CHECK")
  export const PAKALON_EXPERIMENTAL_PLAN_MODE = PAKALON_EXPERIMENTAL || truthy("PAKALON_EXPERIMENTAL_PLAN_MODE")
  export const PAKALON_EXPERIMENTAL_WORKSPACES = PAKALON_EXPERIMENTAL || truthy("PAKALON_EXPERIMENTAL_WORKSPACES")
  export const PAKALON_EXPERIMENTAL_MARKDOWN = !falsy("PAKALON_EXPERIMENTAL_MARKDOWN")
  export const PAKALON_MODELS_URL = process.env["PAKALON_MODELS_URL"]
  export const PAKALON_MODELS_PATH = process.env["PAKALON_MODELS_PATH"]
  export const PAKALON_DISABLE_CHANNEL_DB = truthy("PAKALON_DISABLE_CHANNEL_DB")
  export const PAKALON_SKIP_MIGRATIONS = truthy("PAKALON_SKIP_MIGRATIONS")
  export const PAKALON_STRICT_CONFIG_DEPS = truthy("PAKALON_STRICT_CONFIG_DEPS")

  // Streamer mode: hide model names and quota for recording
  export const PAKALON_STREAMER_MODE = truthy("PAKALON_STREAMER_MODE")
  // Beep on attention
  export const PAKALON_BEEP_ON_ATTENTION = truthy("PAKALON_BEEP_ON_ATTENTION")

  // Pakalon Backend
  export const PAKALON_BACKEND_URL = process.env["PAKALON_BACKEND_URL"] || "http://localhost:8000"
  const backendToggle = process.env["PAKALON_ENABLE_BACKEND"]
  export const PAKALON_ENABLE_BACKEND = backendToggle === undefined ? true : truthy("PAKALON_ENABLE_BACKEND")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for PAKALON_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "PAKALON_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("PAKALON_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for PAKALON_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "PAKALON_TUI_CONFIG", {
  get() {
    return process.env["PAKALON_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for PAKALON_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "PAKALON_CONFIG_DIR", {
  get() {
    return process.env["PAKALON_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for PAKALON_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "PAKALON_CLIENT", {
  get() {
    return process.env["PAKALON_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

// Backward compatibility aliases for OPENCODE_* flags
// These delegate to PAKALON_* equivalents
Object.defineProperty(Flag, "OPENCODE_TUI_CONFIG", {
  get() {
    return Flag.PAKALON_TUI_CONFIG
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return Flag.PAKALON_DISABLE_PROJECT_CONFIG
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_CONFIG_DIR", {
  get() {
    return Flag.PAKALON_CONFIG_DIR
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_SERVER_PASSWORD", {
  get() {
    return Flag.PAKALON_SERVER_PASSWORD
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_SERVER_USERNAME", {
  get() {
    return Flag.PAKALON_SERVER_USERNAME
  },
  enumerable: true,
  configurable: false,
})

// Static OPENCODE_* aliases for backward compatibility
Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_FILEWATCHER", {
  get() {
    return Flag.PAKALON_EXPERIMENTAL_FILEWATCHER
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER", {
  get() {
    return Flag.PAKALON_EXPERIMENTAL_DISABLE_FILEWATCHER
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_DISABLE_FILETIME_CHECK", {
  get() {
    return Flag.PAKALON_DISABLE_FILETIME_CHECK
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_WORKSPACES", {
  get() {
    return Flag.PAKALON_EXPERIMENTAL_WORKSPACES
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_DISABLE_AUTOUPDATE", {
  get() {
    return Flag.PAKALON_DISABLE_AUTOUPDATE
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_PLAN_MODE", {
  get() {
    return Flag.PAKALON_EXPERIMENTAL_PLAN_MODE
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_DISABLE_LSP_DOWNLOAD", {
  get() {
    return Flag.PAKALON_DISABLE_LSP_DOWNLOAD
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_LSP_TY", {
  get() {
    return Flag.PAKALON_EXPERIMENTAL_LSP_TY
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX", {
  get() {
    return Flag.PAKALON_EXPERIMENTAL_OUTPUT_TOKEN_MAX
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_TERMINAL", {
  get() {
    return "1"
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_LIBC", {
  get() {
    return process.env["OPENCODE_LIBC"]
  },
  enumerable: true,
  configurable: false,
})
