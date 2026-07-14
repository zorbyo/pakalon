import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForHealth(url: string) {
  const timeout = Date.now() + 120_000
  const errors: string[] = []
  while (Date.now() < timeout) {
    const result = await fetch(url)
      .then((r) => ({ ok: r.ok, error: undefined }))
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    if (result.ok) return
    if (result.error) errors.push(result.error)
    await new Promise((r) => setTimeout(r, 250))
  }
  const last = errors.length ? ` (last error: ${errors[errors.length - 1]})` : ""
  throw new Error(`Timed out waiting for server health: ${url}${last}`)
}

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const pakalonDir = path.join(repoDir, "packages", "pakalon")

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

const [serverPort, webPort] = await Promise.all([freePort(), freePort()])

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "pakalon-e2e-"))
const keepSandbox = process.env.PAKALON_E2E_KEEP_SANDBOX === "1"

const serverEnv = {
  ...process.env,
  PAKALON_DISABLE_SHARE: process.env.PAKALON_DISABLE_SHARE ?? "true",
  PAKALON_DISABLE_LSP_DOWNLOAD: "true",
  PAKALON_DISABLE_DEFAULT_PLUGINS: "true",
  PAKALON_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
  PAKALON_TEST_HOME: path.join(sandbox, "home"),
  XDG_DATA_HOME: path.join(sandbox, "share"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_CONFIG_HOME: path.join(sandbox, "config"),
  XDG_STATE_HOME: path.join(sandbox, "state"),
  PAKALON_E2E_PROJECT_DIR: repoDir,
  PAKALON_E2E_SESSION_TITLE: "E2E Session",
  PAKALON_E2E_MESSAGE: "Seeded for UI e2e",
  PAKALON_E2E_MODEL: "pakalon/gpt-5-nano",
  PAKALON_CLIENT: "app",
  PAKALON_STRICT_CONFIG_DEPS: "true",
} satisfies Record<string, string>

const runnerEnv = {
  ...serverEnv,
  PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_PAKALON_SERVER_HOST: "127.0.0.1",
  VITE_PAKALON_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
} satisfies Record<string, string>

let seed: ReturnType<typeof Bun.spawn> | undefined
let runner: ReturnType<typeof Bun.spawn> | undefined
let server: { stop: () => Promise<void> | void } | undefined
let inst: { Instance: { disposeAll: () => Promise<void> | void } } | undefined
let cleaned = false

const cleanup = async () => {
  if (cleaned) return
  cleaned = true

  if (seed && seed.exitCode === null) seed.kill("SIGTERM")
  if (runner && runner.exitCode === null) runner.kill("SIGTERM")

  const jobs = [
    inst?.Instance.disposeAll(),
    server?.stop(),
    keepSandbox ? undefined : fs.rm(sandbox, { recursive: true, force: true }),
  ].filter(Boolean)
  await Promise.allSettled(jobs)
}

const shutdown = (code: number, reason: string) => {
  process.exitCode = code
  void cleanup().finally(() => {
    console.error(`e2e-local shutdown: ${reason}`)
    process.exit(code)
  })
}

const reportInternalError = (reason: string, error: unknown) => {
  console.warn(`e2e-local ignored server error: ${reason}`)
  console.warn(error)
}

process.once("SIGINT", () => shutdown(130, "SIGINT"))
process.once("SIGTERM", () => shutdown(143, "SIGTERM"))
process.once("SIGHUP", () => shutdown(129, "SIGHUP"))
process.once("uncaughtException", (error) => {
  reportInternalError("uncaughtException", error)
})
process.once("unhandledRejection", (error) => {
  reportInternalError("unhandledRejection", error)
})

let code = 1

try {
  seed = Bun.spawn(["bun", "script/seed-e2e.ts"], {
    cwd: pakalonDir,
    env: serverEnv,
    stdout: "inherit",
    stderr: "inherit",
  })

  const seedExit = await seed.exited
  if (seedExit !== 0) {
    code = seedExit
  } else {
    Object.assign(process.env, serverEnv)
    process.env.AGENT = "1"
    process.env.PAKALON = "1"
    process.env.PAKALON_PID = String(process.pid)

    const log = await import("../../pakalon/src/util/log")
    const install = await import("../../pakalon/src/installation")
    await log.Log.init({
      print: true,
      dev: install.Installation.isLocal(),
      level: "WARN",
    })

    const servermod = await import("../../pakalon/src/server/server")
    inst = await import("../../pakalon/src/project/instance")
    server = servermod.Server.listen({ port: serverPort, hostname: "127.0.0.1" })
    console.log(`pakalon server listening on http://127.0.0.1:${serverPort}`)

    await waitForHealth(`http://127.0.0.1:${serverPort}/global/health`)
    runner = Bun.spawn(["bun", "test:e2e", ...extraArgs], {
      cwd: appDir,
      env: runnerEnv,
      stdout: "inherit",
      stderr: "inherit",
    })
    code = await runner.exited
  }
} catch (error) {
  console.error(error)
  code = 1
} finally {
  await cleanup()
}

process.exit(code)
