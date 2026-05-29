import React, { createContext, useContext, useEffect, useState } from 'react'
import { createStore, type Store } from '../state/store.js'

export type VoiceStateType = 'idle' | 'recording' | 'processing'

export interface VoiceState {
  voiceState: VoiceStateType
  voiceInterimTranscript: string
  voiceAudioLevels: number[]
  voiceError: string | null
  voiceWarmingUp: boolean
}

function getDefaultVoiceState(): VoiceState {
  return {
    voiceState: 'idle',
    voiceInterimTranscript: '',
    voiceAudioLevels: [],
    voiceError: null,
    voiceWarmingUp: false,
  }
}

type VoiceStore = Store<VoiceState>

let store: VoiceStore | null = null

function getStore(): VoiceStore {
  if (!store) {
    store = createStore(getDefaultVoiceState())
  }
  return store
}

const VoiceStateContext = createContext<VoiceStore | null>(null)

export function VoiceProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [localStore] = useState(() => getStore())

  return React.createElement(
    VoiceStateContext.Provider,
    { value: localStore },
    children,
  )
}

function useVoiceStore(): VoiceStore {
  const ctx = useContext(VoiceStateContext)
  if (!ctx) {
    return getStore()
  }
  return ctx
}

export function useVoiceState<T>(selector: (state: VoiceState) => T): T {
  const storeRef = useVoiceStore()
  const [value, setValue] = useState(() => selector(storeRef.getState()))

  useEffect(() => {
    const listener = () => {
      const next = selector(storeRef.getState())
      setValue(prev => (Object.is(prev, next) ? prev : next))
    }
    return storeRef.subscribe(listener)
  }, [storeRef, selector])

  return value
}

export function useGetVoiceState(): () => VoiceState {
  const s = useVoiceStore()
  return () => s.getState()
}

export function useSetVoiceState(): (updater: (prev: VoiceState) => VoiceState) => void {
  const s = useVoiceStore()
  return (updater: (prev: VoiceState) => VoiceState) => {
    s.setState(updater)
  }
}
