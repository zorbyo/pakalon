import { createMemo, createResource, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect, type DialogSelectProps } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogEffortLevel } from "./dialog-effort"
import { useKeybind } from "../context/keybind"
import * as fuzzysort from "fuzzysort"
import * as Backend from "@/backend"
import { isBackendEnabled } from "@/backend/types"

const BACKEND_PROVIDER_ID = "openrouter"

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some((x) => x.id !== BACKEND_PROVIDER_ID || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
}

export function DialogModel(props: { providerID?: string }) {
  type ModelSelection = { providerID: string; modelID: string }
  type ModelDialogValue = ModelSelection | string

  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const [query, setQuery] = createSignal("")
  const useBackendModels = createMemo(() => isBackendEnabled() && !props.providerID)
  const selectModel = (providerID: string, modelID: string) => {
    local.model.set({ providerID, modelID }, { recent: true })
    if (local.model.variant.list().length > 0) {
      dialog.replace(() => <DialogEffortLevel modelID={modelID} />)
      return
    }
    local.model.variant.set(undefined)
    dialog.clear()
  }

  const connected = useConnected()
  const providers = createDialogProviderOptions()
  const [backendModels] = createResource(useBackendModels, async (enabled) => {
    if (!enabled) return undefined
    const response = await Backend.ModelsBackend.listModels().catch(() => undefined)
    if (!response) return undefined
    const plan = response.plan === "pro" ? "pro" : "free"
    return {
      plan,
      models: Backend.ModelsBackend.filterByPlan(response.models, plan),
    }
  })

  const providerByModel = createMemo(() => {
    const map = new Map<string, string>()
    for (const provider of sync.data.provider) {
      for (const modelID of Object.keys(provider.models)) {
        if (!map.has(modelID)) {
          map.set(modelID, provider.id)
        }
      }
    }
    return map
  })

  const showExtra = createMemo(() => connected() && !props.providerID)

  const providerOptions = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: provider.id === BACKEND_PROVIDER_ID && model.id.includes("-nano"),
            footer: model.cost?.input === 0 && provider.id === BACKEND_PROVIDER_ID ? "Free" : undefined,
            onSelect: () => {
              selectModel(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== BACKEND_PROVIDER_ID,
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === BACKEND_PROVIDER_ID && model.includes("-nano"),
            footer: info.cost?.input === 0 && provider.id === BACKEND_PROVIDER_ID ? "Free" : undefined,
            onSelect() {
              selectModel(provider.id, model)
            },
          })),
          filter((x) => {
            if (!showSections) return true
            if (favorites.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            if (recents.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            return true
          }),
          sortBy(
            (x) => x.footer !== "Free",
            (x) => x.title,
          ),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const openRouterOptions = createMemo(() => {
    if (!useBackendModels()) return []

    const data = backendModels()
    if (!data) return []

    const modelEntries = data.models
      .map((model) => {
        const modelID = model.id ?? model.model_id ?? model.name
        if (!modelID) return undefined
        return { model, modelID }
      })
      .filter((entry): entry is { model: (typeof data.models)[number]; modelID: string } => Boolean(entry))

    const byModelID = new Map(modelEntries.map((item) => [item.modelID, item.model]))
    const seen = new Set<string>()
    const favorites = local.model.favorite()
    const recents = local.model.recent()

    const toOption = (modelID: string, category?: string) => {
      const model = byModelID.get(modelID)
      if (!model) return undefined

      const providerID = BACKEND_PROVIDER_ID
      const contextWindow = model.context_length || model.top_provider?.context_length || 0
      const tier = Backend.ModelsBackend.isFreeModel(model) ? "Free" : "Pro"
      const description = [model.name && model.name !== modelID ? model.name : undefined, `${contextWindow.toLocaleString()} ctx`]
        .filter((value): value is string => Boolean(value))
        .join(" · ")

      return {
        value: { providerID, modelID },
        title: modelID,
        description,
        category,
        footer: tier,
        onSelect: () => {
          selectModel(providerID, modelID)
        },
      }
    }

    const favoriteOptions = favorites.flatMap((item) => {
      if (seen.has(item.modelID)) return []
      const option = toOption(item.modelID, "Favorites")
      if (!option) return []
      seen.add(item.modelID)
      return [option]
    })

    const recentOptions = recents.flatMap((item) => {
      if (seen.has(item.modelID)) return []
      const option = toOption(item.modelID, "Recent")
      if (!option) return []
      seen.add(item.modelID)
      return [option]
    })

    const availableOptions = modelEntries
      .toSorted((a, b) => {
        const aFree = Backend.ModelsBackend.isFreeModel(a.model)
        const bFree = Backend.ModelsBackend.isFreeModel(b.model)
        if (aFree !== bFree) {
          return aFree ? -1 : 1
        }
        return a.modelID.localeCompare(b.modelID)
      })
      .flatMap((entry) => {
        if (seen.has(entry.modelID)) return []
        const option = toOption(entry.modelID, data.plan === "pro" ? "All models" : "Free models")
        if (!option) return []
        return [option]
      })

    const all = [...favoriteOptions, ...recentOptions, ...availableOptions]
    const needle = query().trim()
    if (!needle) return all
    return fuzzysort.go(needle, all, { keys: ["title", "description", "category"] }).map((x) => x.obj)
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    if (useBackendModels()) {
      const plan = backendModels()?.plan?.toUpperCase() ?? "..."
      return `Select model (${plan})`
    }
    return provider()?.name ?? "Select model"
  })

  const keybinds = createMemo<DialogSelectProps<ModelDialogValue>["keybind"]>(() => {
    return [
      ...(useBackendModels()
        ? []
        : [
            {
              keybind: keybind.all.model_provider_list?.[0],
              title: connected() ? "Connect provider" : "View all providers",
              onTrigger() {
                dialog.replace(() => <DialogProvider />)
              },
            },
          ]),
      {
        keybind: keybind.all.model_favorite_toggle?.[0],
        title: "Favorite",
        disabled: !connected(),
        onTrigger: (option) => {
          if (typeof option.value === "string") return
          local.model.toggleFavorite(option.value)
        },
      },
    ]
  })

  return (
    <DialogSelect<ModelDialogValue>
      options={useBackendModels() ? openRouterOptions() : providerOptions()}
      keybind={keybinds()}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}
