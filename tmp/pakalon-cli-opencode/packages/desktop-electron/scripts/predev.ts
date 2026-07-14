import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

await $`bun ./scripts/copy-icons.ts ${process.env.PAKALON_CHANNEL ?? "dev"}`

const RUST_TARGET = Bun.env.RUST_TARGET

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../pakalon/dist/${sidecarConfig.ocBinary}/bin/pakalon`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../pakalon && bun run build --single --baseline`
  : $`cd ../pakalon && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
