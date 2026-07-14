import { Log } from "@/util/log"

export const CavemanLog = Log.create({ service: "caveman" })

export type CavemanIntensity =
  | "lite"
  | "full"
  | "ultra"
  | "wenyan-lite"
  | "wenyan"
  | "wenyan-full"
  | "wenyan-ultra"
  | "commit"
  | "review"
  | "off"

export const CAVEMAN_VALID_INTENSITIES: CavemanIntensity[] = [
  "lite",
  "full",
  "ultra",
  "wenyan-lite",
  "wenyan",
  "wenyan-full",
  "wenyan-ultra",
  "commit",
  "review",
  "off",
]

const ARTICLES = ["a", "an", "the"]
const FILLER_WORDS = [
  "just",
  "really",
  "basically",
  "actually",
  "simply",
  "literally",
  "totally",
  "completely",
  "essentially",
  "generally",
]
const PLEASANTRIES = [
  "sure",
  "certainly",
  "of course",
  "i'd be happy to",
  "happy to",
  "glad to",
  "no problem",
  "you're welcome",
  "i'd recommend",
  "of course!",
  "sure thing",
]
const HEDGING = [
  "it might be worth",
  "you could consider",
  "it would be good to",
  "perhaps you should",
  "you may want to",
  "maybe",
  "possibly",
  "it seems like",
  "it looks like",
  "it appears that",
]

const SHORT_SYNONYMS: Record<string, string> = {
  implement: "add",
  utilize: "use",
  facilitate: "help",
  subsequently: "then",
  approximately: "~",
  demonstrate: "show",
  establish: "set up",
  modify: "change",
  configuration: "config",
  application: "app",
  information: "info",
  implementation: "impl",
  development: "dev",
  component: "comp",
  reference: "ref",
  request: "req",
  response: "res",
  function: "fn",
  object: "obj",
  property: "prop",
  database: "DB",
  authentication: "auth",
  connection: "conn",
  parameter: "param",
  attribute: "attr",
  environment: "env",
  variable: "var",
  error: "err",
  exception: "ex",
  previous: "prev",
  current: "curr",
  additional: "extra",
  necessary: "needed",
  possible: "maybe",
  ensure: "make sure",
  attempt: "try",
  obtain: "get",
  regarding: "about",
  concerning: "about",
  additional: "more",
  previous: "prior",
  following: "after",
  determine: "find",
  indicate: "show",
  sufficient: "enough",
  perform: "do",
  execute: "run",
  terminate: "end",
  initiate: "start",
  complete: "finish",
  continue: "keep",
  maintain: "keep",
  identical: "same",
  different: "diff",
  maximum: "max",
  minimum: "min",
  temporary: "temp",
  permanent: "perm",
  automatic: "auto",
  manual: "hand",
}

const WENYAN_MAP: Record<string, string> = {
  component: "組件",
  "re-render": "重繪",
  render: "繪",
  object: "對象",
  reference: "參照",
  because: "以",
  therefore: "故",
  new: "新",
  wrap: "包之",
  use: "用",
  create: "創",
  delete: "刪",
  update: "更新",
  read: "讀",
  write: "寫",
  each: "每",
  every: "每",
}

interface ProtectedContent {
  codeBlocks: string[]
  inlineCode: string[]
  urls: string[]
  paths: string[]
}

