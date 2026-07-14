import { Log } from "../util/log"
import { Process } from "../util/process"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"

const log = Log.create({ service: "penpot:docker" })

export interface DockerStatus {
  running: boolean
  containers: string[]
  port?: number
}

const PENPOT_CONTAINER_NAME = "pakalon-penpot"
const PENPOT_PORT = 9001

export namespace PenpotDocker {
  let isRunning = false

  export async function start(): Promise<boolean> {
    log.info("starting penpot docker container")

    try {
      const currentStatus = await status()
      if (currentStatus.running) {
        log.info("penpot already running")
        return true
      }

      const composePath = path.join(Global.Path.config, "penpot", "docker-compose.yml")

      if (await Filesystem.exists(composePath)) {
        await Process.run(["docker", "compose", "-f", composePath, "up", "-d"], {
          timeout: 120000,
        })
      } else {
        await Process.run([
          "docker",
          "run",
          "--name",
          PENPOT_CONTAINER_NAME,
          "-d",
          "-p",
          `${PENPOT_PORT}:9001`,
          "penpotapp/penpot:2.11.1",
        ])
      }

      isRunning = true
      log.info("penpot started successfully")
      return true
    } catch (error) {
      log.error("failed to start penpot", { error })
      return false
    }
  }

  export async function stop(): Promise<boolean> {
    log.info("stopping penpot docker container")

    try {
      const currentStatus = await status()
      if (!currentStatus.running) {
        log.info("penpot not running")
        return true
      }

      const composePath = path.join(Global.Path.config, "penpot", "docker-compose.yml")

      if (await Filesystem.exists(composePath)) {
        await Process.run(["docker", "compose", "-f", composePath, "down"], {
          timeout: 60000,
        })
      } else {
        await Process.run(["docker", "stop", PENPOT_CONTAINER_NAME], {
          timeout: 30000,
        })
        await Process.run(["docker", "rm", PENPOT_CONTAINER_NAME], {
          timeout: 10000,
        })
      }

      isRunning = false
      log.info("penpot stopped successfully")
      return true
    } catch (error) {
      log.error("failed to stop penpot", { error })
      return false
    }
  }

  export async function status(): Promise<DockerStatus> {
    try {
      const result = await Process.run([
        "docker",
        "ps",
        "--filter",
        "name=penpot",
        "--format",
        "{{.Names}}",
      ], {
        timeout: 10000,
      })
      const containers = result.stdout
        .toString()
        .split("\n")
        .filter((containerName: string) => containerName.trim().length > 0)
      isRunning = containers.length > 0

      return {
        running: isRunning,
        containers,
        port: isRunning ? PENPOT_PORT : undefined,
      }
    } catch {
      return { running: false, containers: [] }
    }
  }

  export async function restart(): Promise<boolean> {
    await stop()
    return start()
  }

  export function isAvailable(): boolean {
    return isRunning
  }

  export function getURL(): string {
    return `http://localhost:${PENPOT_PORT}`
  }

  export async function waitUntilReady(timeout = 60000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const currentStatus = await status()
      if (currentStatus.running) {
        return true
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    return false
  }
}
