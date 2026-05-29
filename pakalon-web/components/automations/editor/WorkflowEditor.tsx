'use client'

import { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  BackgroundVariant,
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { type WorkflowNode, type WorkflowNodeData, type WorkflowEdge, getNodeDefinition, validateNodeConfig, getCategoryColor, type NodeCategory } from './types'
import { nodeTypes } from './CustomNodes'
import { NodeSidebar } from './NodeSidebar'
import { NodeConfigPanel } from './NodeConfigPanel'

interface WorkflowEditorProps {
  automationId: string
  initialNodes?: WorkflowNode[]
  initialEdges?: WorkflowEdge[]
  automationName?: string
  automationDescription?: string
  onSave: (data: { nodes: WorkflowNode[]; edges: WorkflowEdge[]; name?: string; description?: string }) => Promise<void>
  onAutoSave?: (data: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) => Promise<void>
}

let nodeIdCounter = 0
function generateNodeId(type: string): string {
  nodeIdCounter++
  return `${type.replace('.', '_')}_${Date.now()}_${nodeIdCounter}`
}

export function WorkflowEditor({
  automationId,
  initialNodes = [],
  initialEdges = [],
  automationName = '',
  automationDescription = '',
  onSave,
  onAutoSave,
}: WorkflowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes as Node<WorkflowNodeData>[])
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges as WorkflowEdge[])
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [name, setName] = useState(automationName)
  const [description, setDescription] = useState(automationDescription)
  const [showSettings, setShowSettings] = useState(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Update selected node when nodes change
  useEffect(() => {
    if (selectedNode) {
      const updated = nodes.find((n) => n.id === selectedNode.id)
      if (updated) {
        setSelectedNode(updated as unknown as WorkflowNode)
      } else {
        setSelectedNode(null)
      }
    }
  }, [nodes, selectedNode?.id])

  // Auto-save on changes
  useEffect(() => {
    if (!onAutoSave) return
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }
    autoSaveTimerRef.current = setTimeout(() => {
      onAutoSave({ nodes: nodes as unknown as WorkflowNode[], edges: edges as WorkflowEdge[] }).catch(() => {})
    }, 3000)
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [nodes, edges, onAutoSave])

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#6b7280' } }, eds))
    },
    [setEdges]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const nodeType = event.dataTransfer.getData('application/reactflow')
      if (!nodeType || !reactFlowWrapper.current) return

      const def = getNodeDefinition(nodeType)
      if (!def) return

      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      const position = {
        x: event.clientX - bounds.left - 90,
        y: event.clientY - bounds.top - 30,
      }

      const category = def.category as NodeCategory
      const reactFlowNodeType = category === 'trigger' ? 'trigger' : category === 'logic' ? 'logic' : 'action'

      const newNode: Node<WorkflowNodeData> = {
        id: generateNodeId(nodeType),
        type: reactFlowNodeType,
        position,
        data: {
          label: def.label,
          category,
          nodeType: def.type,
          config: { ...def.defaultConfig },
          isValid: true,
          validationErrors: [],
        },
      }

      setNodes((nds) => [...nds, newNode])
    },
    [setNodes]
  )

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node as unknown as WorkflowNode)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  const handleUpdateNode = useCallback(
    (nodeId: string, data: Partial<WorkflowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const updated = {
              ...n,
              data: { ...n.data, ...data } as WorkflowNodeData,
            }
            const errors = validateNodeConfig(updated as unknown as WorkflowNode)
            updated.data.validationErrors = errors
            updated.data.isValid = errors.length === 0
            return updated
          }
          return n
        })
      )
    },
    [setNodes]
  )

  const handleDeleteNode = useCallback(() => {
    if (!selectedNode) return
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id))
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id))
    setSelectedNode(null)
  }, [selectedNode, setNodes, setEdges])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveStatus(null)
    try {
      await onSave({
        nodes: nodes as unknown as WorkflowNode[],
        edges: edges as WorkflowEdge[],
        name: name || undefined,
        description: description || undefined,
      })
      setSaveStatus('Saved')
      setTimeout(() => setSaveStatus(null), 3000)
    } catch {
      setSaveStatus('Save failed')
    } finally {
      setSaving(false)
    }
  }, [nodes, edges, name, description, onSave])

  const handleExport = useCallback(() => {
    const data = { name, description, nodes, edges }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name || 'workflow'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [name, description, nodes, edges])

  const isValidWorkflow = useMemo(() => {
    const allNodes = nodes as unknown as WorkflowNode[]
    return allNodes.length > 0 && allNodes.every((n) => n.data.isValid !== false)
  }, [nodes])

  return (
    <div className="flex h-[calc(100vh-120px)] w-full overflow-hidden rounded-2xl border border-border-dark bg-background-dark">
      {/* Node Sidebar */}
      <NodeSidebar
        onDragStart={(event, nodeType) => {
          event.dataTransfer.setData('application/reactflow', nodeType)
          event.dataTransfer.effectAllowed = 'move'
        }}
      />

      {/* Canvas */}
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={['Backspace', 'Delete']}
          className="bg-background-dark"
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: '#6b7280', strokeWidth: 2 },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3a3b2f" />
          <Controls className="!bg-surface-dark !border-border-dark !rounded-xl !shadow-lg" />
          <MiniMap
            nodeColor={(node) => {
              const data = node.data as WorkflowNodeData
              return getCategoryColor(data.category)
            }}
            className="!bg-surface-dark !border-border-dark !rounded-xl"
            maskColor="rgba(0,0,0,0.7)"
          />

          {/* Top toolbar */}
          <Panel position="top-center">
            <div className="flex items-center gap-3 rounded-xl border border-border-dark bg-surface-dark px-4 py-2 shadow-lg">
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className="rounded-lg p-1.5 text-[#b1b4a2] hover:bg-white/5 hover:text-white"
                title="Workflow settings"
              >
                <span className="material-symbols-outlined text-[18px]">settings</span>
              </button>

              <div className="h-5 w-px bg-border-dark" />

              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-background-dark transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[16px]">save</span>
                {saving ? 'Saving...' : 'Save'}
              </button>

              <button
                type="button"
                onClick={handleExport}
                className="rounded-lg p-1.5 text-[#b1b4a2] hover:bg-white/5 hover:text-white"
                title="Export workflow"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
              </button>

              {selectedNode && (
                <>
                  <div className="h-5 w-px bg-border-dark" />
                  <button
                    type="button"
                    onClick={handleDeleteNode}
                    className="rounded-lg p-1.5 text-red-400 hover:bg-red-500/10"
                    title="Delete selected node"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </>
              )}

              {saveStatus && (
                <span className={`text-xs ${saveStatus === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {saveStatus}
                </span>
              )}

              {!isValidWorkflow && (
                <span className="text-xs text-yellow-400">
                  {nodes.length === 0 ? 'Add nodes to begin' : 'Some nodes have errors'}
                </span>
              )}
            </div>
          </Panel>

          {/* Settings panel */}
          {showSettings && (
            <Panel position="top-left" className="!ml-72 !mt-16">
              <div className="w-72 rounded-xl border border-border-dark bg-surface-dark p-4 shadow-xl">
                <h4 className="mb-3 text-sm font-semibold text-white">Workflow Settings</h4>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-[#d7dac8]">Name</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-[#d7dac8]">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white outline-none focus:border-primary resize-y"
                    />
                  </div>
                </div>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Node Config Panel */}
      <NodeConfigPanel
        node={selectedNode}
        onUpdateNode={handleUpdateNode}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  )
}