function extractProtectedContent(text: string): {
  cleaned: string
  protected: ProtectedContent
} {
  const protectedContent: ProtectedContent = {
    codeBlocks: [],
    inlineCode: [],
    urls: [],
    paths: [],
  }

  let result = text

  result = result.replace(/```[\s\S]*?```/g, (match) => {
    protectedContent.codeBlocks.push(match)
    return `__CODE_BLOCK_${protectedContent.codeBlocks.length - 1}__`
  })

  result = result.replace(/(`{1,2})[^\n]+?\1/g, (match) => {
    protectedContent.inlineCode.push(match)
    return `__INLINE_CODE_${protectedContent.inlineCode.length - 1}__`
  })

  result = result.replace(/https?:\/\/[^\s\)"']+/g, (match) => {
    protectedContent.urls.push(match)
    return `__URL_${protectedContent.urls.length - 1}__`
  })

  result = result.replace(
    /(?:\.\/|\.\.\/|\/|)[a-zA-Z0-9_\-\/\\]+(?:\.[a-zA-Z0-9]+)?/g,
    (match) => {
      if (
        match.includes("/") ||
        match.includes("\\") ||
        match.startsWith("./") ||
        match.startsWith("../")
      ) {
        protectedContent.paths.push(match)
        return `__PATH_${protectedContent.paths.length - 1}__`
      }
      return match
    }
  )

  return { cleaned: result, protected: protectedContent }
}

function restoreProtectedContent(
  text: string,
  protectedContent: ProtectedContent
): string {
  protectedContent.codeBlocks.forEach((block, i) => {
    text = text.replace(`__CODE_BLOCK_${i}__`, block)
  })
  protectedContent.inlineCode.forEach((code, i) => {
    text = text.replace(`__INLINE_CODE_${i}__`, code)
  })
  protectedContent.urls.forEach((url, i) => {
    text = text.replace(`__URL_${i}__`, url)
  })
  protectedContent.paths.forEach((path, i) => {
    text = text.replace(`__PATH_${i}__`, path)
  })
  return text
}

function compressLite(text: string): string {
  let result = text

  for (const word of FILLER_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi")
    result = result.replace(regex, "")
  }

  for (const phrase of HEDGING) {
    result = result.replace(phrase, "", "gi")
  }

  return result.replace(/\s+/g, " ").trim()
}

function compressFull(text: string): string {
  let result = compressLite(text)

  for (const word of ARTICLES) {
    const regex = new RegExp(`\\b${word}\\b\\s*`, "gi")
    result = result.replace(regex, "")
  }

  for (const [long, short] of Object.entries(SHORT_SYNONYMS)) {
    const regex = new RegExp(`\\b${long}\\b`, "gi")
    result = result.replace(regex, short)
  }

  result = result.replace(/\s+/g, " ").trim()

  return result
}

function compressUltra(text: string): string {
  let result = compressFull(text)

  result = result.replace(
    /(\w+)\s+(?:causes?|leads?\s+to|results?\s+in|means?|so)\s+(\w+)/gi,
    "$1 → $2"
  )
  result = result.replace(
    /(\w+)\s+(?:because|since)\s+(\w+)/gi,
    "$1 ← $2"
  )

  result = result.replace(/\bthat is\b/gi, "i.e.")
  result = result.replace(/\bin order to\b/gi, "to")
  result = result.replace(/\bwith the help of\b/gi, "with")
  result = result.replace(/\bit is possible that\b/gi, "maybe")
  result = result.replace(/\bthere is a\b/gi, "there's a")
  result = result.replace(/\bfor example\b/gi, "e.g.")
  result = result.replace(/\bfor instance\b/gi, "e.g.")
  result = result.replace(/\bit is important to note that\b/gi, "")
  result = result.replace(/\bon the other hand\b/gi, "")
  result = result.replace(/\bin contrast\b/gi, "")

  result = result.replace(/\bnew\s+(?:object|reference|instance)\b/gi, "new ref")
  result = result.replace(/\bcreate a new\b/gi, "new")
  result = result.replace(/\bmake sure to\b/gi, "ensure")
  result = result.replace(/\bdue to the fact that\b/gi, "because")
  result = result.replace(/\bin the event that\b/gi, "if")

  result = result.replace(/\s+/g, " ").trim()

  return result
}

function compressWenyanLite(text: string): string {
  let result = compressLite(text)

  for (const [eng, wy] of Object.entries(WENYAN_MAP)) {
    const regex = new RegExp(`\\b${eng}\\b`, "gi")
    result = result.replace(regex, wy)
  }

  return result
}

function compressWenyanFull(text: string): string {
  let result = compressFull(text)

  for (const [eng, wy] of Object.entries(WENYAN_MAP)) {
    const regex = new RegExp(`\\b${eng}\\b`, "gi")
    result = result.replace(regex, wy)
  }

  result = result.replace(/\beach\s+(\w+)/gi, "每$1")

  result = result.replace(/\s+/g, " ").trim()

  return result
}

function compressWenyanUltra(text: string): string {
  let result = compressUltra(text)

  for (const [eng, wy] of Object.entries(WENYAN_MAP)) {
    const regex = new RegExp(`\\b${eng}\\b`, "gi")
    result = result.replace(regex, wy)
  }

  result = result.replace(/\s*→\s*/g, "→")
  result = result.replace(/\s*←\s*/g, "←")

  return result
}

export function compressText(
  text: string,
  intensity: CavemanIntensity
): string {
  if (intensity === "off" || intensity === "commit" || intensity === "review") {
    return text
  }

  if (!text || text.trim().length === 0) {
    return text
  }

  const { cleaned, protected: protectedContent } =
    extractProtectedContent(text)

  let result: string

  switch (intensity) {
    case "lite":
      result = compressLite(cleaned)
      break
    case "full":
      result = compressFull(cleaned)
      break
    case "ultra":
      result = compressUltra(cleaned)
      break
    case "wenyan-lite":
      result = compressWenyanLite(cleaned)
      break
    case "wenyan":
    case "wenyan-full":
      result = compressWenyanFull(cleaned)
      break
    case "wenyan-ultra":
      result = compressWenyanUltra(cleaned)
      break
    default:
      result = cleaned
  }

  result = restoreProtectedContent(result, protectedContent)

  return result
}

const NORMAL_MODE_TRIGGERS = [
  /warning/i,
  /irreversible/i,
  /permanently delete/i,
  /destructive/i,
  /confirm/i,
  /are you sure/i,
  /type\s+["']?yes["']?\s+to\s+confirm/i,
  /cve-/i,
  /security\s+finding/i,
  /breaking\s+change/i,
]

export function shouldUseNormalMode(context: string): boolean {
  return NORMAL_MODE_TRIGGERS.some((trigger) => trigger.test(context))
}

export interface CommitOptions {
  type: string
  scope?: string
  summary: string
  body?: string
  breaking?: boolean
  issues?: string[]
}

export function formatCommitMessage(options: CommitOptions): string {
  const { type, scope, summary, body, breaking, issues } = options

  const scopePrefix = scope ? `(${scope})` : ""
  const breakingMarker = breaking ? "!" : ""
  const subject = `${type}${scopePrefix}${breakingMarker}: ${summary}`.trim()

  const lines: string[] = [subject]

  if (body) {
    lines.push("")
    lines.push(body)
  }

  if (issues && issues.length > 0) {
    const refs = issues
      .map((issue) => {
        if (issue.startsWith("Closes #") || issue.startsWith("Refs #")) {
          return issue
        }
        const num = issue.match(/\d+/)
        if (num) {
          return issue.includes("close") || issue.includes("fix")
            ? `Closes #${num[0]}`
            : `Refs #${num[0]}`
        }
        return issue
      })
      .join(", ")
    lines.push("")
    lines.push(refs)
  }

  const result = lines.join("\n")

  if (result.length > 72) {
    CavemanLog.warn("commit message exceeds 72 chars", {
      length: result.length,
      subject: subject.slice(0, 50),
    })
  }

  return result
}

