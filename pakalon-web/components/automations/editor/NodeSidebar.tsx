'use client'

import { useState } from 'react'
import { NODE_TYPE_DEFINITIONS, NODE_CATEGORIES, type NodeTypeDefinition, type NodeCategory } from './types'

interface NodeSidebarProps {
  onDragStart: (event: React.DragEvent, nodeType: string) => void
}

export function NodeSidebar({ onDragStart }: NodeSidebarProps) {
  const [search, setSearch] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<NodeCategory>>(new Set(['trigger', 'action', 'logic']))

  const filteredDefinitions = NODE_TYPE_DEFINITIONS.filter(
    (def) =>
      def.label.toLowerCase().includes(search.toLowerCase()) ||
      def.description.toLowerCase().includes(search.toLowerCase())
  )

  const toggleCategory = (category: NodeCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const grouped = NODE_CATEGORIES.map((cat) => ({
    ...cat,
    nodes: filteredDefinitions.filter((def) => def.category === cat.category),
  }))

  return (
    <div className="flex h-full w-64 flex-col border-r border-border-dark bg-surface-dark">
      <div className="border-b border-border-dark p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">Node Palette</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search nodes..."
          className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary placeholder:text-[#8f937c]"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {grouped.map((group) => (
          <div key={group.category} className="mb-3">
            <button
              type="button"
              onClick={() => toggleCategory(group.category)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-[#b1b4a2] hover:bg-white/5"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              {group.label}
              <span className="ml-auto text-xs text-[#8f937c]">{group.nodes.length}</span>
              <span className="material-symbols-outlined text-[16px] text-[#8f937c]">
                {expandedCategories.has(group.category) ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {expandedCategories.has(group.category) && (
              <div className="mt-1 space-y-1 pl-2">
                {group.nodes.map((nodeDef) => (
                  <DraggableNodeItem
                    key={nodeDef.type}
                    definition={nodeDef}
                    onDragStart={onDragStart}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {filteredDefinitions.length === 0 && (
          <p className="py-4 text-center text-sm text-[#8f937c]">No matching nodes found.</p>
        )}
      </div>
    </div>
  )
}

function DraggableNodeItem({
  definition,
  onDragStart,
}: {
  definition: NodeTypeDefinition
  onDragStart: (event: React.DragEvent, nodeType: string) => void
}) {
  return (
    <div
      className="flex cursor-grab items-center gap-2 rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm transition-colors hover:border-white/10 active:cursor-grabbing"
      draggable
      onDragStart={(event) => onDragStart(event, definition.type)}
    >
      <span className="material-symbols-outlined text-[16px]" style={{ color: definition.color }}>
        {definition.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="truncate text-white">{definition.label}</p>
        <p className="truncate text-xs text-[#8f937c]">{definition.description}</p>
      </div>
    </div>
  )
}
