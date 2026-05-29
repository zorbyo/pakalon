import * as fs from 'fs'
import * as path from 'path'

const KEYTERMS_CACHE_KEY = 'voice_keyterms'
const CACHE_TTL_MS = 5 * 60 * 1000

interface KeytermsCache {
  terms: string[]
  timestamp: number
}

let cache: KeytermsCache | null = null

function getCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME ?? path.join(process.env.HOME ?? '', '.cache', 'pakalon')
  const dir = path.join(base, 'voice')
  return dir
}

function getCachePath(): string {
  return path.join(getCacheDir(), 'keyterms.json')
}

function readCache(): KeytermsCache | null {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8')
    const parsed = JSON.parse(raw) as KeytermsCache
    if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
      return parsed
    }
  } catch {
    // Cache miss or stale
  }
  return null
}

function writeCache(terms: string[]): void {
  try {
    const dir = getCacheDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(
      getCachePath(),
      JSON.stringify({ terms, timestamp: Date.now() } satisfies KeytermsCache),
      'utf-8',
    )
  } catch {
    // Best effort
  }
}

function collectProjectKeyterms(): string[] {
  const terms = new Set<string>()

  const cwd = process.cwd()

  const packageJsonPath = path.join(cwd, 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>
    const deps = {
      ...((pkg.dependencies ?? {}) as Record<string, unknown>),
      ...((pkg.devDependencies ?? {}) as Record<string, unknown>),
    }
    for (const name of Object.keys(deps)) {
      const clean = name.replace(/^[@/]/, '').replace(/[-_]/g, ' ')
      terms.add(clean.toLowerCase())
    }
    if (typeof pkg.name === 'string') {
      terms.add(pkg.name.toLowerCase())
    }
  } catch {
    // No package.json or parse error
  }

  const tsconfigPath = path.join(cwd, 'tsconfig.json')
  try {
    const tsconfig = JSON.parse(
      fs.readFileSync(tsconfigPath, 'utf-8').replace(/\/\/.*$/gm, ''),
    ) as Record<string, unknown>
    if (typeof tsconfig.compilerOptions?.target === 'string') {
      terms.add(tsconfig.compilerOptions.target.toLowerCase())
    }
  } catch {
    // No tsconfig or parse error
  }

  for (const fileName of ['README.md', 'CLAUDE.md', 'AGENTS.md', '.pakalon/plan.md']) {
    const filePath = path.join(cwd, fileName)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const words = content
        .split(/\s+/)
        .map(w => w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
        .filter(w => w.length > 3 && w.length < 30)
      for (const word of words) {
        terms.add(word)
      }
    } catch {
      // File doesn't exist
    }
  }

  return Array.from(terms).slice(0, 200)
}

export async function getVoiceKeyterms(): Promise<string[]> {
  const cached = readCache()
  if (cached) return cached.terms

  const terms = collectProjectKeyterms()
  writeCache(terms)
  return terms
}

export function clearVoiceKeytermsCache(): void {
  cache = null
  try {
    fs.unlinkSync(getCachePath())
  } catch {
    // Ignore
  }
}
