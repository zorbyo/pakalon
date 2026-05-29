/**
 * Terse Mode - Token Optimization System
 *
 * Provides ~65-75% output token reduction through intelligent compression.
 * Supports 6 intensity levels: lite, full, ultra, wenyan-lite, wenyan, wenyan-ultra
 *
 * Compression targets:
 * - Articles: a, an, the
 * - Filler words: just, really, basically, actually, simply
 * - Pleasantries: sure, certainly, of course, happy to, I'd be happy to
 * - Hedging phrases: it might be worth, you could consider, perhaps you should
 */

export type TersenessIntensity = 'lite' | 'full' | 'ultra' | 'wenyan-lite' | 'wenyan' | 'wenyan-ultra' | 'off'

export interface TersenessOptions {
  intensity: TersenessIntensity
  enabled: boolean
}

interface ProtectedContent {
  codeBlocks: string[]
  inlineCode: string[]
  urls: string[]
  paths: string[]
}

const ARTICLES = ['a', 'an', 'the']

const FILLER_WORDS = [
  'just', 'really', 'basically', 'actually', 'simply', 'literally', 'totally',
  'completely', 'essentially', 'generally', 'obviously', 'clearly', 'purely'
]

const PLEASANTRIES = [
  'sure', 'certainly', 'of course', "i'd be happy to", 'happy to', 'glad to',
  'no problem', "you're welcome", "i'd recommend", 'I think', 'I believe',
  'I suppose', 'it seems', 'it appears'
]

const HEDGING = [
  'it might be worth', 'you could consider', 'it would be good to',
  'perhaps you should', 'you may want to', 'maybe', 'possibly', 'probably',
  'it seems like', 'it appears that', 'you might want to', 'it would be nice if'
]

const SHORT_SYNONYMS: Record<string, string> = {
  'implement': 'add',
  'utilize': 'use',
  'facilitate': 'help',
  'subsequently': 'then',
  'approximately': '~',
  'demonstrate': 'show',
  'establish': 'set up',
  'modify': 'change',
  'configuration': 'config',
  'application': 'app',
  'information': 'info',
  'implementation': 'impl',
  'development': 'dev',
  'component': 'comp',
  'reference': 'ref',
  'request': 'req',
  'response': 'res',
  'function': 'fn',
  'object': 'obj',
  'property': 'prop',
  'database': 'DB',
  'authentication': 'auth',
  'connection': 'conn',
  'parameter': 'param',
  'attribute': 'attr',
  'environment': 'env',
  'variable': 'var',
  'error': 'err',
  'exception': 'ex',
  'previous': 'prev',
  'current': 'curr',
  'additional': 'extra',
  'necessary': 'needed',
  'possible': 'maybe',
  'ensure': 'make sure',
  'because': 'due to',
  'therefore': 'so',
  'however': 'but',
  'furthermore': 'also',
  'additionally': 'also',
  'in order to': 'to',
  'with the help of': 'with',
  'it is possible that': 'maybe',
  'there is a': "there's a",
  'for example': 'e.g.',
  'for instance': 'e.g.',
  'that is': "that's",
  'new object reference': 'new ref',
  'create a new': 'new',
}

const WENYAN_MAP: Record<string, string> = {
  'component': '組件',
  're-render': '重繪',
  'object': '對象',
  'reference': '參照',
  'because': '以',
  'therefore': '故',
  'new': '新',
  'wrap': '包之',
  'use': '用',
  'each': '每',
  'function': '函',
  'method': '法',
  'class': '類',
  'file': '檔',
  'code': '碼',
  'error': '誤',
  'bug': '蟲',
  'fix': '修',
  'add': '加',
  'remove': '刪',
  'change': '改',
}

export function extractProtectedContent(text: string): { cleaned: string; protected: ProtectedContent } {
  const protectedContent: ProtectedContent = {
    codeBlocks: [],
    inlineCode: [],
    urls: [],
    paths: []
  }

  let result = text

  result = result.replace(/```[\s\S]*?```/g, (match) => {
    protectedContent.codeBlocks.push(match)
    return `__CODE_BLOCK_${protectedContent.codeBlocks.length - 1}__`
  })

  result = result.replace(/`[^`\n]+`/g, (match) => {
    protectedContent.inlineCode.push(match)
    return `__INLINE_CODE_${protectedContent.inlineCode.length - 1}__`
  })

  result = result.replace(/https?:\/\/[^\s\)"']+/g, (match) => {
    protectedContent.urls.push(match)
    return `__URL_${protectedContent.urls.length - 1}__`
  })

  result = result.replace(/(?:[\.\/]?[a-zA-Z0-9_\-\/\\]+)+\.[a-zA-Z0-9]+/g, (match) => {
    if (match.length > 3 && !match.startsWith('__')) {
      protectedContent.paths.push(match)
      return `__PATH_${protectedContent.paths.length - 1}__`
    }
    return match
  })

  return { cleaned: result, protected: protectedContent }
}

export function restoreProtectedContent(text: string, protectedContent: ProtectedContent): string {
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

  FILLER_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi')
    result = result.replace(regex, '')
  })

  PLEASANTRIES.forEach(phrase => {
    result = result.replace(new RegExp(`\\b${phrase}\\b`, 'gi'), '')
  })

  HEDGING.forEach(phrase => {
    result = result.replace(new RegExp(`\\b${phrase}\\b`, 'gi'), '')
  })

  result = result.replace(/\s+/g, ' ').trim()
  result = result.replace(/\s+([.,!?])/g, '$1')

  return result
}

function compressFull(text: string): string {
  let result = compressLite(text)

  ARTICLES.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b\\s*`, 'gi')
    result = result.replace(regex, '')
  })

  Object.entries(SHORT_SYNONYMS).forEach(([long, short]) => {
    const regex = new RegExp(`\\b${long}\\b`, 'gi')
    result = result.replace(regex, short)
  })

  result = result.replace(/\s+/g, ' ').trim()
  result = result.replace(/\s+([.,!?])/g, '$1')
  result = result.replace(/\b(\w+)\s+\1\s+\1\b/gi, '$1')

  return result
}

