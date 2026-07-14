import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { RGBA } from "@opentui/core"

type LoadingAnimationProps = {
  active?: boolean
  color: RGBA
  interval?: number
  size?: "normal" | "small" | "tiny"
}

const FRAMES = ["◐", "◓", "◑", "◒"] as const

export function LoadingAnimation(props: LoadingAnimationProps) {
  const [frameIndex, setFrameIndex] = createSignal(0)
  const interval = createMemo(() => Math.max(60, props.interval ?? 90))

  createEffect(() => {
    if (!props.active) {
      setFrameIndex(0)
      return
    }

    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % FRAMES.length)
    }, interval())

    onCleanup(() => clearInterval(timer))
  })

  return <text fg={props.color}>{FRAMES[frameIndex()]}</text>
}
