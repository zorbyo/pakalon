/**
 * Session Environment
 * Detects and manages the environment context for sessions
 */

import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import logger from './logger.js'

export interface EnvironmentInfo {
  platform: NodeJS.Platform
  arch: string
  osVersion: string
  hostname: string
  username: string
  homedir: string
  shell: string
  nodeVersion: string
  isTTY: boolean
  isCI: boolean
  isDocker: boolean
  isWSL: boolean
  terminalType: string
  terminalColumns: number
  terminalRows: number
}

export interface ProjectEnvironment {
  hasGit: boolean
  hasPackageJson: boolean
  hasDockerCompose: boolean
  hasDockerfile: boolean
  hasMakefile: boolean
  hasCargoToml: boolean
  hasPyprojectToml: boolean
  hasGoMod: boolean
  language: DetectedLanguage
  packageManager?: PackageManager
}

export type DetectedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'c'
  | 'cpp'
  | 'ruby'
  | 'php'
  | 'unknown'

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'pipenv' | 'poetry' | 'cargo' | 'go' | 'maven' | 'gradle'

export function getEnvironmentInfo(): EnvironmentInfo {
  const shell = process.env.SHELL || process.env.COMSPEC || 'unknown'
  const isTTY = process.stdout.isTTY || false
  const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS || !!process.env.CIRCLECI

  return {
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    hostname: os.hostname(),
    username: os.userInfo().username,
    homedir: os.homedir(),
    shell,
    nodeVersion: process.version,
    isTTY,
    isCI,
    isDocker: detectDocker(),
    isWSL: detectWSL(),
    terminalType: process.env.TERM || 'unknown',
    terminalColumns: process.stdout.columns || 80,
    terminalRows: process.stdout.rows || 24,
  }
}

export function detectProjectEnvironment(cwd?: string): ProjectEnvironment {
  const projectDir = cwd || process.cwd()

  const hasGit = fs.existsSync(path.join(projectDir, '.git'))
  const hasPackageJson = fs.existsSync(path.join(projectDir, 'package.json'))
  const hasDockerCompose =
    fs.existsSync(path.join(projectDir, 'docker-compose.yml')) ||
    fs.existsSync(path.join(projectDir, 'docker-compose.yaml'))
  const hasDockerfile =
    fs.existsSync(path.join(projectDir, 'Dockerfile')) ||
    fs.existsSync(path.join(projectDir, 'dockerfile'))
  const hasMakefile =
    fs.existsSync(path.join(projectDir, 'Makefile')) ||
    fs.existsSync(path.join(projectDir, 'makefile'))
  const hasCargoToml = fs.existsSync(path.join(projectDir, 'Cargo.toml'))
  const hasPyprojectToml = fs.existsSync(path.join(projectDir, 'pyproject.toml'))
  const hasGoMod = fs.existsSync(path.join(projectDir, 'go.mod'))

  const language = detectLanguage(projectDir, {
    hasPackageJson,
    hasPyprojectToml,
    hasCargoToml,
    hasGoMod,
    hasMakefile,
  })

  const packageManager = detectPackageManager(projectDir, language)

  return {
    hasGit,
    hasPackageJson,
    hasDockerCompose,
    hasDockerfile,
    hasMakefile,
    hasCargoToml,
    hasPyprojectToml,
    hasGoMod,
    language,
    packageManager,
  }
}

function detectLanguage(
  projectDir: string,
  indicators: {
    hasPackageJson: boolean
    hasPyprojectToml: boolean
    hasCargoToml: boolean
    hasGoMod: boolean
    hasMakefile: boolean
  },
): DetectedLanguage {
  if (indicators.hasPackageJson) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'),
      ) as Record<string, unknown>
      const deps = {
        ...(pkg.dependencies as Record<string, unknown>),
        ...(pkg.devDependencies as Record<string, unknown>),
      }
      if (deps.react || deps.next || deps['@types/react']) {
        return 'typescript'
      }
      return 'javascript'
    } catch {
      return 'javascript'
    }
  }

  if (indicators.hasPyprojectToml) return 'python'
  if (indicators.hasCargoToml) return 'rust'
  if (indicators.hasGoMod) return 'go'

  const tsConfig = fs.existsSync(path.join(projectDir, 'tsconfig.json'))
  if (tsConfig) return 'typescript'

  const requirementsTxt = fs.existsSync(path.join(projectDir, 'requirements.txt'))
  if (requirementsTxt) return 'python'

  if (indicators.hasMakefile) {
    const hasCFiles = fs.readdirSync(projectDir).some(f => f.endsWith('.c') || f.endsWith('.h'))
    if (hasCFiles) return 'c'
    const hasCppFiles = fs.readdirSync(projectDir).some(f => f.endsWith('.cpp') || f.endsWith('.hpp'))
    if (hasCppFiles) return 'cpp'
  }

  return 'unknown'
}

function detectPackageManager(projectDir: string, language: DetectedLanguage): PackageManager | undefined {
  switch (language) {
    case 'typescript':
    case 'javascript':
      if (fs.existsSync(path.join(projectDir, 'bun.lockb')) || fs.existsSync(path.join(projectDir, 'bun.lock'))) {
        return 'bun'
      }
      if (fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) {
        return 'pnpm'
      }
      if (fs.existsSync(path.join(projectDir, 'yarn.lock'))) {
        return 'yarn'
      }
      if (fs.existsSync(path.join(projectDir, 'package-lock.json'))) {
        return 'npm'
      }
      return 'npm'

    case 'python':
      if (fs.existsSync(path.join(projectDir, 'poetry.lock'))) {
        return 'poetry'
      }
      if (fs.existsSync(path.join(projectDir, 'Pipfile.lock'))) {
        return 'pipenv'
      }
      return 'pip'

    case 'rust':
      return 'cargo'

    case 'go':
      return 'go'

    default:
      return undefined
  }
}

function detectDocker(): boolean {
  try {
    return fs.existsSync('/.dockerenv')
  } catch {
    return false
  }
}

function detectWSL(): boolean {
  try {
    const release = os.release().toLowerCase()
    return release.includes('microsoft') || release.includes('wsl')
  } catch {
    return false
  }
}

export function getEnvironmentSummary(): string {
  const env = getEnvironmentInfo()
  const project = detectProjectEnvironment()

  return [
    `Platform: ${env.platform} (${env.arch})`,
    `Shell: ${env.shell}`,
    `Node: ${env.nodeVersion}`,
    `Terminal: ${env.terminalType} (${env.terminalColumns}x${env.terminalRows})`,
    `CI: ${env.isCI}`,
    `Docker: ${env.isDocker}`,
    `WSL: ${env.isWSL}`,
    `Project Language: ${project.language}`,
    `Package Manager: ${project.packageManager || 'none'}`,
  ].join('\n')
}
