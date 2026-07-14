import path from "path"
import fs from "fs/promises"

export type PatternType =
  | "auth"
  | "database"
  | "api"
  | "frontend"
  | "testing"
  | "security"
  | "deployment"
  | "ci-cd"

export interface CodePattern {
  type: PatternType
  found: boolean
  confidence: number
  details: string[]
  files: string[]
  completeness: number
}

export interface AnalysisResult {
  patterns: CodePattern[]
  completeness: number
  files: number
  sampled: number
}

type Rule = {
  file: RegExp[]
  content: RegExp[]
  signals: { name: string; re: RegExp }[]
}

const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt"])
const SKIP = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".pakalon"])
const LIMIT = 50

const RULES: Record<PatternType, Rule> = {
  auth: {
    file: [/auth/i, /login/i, /register/i, /session/i, /oauth/i, /jwt/i],
    content: [/\bauth\b/i, /login/i, /register/i, /jsonwebtoken|jwt/i, /passport/i, /oauth/i, /session/i],
    signals: [
      { name: "JWT", re: /jsonwebtoken|jwt/i },
      { name: "OAuth", re: /oauth/i },
      { name: "Passport", re: /passport/i },
      { name: "Session", re: /session/i },
      { name: "Auth middleware", re: /middleware.*auth|auth.*middleware/i },
    ],
  },
  database: {
    file: [/db/i, /database/i, /schema/i, /migration/i, /model/i, /prisma/i, /drizzle/i],
    content: [/prisma/i, /drizzle/i, /sequelize/i, /typeorm/i, /mongoose/i, /sql/i, /migration/i, /schema/i],
    signals: [
      { name: "Prisma", re: /prisma/i },
      { name: "Drizzle", re: /drizzle/i },
      { name: "Sequelize", re: /sequelize/i },
      { name: "TypeORM", re: /typeorm/i },
      { name: "Mongoose", re: /mongoose/i },
      { name: "Migrations", re: /migration/i },
    ],
  },
  api: {
    file: [/api/i, /route/i, /router/i, /controller/i, /endpoint/i],
    content: [/express/i, /fastify/i, /hono/i, /router/i, /route/i, /graphql/i, /app\.(get|post|put|delete|patch)/i],
    signals: [
      { name: "Express/Fastify/Hono", re: /express|fastify|hono/i },
      { name: "REST endpoints", re: /app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch)/i },
      { name: "GraphQL", re: /graphql/i },
      { name: "Router", re: /router/i },
    ],
  },
  frontend: {
    file: [/component/i, /page/i, /view/i, /screen/i, /ui/i],
    content: [/react/i, /next/i, /vue/i, /svelte/i, /angular/i, /jsx|tsx/i, /useState|useEffect/i],
    signals: [
      { name: "React", re: /react|useState|useEffect/i },
      { name: "Next.js", re: /next/i },
      { name: "Vue", re: /vue/i },
      { name: "Svelte", re: /svelte/i },
      { name: "UI styling", re: /tailwind|className|css|styled/i },
    ],
  },
  testing: {
    file: [/test/i, /spec/i, /__tests__/i, /vitest/i, /jest/i],
    content: [/describe\(/i, /it\(/i, /test\(/i, /expect\(/i, /jest/i, /vitest/i, /playwright/i, /cypress/i],
    signals: [
      { name: "Jest", re: /jest/i },
      { name: "Vitest", re: /vitest/i },
      { name: "Playwright", re: /playwright/i },
      { name: "Cypress", re: /cypress/i },
      { name: "Test assertions", re: /expect\(/i },
    ],
  },
  security: {
    file: [/security/i, /helmet/i, /csrf/i, /xss/i, /sanitize/i],
    content: [/helmet/i, /cors/i, /csrf/i, /xss/i, /sanitize/i, /validate/i, /rate.?limit/i, /owasp/i],
    signals: [
      { name: "Helmet", re: /helmet/i },
      { name: "CORS", re: /cors/i },
      { name: "CSRF", re: /csrf/i },
      { name: "Input validation", re: /validate|zod|joi|schema/i },
      { name: "Rate limiting", re: /rate.?limit/i },
    ],
  },
  deployment: {
    file: [/dockerfile/i, /docker-compose/i, /deploy/i, /k8s/i, /helm/i, /terraform/i],
    content: [/\bFROM\s+/i, /docker-compose/i, /kubernetes|k8s/i, /helm/i, /terraform/i, /vercel|netlify|render/i],
    signals: [
      { name: "Docker", re: /\bFROM\s+|docker-compose/i },
      { name: "Kubernetes", re: /kubernetes|k8s/i },
      { name: "Helm", re: /helm/i },
      { name: "Terraform", re: /terraform/i },
      { name: "Platform deploy", re: /vercel|netlify|render|fly\.io/i },
    ],
  },
  "ci-cd": {
    file: [/\.github[\\/]workflows/i, /gitlab-ci/i, /jenkinsfile/i, /circleci/i, /pipeline/i],
    content: [/uses:\s*.+actions/i, /workflow_dispatch/i, /jobs:/i, /stages:/i, /pipeline/i],
    signals: [
      { name: "GitHub Actions", re: /uses:\s*.+actions|workflow_dispatch|jobs:/i },
      { name: "GitLab CI", re: /gitlab-ci|stages:/i },
      { name: "Jenkins", re: /Jenkinsfile|pipeline\s*\{/i },
      { name: "CircleCI", re: /circleci/i },
    ],
  },
}

export namespace AuditorAnalysis {
  export async function analyzeCodebase(root: string): Promise<AnalysisResult> {
    const files = await walk(root)
    const sample = files.slice(0, LIMIT)
    const rows = await Promise.all(
      sample.map(async (file) => ({
        file,
        text: await fs.readFile(path.join(root, file), "utf-8").catch(() => ""),
      })),
    )

    const patterns = Object.entries(RULES).map(([k, v]) => build(k as PatternType, v, files, rows))
    return {
      patterns,
      completeness: calculateCompleteness(patterns),
      files: files.length,
      sampled: sample.length,
    }
  }

  export function calculateCompleteness(patterns: CodePattern[]): number {
    const w: Record<PatternType, number> = {
      auth: 15,
      database: 15,
      api: 20,
      frontend: 20,
      testing: 15,
      security: 10,
      deployment: 5,
      "ci-cd": 5,
    }
    const total = Object.values(w).reduce((a, b) => a + b, 0)
    const map = new Map(patterns.map((p) => [p.type, p]))
    const score = (Object.keys(w) as PatternType[])
      .map((k) => ((map.get(k)?.completeness ?? 0) * w[k]) / 100)
      .reduce((a, b) => a + b, 0)
    return Math.round((score / total) * 100)
  }

  function build(type: PatternType, rule: Rule, files: string[], rows: { file: string; text: string }[]): CodePattern {
    const fileHit = files.filter((file) => hit(rule.file, file))
    const textHit = rows.filter((row) => hit(rule.content, row.text)).map((row) => row.file)
    const all = uniq([...fileHit, ...textHit])
    const sig = uniq(
      rule.signals
        .filter((s) => rows.some((r) => s.re.test(r.text)))
        .map((s) => s.name),
    )

    const found = all.length > 0
    const fileScore = Math.min(40, fileHit.length * 8)
    const textScore = Math.min(40, textHit.length * 8)
    const signalScore = Math.min(20, sig.length * 4)
    const confidence = found ? Math.min(100, fileScore + textScore + signalScore) : 0
    const completeness = found ? Math.min(100, Math.round((confidence * 0.7 + sig.length * 6) as number)) : 0

    const details = [
      `name matches: ${fileHit.length}`,
      `content matches: ${textHit.length}`,
      `signals: ${sig.length > 0 ? sig.join(", ") : "none"}`,
    ]

    return {
      type,
      found,
      confidence,
      details,
      files: all.slice(0, 25),
      completeness,
    }
  }

  async function walk(root: string): Promise<string[]> {
    const out: string[] = []

    async function run(dir: string): Promise<void> {
      const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      await Promise.all(
        list.map(async (entry) => {
          if (entry.isDirectory()) {
            if (SKIP.has(entry.name)) return
            return run(path.join(dir, entry.name))
          }
          if (!entry.isFile()) return

          const full = path.join(dir, entry.name)
          const ext = path.extname(entry.name).toLowerCase()
          if (!EXT.has(ext)) return
          out.push(path.relative(root, full))
        }),
      )
    }

    await run(root)
    return out.sort()
  }

  function hit(list: RegExp[], text: string): boolean {
    return list.some((re) => re.test(text))
  }

  function uniq(list: string[]): string[] {
    return [...new Set(list)]
  }
}