function compressUltra(text: string): string {
  let result = compressFull(text)

  result = result.replace(/([\w]+)\s+(?:causes?|leads? to|results? in|means?|so)\s+([\w]+)/gi, '$1 → $2')
  result = result.replace(/([\w]+)\s+(?:because|since)\s+([\w]+)/gi, '$1 ← $2')

  result = result.replace(/\bnew\s+(?:object|reference|instance)\b/gi, 'new ref')
  result = result.replace(/\bcreate a new\b/gi, 'new')
  result = result.replace(/\bmake sure to\b/gi, 'ensure')

  result = result.replace(/\s+/g, ' ').trim()
  result = result.replace(/\s+([.,!?])/g, '$1')

  result = result.replace(/\b(\w+) each\b/gi, '每$1')

  return result
}

function compressWenyanLite(text: string): string {
  let result = compressLite(text)

  Object.entries(WENYAN_MAP).forEach(([eng, wy]) => {
    const regex = new RegExp(`\\b${eng}\\b`, 'gi')
    result = result.replace(regex, wy)
  })

  return result
}

function compressWenyanFull(text: string): string {
  let result = compressFull(text)

  Object.entries(WENYAN_MAP).forEach(([eng, wy]) => {
    const regex = new RegExp(`\\b${eng}\\b`, 'gi')
    result = result.replace(regex, wy)
  })

  result = result.replace(/\b(\w+) each\b/gi, '每$1')

  return result
}

function compressWenyanUltra(text: string): string {
  let result = compressUltra(text)

  Object.entries(WENYAN_MAP).forEach(([eng, wy]) => {
    const regex = new RegExp(`\\b${eng}\\b`, 'gi')
    result = result.replace(regex, wy)
  })

  result = result.replace(/ → /gi, '→')
  result = result.replace(/ ← /gi, '←')

  return result
}

export function compressText(text: string, intensity: TersenessIntensity): string {
  if (intensity === 'off') return text

  const { cleaned, protected: protectedContent } = extractProtectedContent(text)

  let result: string

  switch (intensity) {
    case 'lite':
      result = compressLite(cleaned)
      break
    case 'full':
      result = compressFull(cleaned)
      break
    case 'ultra':
      result = compressUltra(cleaned)
      break
    case 'wenyan-lite':
      result = compressWenyanLite(cleaned)
      break
    case 'wenyan':
      result = compressWenyanFull(cleaned)
      break
    case 'wenyan-ultra':
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
  /type "yes" to confirm/i,
  /cve-/i,
  /security finding/i,
  /danger/i,
  /critical/i,
]

export function shouldUseNormalMode(context: string): boolean {
  return NORMAL_MODE_TRIGGERS.some(trigger => trigger.test(context))
}

export const SEVERITY_PREFIXES = {
  bug: '[Red] bug:',
  risk: '[Yellow] risk:',
  nit: '[Blue] nit:',
  question: '? q:',
}

export function formatCodeReviewLine(line: number, severity: keyof typeof SEVERITY_PREFIXES, problem: string, fix: string): string {
  return `L${line}: ${SEVERITY_PREFIXES[severity]} ${problem}. ${fix}.`
}

export function formatCodeReviewMultiFile(file: string, line: number, severity: keyof typeof SEVERITY_PREFIXES, problem: string, fix: string): string {
  return `${file}:L${line}: ${SEVERITY_PREFIXES[severity]} ${problem}. ${fix}.`
}

export function estimateCompressionRatio(intensity: TersenessIntensity): number {
  switch (intensity) {
    case 'lite': return 0.15
    case 'full': return 0.25
    case 'ultra': return 0.35
    case 'wenyan-lite': return 0.30
    case 'wenyan': return 0.45
    case 'wenyan-ultra': return 0.55
    default: return 0
  }
}