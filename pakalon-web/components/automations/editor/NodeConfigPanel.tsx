'use client'

import { useState, useEffect, useCallback } from 'react'
import { type WorkflowNode, getNodeDefinition, type ConfigField, type WorkflowNodeData } from './types'

interface NodeConfigPanelProps {
  node: WorkflowNode | null
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void
  onClose: () => void
}

export function NodeConfigPanel({ node, onUpdateNode, onClose }: NodeConfigPanelProps) {
  if (!node) {
    return (
      <div className="flex h-full w-80 flex-col items-center justify-center border-l border-border-dark bg-surface-dark p-6">
        <span className="material-symbols-outlined text-4xl text-[#8f937c]">touch_app</span>
        <p className="mt-3 text-center text-sm text-[#8f937c]">
          Select a node to configure its settings
        </p>
      </div>
    )
  }

  const def = getNodeDefinition(node.data.nodeType)

  return (
    <div className="flex h-full w-80 flex-col border-l border-border-dark bg-surface-dark">
      <div className="flex items-center justify-between border-b border-border-dark p-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]" style={{ color: def?.color }}>
            {def?.icon ?? 'settings'}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-white">{node.data.label}</h3>
            <p className="text-xs text-[#8f937c]">{node.data.nodeType}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[#8f937c] hover:bg-white/5 hover:text-white"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label field */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#d7dac8]">Label</label>
          <input
            type="text"
            value={node.data.label}
            onChange={(e) => onUpdateNode(node.id, { label: e.target.value })}
            className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />
        </div>

        {/* Dynamic config fields */}
        {def?.configFields.map((field) => (
          <ConfigFieldInput
            key={field.key}
            field={field}
            value={node.data.config[field.key]}
            onChange={(value) => {
              const newConfig = { ...node.data.config, [field.key]: value }
              onUpdateNode(node.id, { config: newConfig })
            }}
          />
        ))}

        {!def?.configFields.length && (
          <p className="text-sm text-[#8f937c]">This node has no configurable options.</p>
        )}
      </div>
    </div>
  )
}

function ConfigFieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [textValue, setTextValue] = useState<string>('')

  useEffect(() => {
    if (field.type === 'json') {
      setTextValue(typeof value === 'object' ? JSON.stringify(value, null, 2) : (value as string) ?? '')
    }
  }, [value, field.type])

  const handleJsonChange = useCallback(
    (raw: string) => {
      setTextValue(raw)
      if (!raw.trim()) {
        setJsonError(null)
        onChange(null)
        return
      }
      try {
        const parsed = JSON.parse(raw)
        setJsonError(null)
        onChange(parsed)
      } catch {
        setJsonError('Invalid JSON')
      }
    },
    [onChange]
  )

  const label = (
    <label className="text-xs font-medium text-[#d7dac8]">
      {field.label}
      {field.required && <span className="ml-1 text-red-400">*</span>}
    </label>
  )

  const description = field.description ? (
    <p className="text-xs text-[#8f937c]">{field.description}</p>
  ) : null

  switch (field.type) {
    case 'text':
    case 'secret':
    case 'cron':
      return (
        <div className="space-y-1.5">
          {label}
          {description}
          <input
            type={field.type === 'secret' ? 'password' : 'text'}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary placeholder:text-[#8f937c]"
          />
        </div>
      )

    case 'textarea':
      return (
        <div className="space-y-1.5">
          {label}
          {description}
          <textarea
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            rows={4}
            className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary placeholder:text-[#8f937c] resize-y font-mono"
          />
        </div>
      )

    case 'select':
      return (
        <div className="space-y-1.5">
          {label}
          {description}
          <select
            value={(value as string) ?? (field.defaultValue as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary appearance-none"
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )

    case 'number':
      return (
        <div className="space-y-1.5">
          {label}
          {description}
          <input
            type="number"
            value={(value as number) ?? (field.defaultValue as number) ?? ''}
            onChange={(e) => onChange(Number(e.target.value))}
            placeholder={field.placeholder}
            className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary placeholder:text-[#8f937c]"
          />
        </div>
      )

    case 'json':
      return (
        <div className="space-y-1.5">
          {label}
          {description}
          <textarea
            value={textValue}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder={field.placeholder}
            rows={4}
            className={`w-full rounded-lg border bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary placeholder:text-[#8f937c] resize-y font-mono ${
              jsonError ? 'border-red-500/60' : 'border-border-dark'
            }`}
          />
          {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}
        </div>
      )

    case 'toggle':
      return (
        <div className="flex items-center justify-between">
          <div>
            {label}
            {description}
          </div>
          <button
            type="button"
            onClick={() => onChange(!value)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              value ? 'bg-primary' : 'bg-[#3a3b2f]'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                value ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      )

    default:
      return null
  }
}