export interface ReviewComment {
  file?: string
  line: number
  severity: "bug" | "risk" | "nit" | "question"
  problem: string
  fix?: string
}

export function formatReviewComment(comment: ReviewComment): string {
  const { file, line, severity, problem, fix } = comment

  const severityPrefix = {
    bug: "🔴 bug:",
    risk: "🟡 risk:",
    nit: "🔵 nit:",
    question: "❓ q:",
  }[severity]

  const location = file ? `${file}:L${line}` : `L${line}`
  const fixPart = fix ? ` ${fix}.` : ""

  return `${location}: ${severityPrefix} ${problem}.${fixPart}`
}

export function formatReviewComments(comments: ReviewComment[]): string {
  return comments.map(formatReviewComment).join("\n")
}

const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "docs",
  "test",
  "chore",
  "build",
  "ci",
  "style",
  "revert",
]

export function parseDiffForCommit(
  diff: string,
  filePatterns?: string[]
): { type: string; scope?: string; summary: string; body?: string } {
  const lines = diff.split("\n")
  const addedLines = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  const removedLines = lines.filter(
    (l) => l.startsWith("-") && !l.startsWith("---")
  )

  let type = "feat"
  let scope: string | undefined
  let summary = ""
  let body: string | undefined

  if (removedLines.some((l) => l.includes("fix") || l.includes("bug"))) {
    type = "fix"
  } else if (removedLines.some((l) => l.includes("test"))) {
    type = "test"
  } else if (removedLines.some((l) => l.includes("docs") || l.includes("readme"))) {
    type = "docs"
  } else if (removedLines.some((l) => l.includes("refactor"))) {
    type = "refactor"
  } else if (removedLines.some((l) => l.includes("perf") || l.includes("optim"))) {
    type = "perf"
  } else if (removedLines.some((l) => l.includes("chore") || l.includes("maintain"))) {
    type = "chore"
  }

  if (filePatterns && filePatterns.length > 0) {
    const mainFile = filePatterns[0]
      .replace(/^\.\//, "")
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "")
    if (mainFile && mainFile.length > 0 && mainFile.length < 20) {
      scope = mainFile
    }
  }

  const addedFiles = addedLines
    .map((l) => l.replace(/^\+/, ""))
    .filter((l) => l.match(/^[a-zA-Z]/))
    .slice(0, 3)

  if (addedFiles.length > 0) {
    const action =
      type === "fix"
        ? "fix"
        : type === "docs"
          ? "update"
          : type === "test"
            ? "add tests for"
            : "add"
    summary = `${action} ${addedFiles.join(", ")}`
  } else if (removedLines.length > 0) {
    const removedFiles = removedLines
      .map((l) => l.replace(/^-/, ""))
      .filter((l) => l.match(/^[a-zA-Z]/))
      .slice(0, 3)

    if (removedFiles.length > 0) {
      summary = `remove ${removedFiles.join(", ")}`
    }
  }

  if (!summary) {
    summary = type === "fix" ? "fix issues" : type === "feat" ? "add feature" : type
  }

  if (summary.length > 50) {
    summary = summary.slice(0, 47) + "..."
  }

  return { type, scope, summary, body }
}