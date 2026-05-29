import type { SettingSource } from './constants.js'

type ChangeListener = (source: SettingSource) => void

const listeners = new Set<ChangeListener>()

export const settingsChangeDetector = {
  notifyChange(source: SettingSource): void {
    for (const listener of listeners) {
      try {
        listener(source)
      } catch {
        // Ignore listener errors
      }
    }
  },

  onChange(listener: ChangeListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
