import { z } from 'zod'

export const KeySchema = z.object({
  key: z.string(),
  ctrl: z.boolean().optional().default(false),
  shift: z.boolean().optional().default(false),
  meta: z.boolean().optional().default(false),
  alt: z.boolean().optional().default(false),
})

export const BindingSchema = z.object({
  keys: z.array(KeySchema).min(1),
  action: z.string(),
  context: z.string().optional().default('global'),
  description: z.string().optional(),
  when: z.string().optional(),
})

export const KeybindingsConfigSchema = z.object({
  bindings: z.array(BindingSchema).optional().default([]),
  overrides: z.array(BindingSchema).optional().default([]),
})

export type KeyDef = z.infer<typeof KeySchema>
export type BindingDef = z.infer<typeof BindingSchema>
export type KeybindingsConfig = z.infer<typeof KeybindingsConfigSchema>

export type Keybinding = {
  keys: KeyDef[]
  action: string
  context: string
  description?: string
  when?: string
  source: 'default' | 'user' | 'override'
}

export type KeybindingContext = {
  bindings: Keybinding[]
  register: (binding: Omit<Keybinding, 'source'>) => void
  unregister: (action: string) => void
}

export type KeyMatchResult = {
  matched: boolean
  binding?: Keybinding
  partialMatch: boolean
}
