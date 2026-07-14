type AgentModel = {
  providerID: string
  modelID: string
}

type Agent = {
  model?: AgentModel
  variant?: string
}

type Model = AgentModel & {
  variants?: Record<string, unknown>
}

type VariantInput = {
  variants: string[]
  selected: string | null | undefined
  configured: string | undefined
}

export function getConfiguredAgentVariant(input: { agent: Agent | undefined; model: Model | undefined }) {
  if (!input.agent?.variant) return undefined
  if (!input.agent.model) return undefined
  if (!input.model?.variants) return undefined
  if (input.agent.model.providerID !== input.model.providerID) return undefined
  if (input.agent.model.modelID !== input.model.modelID) return undefined
  if (!(input.agent.variant in input.model.variants)) return undefined
  return input.agent.variant
}

export function resolveModelVariant(input: VariantInput) {
  if (input.selected === null) return undefined
  if (input.selected && input.variants.includes(input.selected)) return input.selected
  if (input.configured && input.variants.includes(input.configured)) return input.configured
  return undefined
}

export function cycleModelVariant(input: VariantInput) {
  if (input.variants.length === 0) return undefined
  if (input.selected === null) return input.variants[0]
  if (input.selected && input.variants.includes(input.selected)) {
    const index = input.variants.indexOf(input.selected)
    if (index === input.variants.length - 1) return undefined
    return input.variants[index + 1]
  }
  if (input.configured && input.variants.includes(input.configured)) {
    const index = input.variants.indexOf(input.configured)
    if (index === input.variants.length - 1) return input.variants[0]
    return input.variants[index + 1]
  }
  return input.variants[0]
}

function hasEffortLikeVariants(variants: Record<string, unknown>) {
  const keys = Object.keys(variants)
  return keys.some((key) => /^(default|low|medium|high|extra[-_]?high|xhigh|max|reasoning|thinking|chat)$/.test(key.toLowerCase()))
}

export function modelSupportsReasoningVariant(input: Model) {
  if (!input.variants || !hasEffortLikeVariants(input.variants)) return false

  const providerID = input.providerID.toLowerCase()
  const modelID = input.modelID.toLowerCase()
  const id = `${providerID}/${modelID}`

  if (/(^|\/)(gpt-5|o1|o3|o4)/.test(id)) return true
  if (id.includes("deepseek-r1") || id.includes("deepseek-reasoner")) return true
  if (/claude-(3-7|4|sonnet-4|opus-4)/.test(id)) return true
  if (/gemini-2\.5-(pro|flash)/.test(id)) return true

  return false
}

export function filterSupportedModelVariants(input: Model) {
  if (!input.variants) return []
  if (!modelSupportsReasoningVariant(input)) return []
  return Object.keys(input.variants)
}
