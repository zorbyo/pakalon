import z from "zod"
import { EOL } from "os"
import { NamedError } from "@pakalon-ai/util/error"
import { pakalonCliLogo, pakalonLogo, pakalonCliLogoCompact, pakalonLogoCompact, pakalonCliLogoTiny, pakalonLogoTiny, getTerminalSize, type TerminalSize } from "./logo"
import { RGBA } from "@opentui/core"

export const ACCENT = RGBA.fromHex("#E8AA41")

export namespace UI {
  export const CancelledError = NamedError.create("UICancelledError", z.void())

  export const Style = {
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
    TEXT_DIM: "\x1b[90m",
    TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
    TEXT_NORMAL: "\x1b[0m",
    TEXT_NORMAL_BOLD: "\x1b[1m",
    TEXT_WARNING: "\x1b[93m",
    TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
    TEXT_DANGER: "\x1b[91m",
    TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
    TEXT_INFO: "\x1b[94m",
    TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  }

  export function println(...message: string[]) {
    print(...message)
    process.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    process.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  export function logo(pad?: string, forceSize?: TerminalSize) {
    const reset = "\x1b[0m"
    const fg = Style.TEXT_NORMAL_BOLD
    const size = forceSize ?? getTerminalSize()
    
    let logoArray: string[]
    switch (size) {
      case "tiny":
        logoArray = pakalonCliLogoTiny
        break
      case "small":
      case "medium":
        logoArray = pakalonCliLogoCompact
        break
      case "large":
      default:
        logoArray = pakalonCliLogo
        break
    }
    
    return logoArray.map((line) => `${pad ?? ""}${fg}${line}${reset}`).join(EOL)
  }

  export async function input(prompt: string): Promise<string> {
    const readline = require("readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  export function pakalon(forceSize?: TerminalSize): string {
    const indigo = "\x1b[38;5;99m"
    const reset = "\x1b[0m"
    const dim = "\x1b[90m"
    const size = forceSize ?? getTerminalSize()
    
    let logoStr: string
    switch (size) {
      case "tiny":
        logoStr = pakalonLogoTiny
        break
      case "small":
      case "medium":
        logoStr = pakalonLogoCompact
        break
      case "large":
      default:
        logoStr = pakalonLogo
        break
    }
    
    return logoStr
      .split("\n")
      .map((line) => {
        if (line.includes("PAKALON") || line.includes("████")) {
          return indigo + line + reset
        }
        if (line.includes("AI-Powered") || line.includes("v1.") || line.includes("Pipeline")) {
          return dim + line + reset
        }
        return line
      })
      .join("\n")
  }

  export function error(message: string) {
    if (message.startsWith("Error: ")) {
      message = message.slice("Error: ".length)
    }
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}
