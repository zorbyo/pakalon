export type {
  KeyDef,
  BindingDef,
  KeybindingsConfig,
  Keybinding,
  KeybindingContext,
  KeyMatchResult,
} from './schema.js'

export {
  KeySchema,
  BindingSchema,
  KeybindingsConfigSchema,
} from './schema.js'

export {
  parseKeyString,
  parseBinding,
  parseKeybindingsConfig,
  keyToString,
  bindingToString,
} from './parser.js'

export {
  keysMatch,
  matchKeySequence,
  resolveKeybindings,
  findBindingByAction,
  getBindingsForContext,
} from './resolver.js'

export {
  RESERVED_SHORTCUTS,
  isReservedAction,
  isReservedKeyString,
  getReservedShortcuts,
  isReservedBinding,
} from './reservedShortcuts.js'

export {
  getKeybindingsPath,
  isKeybindingCustomizationEnabled,
  loadUserBindings,
  loadUserBindingsRaw,
  validateBindingFile,
} from './loadUserBindings.js'

export {
  validateBindings,
  validateKeybinding,
  type ValidationResult,
} from './validate.js'

export {
  matchKeybinding,
  shouldWaitForMoreKeys,
  normalizeKeyForMatch,
} from './match.js'

export {
  DEFAULT_BINDINGS,
  getDefaultBindings,
  getDefaultBindingForAction,
} from './defaultBindings.js'

export {
  useShortcutDisplay,
  useShortcutDisplayMap,
  formatShortcutForPlatform,
} from './useShortcutDisplay.js'

export {
  formatShortcut,
  formatShortcutList,
  formatShortcutTable,
  formatShortcutMarkdown,
  formatShortcutPlain,
} from './shortcutFormat.js'

export {
  generateKeybindingsTemplate,
  generateKeybindingsTemplateWithComments,
  TEMPLATE_COMMENTS,
} from './template.js'

export {
  useKeybindingContext,
  useOptionalKeybindingContext,
  KeybindingProviderSetup,
} from './KeybindingContext.js'

export {
  useKeybindings,
  useKeybinding,
} from './useKeybinding.js'
