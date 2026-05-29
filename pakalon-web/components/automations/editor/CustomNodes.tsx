'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { type WorkflowNodeData, getCategoryColor, getNodeDefinition } from './types'

const iconMap: Record<string, string> = {
  schedule: 'schedule',
  webhook: 'webhook',
  code: 'code',
  chat: 'chat',
  play_arrow: 'play_arrow',
  http: 'http',
  send: 'send',
  bug_report: 'bug_report',
  rate_review: 'rate_review',
  terminal: 'terminal',
  transform: 'transform',
  timer: 'timer',
  description: 'description',
  call_split: 'call_split',
  alt_route: 'alt_route',
  filter_list: 'filter_list',
  loop: 'loop',
  hourglass_empty: 'hourglass_empty',
}

export const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData
  const def = getNodeDefinition(nodeData.nodeType)
  const color = getCategoryColor('trigger')
  const icon = iconMap[def?.icon ?? 'play_arrow'] ?? 'play_arrow'
  const hasErrors = nodeData.validationErrors && nodeData.validationErrors.length > 0

  return (
    <div
      className={`min-w-[180px] rounded-xl border-2 bg-[#1a1b16] shadow-lg transition-all ${
        selected ? 'shadow-xl ring-2 ring-primary/50' : ''
      } ${hasErrors ? 'border-red-500/60' : 'border-indigo-500/40'}`}
      style={{ borderColor: hasErrors ? undefined : `${color}66` }}
    >
      <div className="flex items-center gap-2 rounded-t-[10px] px-3 py-2" style={{ backgroundColor: `${color}15` }}>
        <span className="material-symbols-outlined text-[18px]" style={{ color }}>{icon}</span>
        <span className="text-sm font-semibold text-white">{nodeData.label}</span>
        <span className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${color}20`, color }}>
          Trigger
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-[#8f937c]">{def?.description ?? 'Trigger node'}</p>
        {hasErrors && (
          <p className="mt-1 text-xs text-red-400">{nodeData.validationErrors?.[0]}</p>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-indigo-400 !bg-[#1a1b16]"
      />
    </div>
  )
})

export const ActionNode = memo(function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData
  const def = getNodeDefinition(nodeData.nodeType)
  const color = getCategoryColor('action')
  const icon = iconMap[def?.icon ?? 'http'] ?? 'http'
  const hasErrors = nodeData.validationErrors && nodeData.validationErrors.length > 0

  return (
    <div
      className={`min-w-[180px] rounded-xl border-2 bg-[#1a1b16] shadow-lg transition-all ${
        selected ? 'shadow-xl ring-2 ring-primary/50' : ''
      } ${hasErrors ? 'border-red-500/60' : 'border-emerald-500/40'}`}
      style={{ borderColor: hasErrors ? undefined : `${color}66` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-emerald-400 !bg-[#1a1b16]"
      />
      <div className="flex items-center gap-2 rounded-t-[10px] px-3 py-2" style={{ backgroundColor: `${color}15` }}>
        <span className="material-symbols-outlined text-[18px]" style={{ color }}>{icon}</span>
        <span className="text-sm font-semibold text-white">{nodeData.label}</span>
        <span className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${color}20`, color }}>
          Action
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-[#8f937c]">{def?.description ?? 'Action node'}</p>
        {hasErrors && (
          <p className="mt-1 text-xs text-red-400">{nodeData.validationErrors?.[0]}</p>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-emerald-400 !bg-[#1a1b16]"
      />
    </div>
  )
})

export const LogicNode = memo(function LogicNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData
  const def = getNodeDefinition(nodeData.nodeType)
  const color = getCategoryColor('logic')
  const icon = iconMap[def?.icon ?? 'call_split'] ?? 'call_split'
  const hasErrors = nodeData.validationErrors && nodeData.validationErrors.length > 0

  return (
    <div
      className={`min-w-[180px] rounded-xl border-2 bg-[#1a1b16] shadow-lg transition-all ${
        selected ? 'shadow-xl ring-2 ring-primary/50' : ''
      } ${hasErrors ? 'border-red-500/60' : 'border-yellow-500/40'}`}
      style={{ borderColor: hasErrors ? undefined : `${color}66` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-yellow-400 !bg-[#1a1b16]"
      />
      <div className="flex items-center gap-2 rounded-t-[10px] px-3 py-2" style={{ backgroundColor: `${color}15` }}>
        <span className="material-symbols-outlined text-[18px]" style={{ color }}>{icon}</span>
        <span className="text-sm font-semibold text-white">{nodeData.label}</span>
        <span className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${color}20`, color }}>
          Logic
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-[#8f937c]">{def?.description ?? 'Logic node'}</p>
        {hasErrors && (
          <p className="mt-1 text-xs text-red-400">{nodeData.validationErrors?.[0]}</p>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-yellow-400 !bg-[#1a1b16]"
      />
    </div>
  )
})

// Node type mapping for ReactFlow
export const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  logic: LogicNode,
}
