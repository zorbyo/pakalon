import { createMemo } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useLocal } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"

const DEFAULT_EFFORT = "__default"

function effortLabel(value: string) {
  if (value === "xhigh") return "Extra High"
  if (value === "max") return "Max"
  if (value === "none") return "None"
  if (value === "minimal") return "Minimal"
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function effortDescription(value: string) {
  if (value === DEFAULT_EFFORT) return "Do not send an effort override"
  if (value === "none") return "Disable reasoning effort when supported"
  if (value === "minimal") return "Use the smallest reasoning budget"
  if (value === "low") return "Faster responses with less reasoning"
  if (value === "medium") return "Balanced reasoning and speed"
  if (value === "high") return "Use a larger reasoning budget"
  if (value === "xhigh" || value === "max") return "Use the largest available reasoning budget"
  return "Provider-supported effort option"
}

export function DialogEffortLevel(props: { modelID: string }) {
  const local = useLocal()
  const dialog = useDialog()
  const variants = createMemo(() => local.model.variant.list())
  const currentVariant = createMemo(() => local.model.variant.current() ?? DEFAULT_EFFORT)
  const options = createMemo(() => [
    {
      value: DEFAULT_EFFORT,
      title: "Default",
      description: effortDescription(DEFAULT_EFFORT),
      onSelect: () => {
        local.model.variant.set(undefined)
        dialog.clear()
      },
    },
    ...variants().map((variant) => ({
      value: variant,
      title: effortLabel(variant),
      description: effortDescription(variant),
      onSelect: () => {
        local.model.variant.set(variant)
        dialog.clear()
      },
    })),
  ])

  return (
    <DialogSelect<string>
      options={options()}
      title={`Effort Level for ${props.modelID.split("/").pop() ?? props.modelID}`}
      current={currentVariant()}
    />
  )
}
