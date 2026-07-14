import { MachineId } from "./machine-id"
import { TelemetryEvents } from "./events"
import { TelemetrySender } from "./sender"
import { Log } from "../util/log"

const log = Log.create({ service: "telemetry" })

export namespace Telemetry {
  export async function init(): Promise<void> {
    await MachineId.get()
    log.info("telemetry system initialized")
  }

  export function setEnabled(val: boolean): void {
    TelemetrySender.setEnabled(val)
  }

  export async function flush(): Promise<void> {
    await TelemetrySender.sendBatch()
  }
}

export { MachineId } from "./machine-id"
export { TelemetryEvents } from "./events"
export { TelemetrySender } from "./sender"
