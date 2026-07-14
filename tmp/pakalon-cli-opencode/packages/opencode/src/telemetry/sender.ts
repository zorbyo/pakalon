import { Log } from "../util/log"
import { MachineId } from "./machine-id"
import { TelemetryEvents, type TelemetryEvent } from "./events"

const log = Log.create({ service: "telemetry:sender" })

export namespace TelemetrySender {
  const TELEMETRY_URL = process.env.PAKALON_TELEMETRY_URL ?? ""
  let enabled = true

  export function setEnabled(val: boolean): void {
    enabled = val
    log.info("telemetry", { enabled: val })
  }

  export function isEnabled(): boolean {
    return enabled && TELEMETRY_URL.length > 0
  }

  export async function sendBatch(): Promise<void> {
    if (!isEnabled()) return
    const events = TelemetryEvents.list()
    if (events.length === 0) return

    const machineId = await MachineId.get()
    const payload = {
      machineId,
      events,
      timestamp: Date.now(),
    }

    try {
      await fetch(TELEMETRY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      TelemetryEvents.clear()
      log.info("sent telemetry batch", { count: events.length })
    } catch {
      log.warn("failed to send telemetry batch")
    }
  }

  export async function send(event: TelemetryEvent): Promise<void> {
    if (!isEnabled()) return
    const machineId = await MachineId.get()
    try {
      await fetch(TELEMETRY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, event }),
      })
    } catch {
      log.warn("failed to send telemetry event", { type: event.type })
    }
  }
}
