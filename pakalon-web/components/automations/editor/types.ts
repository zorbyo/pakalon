'use client'

import { type Node, type Edge } from '@xyflow/react'

// Node category types
export type NodeCategory = 'trigger' | 'action' | 'logic'

// Node data shape that all nodes share
export interface WorkflowNodeData extends Record<string, unknown> {
  label: string
  category: NodeCategory
  nodeType: string
  config: Record<string, unknown>
  isValid?: boolean
  validationErrors?: string[]
}

// Typed nodes for ReactFlow
export type WorkflowNode = Node<WorkflowNodeData>
export type WorkflowEdge = Edge

// Node type registry - defines what nodes are available
export interface NodeTypeDefinition {
  type: string
  category: NodeCategory
  label: string
  description: string
  icon: string
  color: string
  defaultConfig: Record<string, unknown>
  configFields: ConfigField[]
}

export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number' | 'json' | 'toggle' | 'cron' | 'secret'
  required?: boolean
  placeholder?: string
  options?: { label: string; value: string }[]
  defaultValue?: unknown
  description?: string
}

// Available node type definitions
export const NODE_TYPE_DEFINITIONS: NodeTypeDefinition[] = [
  // --- TRIGGERS ---
  {
    type: 'trigger.schedule',
    category: 'trigger',
    label: 'Schedule',
    description: 'Run on a cron schedule',
    icon: 'schedule',
    color: '#818cf8',
    defaultConfig: { cron: '0 * * * *', timezone: 'UTC' },
    configFields: [
      { key: 'cron', label: 'Cron Expression', type: 'cron', required: true, placeholder: '0 * * * *', description: 'Standard cron expression' },
      { key: 'timezone', label: 'Timezone', type: 'text', required: false, placeholder: 'UTC', defaultValue: 'UTC' },
    ],
  },
  {
    type: 'trigger.webhook',
    category: 'trigger',
    label: 'Webhook',
    description: 'Trigger via HTTP webhook',
    icon: 'webhook',
    color: '#818cf8',
    defaultConfig: { method: 'POST' },
    configFields: [
      { key: 'method', label: 'HTTP Method', type: 'select', required: true, options: [{ label: 'POST', value: 'POST' }, { label: 'GET', value: 'GET' }], defaultValue: 'POST' },
      { key: 'auth_token', label: 'Auth Token (optional)', type: 'secret', placeholder: 'Optional bearer token' },
    ],
  },
  {
    type: 'trigger.github',
    category: 'trigger',
    label: 'GitHub Event',
    description: 'Trigger on GitHub events',
    icon: 'code',
    color: '#818cf8',
    defaultConfig: { event: 'push' },
    configFields: [
      { key: 'event', label: 'Event Type', type: 'select', required: true, options: [
        { label: 'Push', value: 'push' },
        { label: 'Pull Request Opened', value: 'pull_request.opened' },
        { label: 'Pull Request Merged', value: 'pull_request.closed' },
        { label: 'Issue Created', value: 'issues.opened' },
        { label: 'Release Published', value: 'release.published' },
      ], defaultValue: 'push' },
      { key: 'repo', label: 'Repository (owner/repo)', type: 'text', placeholder: 'owner/repo' },
    ],
  },
  {
    type: 'trigger.slack',
    category: 'trigger',
    label: 'Slack Event',
    description: 'Trigger on Slack messages',
    icon: 'chat',
    color: '#818cf8',
    defaultConfig: { event: 'message' },
    configFields: [
      { key: 'event', label: 'Event Type', type: 'select', required: true, options: [
        { label: 'Message Posted', value: 'message' },
        { label: 'Reaction Added', value: 'reaction_added' },
      ], defaultValue: 'message' },
      { key: 'channel', label: 'Channel Filter', type: 'text', placeholder: '#general' },
    ],
  },
  {
    type: 'trigger.manual',
    category: 'trigger',
    label: 'Manual',
    description: 'Trigger manually by user',
    icon: 'play_arrow',
    color: '#818cf8',
    defaultConfig: {},
    configFields: [],
  },

  // --- ACTIONS ---
  {
    type: 'action.http_request',
    category: 'action',
    label: 'HTTP Request',
    description: 'Make an HTTP API call',
    icon: 'http',
    color: '#34d399',
    defaultConfig: { method: 'GET', url: '', headers: {}, body: null },
    configFields: [
      { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://api.example.com/endpoint', description: 'Supports {{variable}} templates' },
      { key: 'method', label: 'Method', type: 'select', required: true, options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
        { label: 'PUT', value: 'PUT' },
        { label: 'PATCH', value: 'PATCH' },
        { label: 'DELETE', value: 'DELETE' },
      ], defaultValue: 'GET' },
      { key: 'headers', label: 'Headers (JSON)', type: 'json', placeholder: '{"Authorization": "Bearer {{token}}"}' },
      { key: 'body', label: 'Body (JSON)', type: 'json', placeholder: '{"key": "value"}' },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', defaultValue: 30000 },
    ],
  },
  {
    type: 'action.slack.send_message',
    category: 'action',
    label: 'Send Slack Message',
    description: 'Send a message to a Slack channel',
    icon: 'send',
    color: '#34d399',
    defaultConfig: { channel: '#general', message: '' },
    configFields: [
      { key: 'channel', label: 'Channel', type: 'text', required: true, placeholder: '#general' },
      { key: 'message', label: 'Message', type: 'textarea', required: true, placeholder: 'Hello from automation!' },
    ],
  },
  {
    type: 'action.github.create_issue',
    category: 'action',
    label: 'Create GitHub Issue',
    description: 'Create an issue on GitHub',
    icon: 'bug_report',
    color: '#34d399',
    defaultConfig: { repo: '', title: '', body: '' },
    configFields: [
      { key: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'owner/repo' },
      { key: 'title', label: 'Issue Title', type: 'text', required: true, placeholder: 'Issue title' },
      { key: 'body', label: 'Issue Body', type: 'textarea', placeholder: 'Issue description' },
    ],
  },
  {
    type: 'action.github.create_review',
    category: 'action',
    label: 'Create PR Review',
    description: 'Create a pull request review',
    icon: 'rate_review',
    color: '#34d399',
    defaultConfig: { repo: '', pr_number: '', body: '', event: 'COMMENT' },
    configFields: [
      { key: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'owner/repo' },
      { key: 'pr_number', label: 'PR Number', type: 'number', required: true },
      { key: 'body', label: 'Review Body', type: 'textarea', required: true },
      { key: 'event', label: 'Review Event', type: 'select', options: [
        { label: 'Comment', value: 'COMMENT' },
        { label: 'Approve', value: 'APPROVE' },
        { label: 'Request Changes', value: 'REQUEST_CHANGES' },
      ], defaultValue: 'COMMENT' },
    ],
  },
  {
    type: 'action.code_execution',
    category: 'action',
    label: 'Run Code',
    description: 'Execute custom code in sandbox',
    icon: 'terminal',
    color: '#34d399',
    defaultConfig: { language: 'javascript', code: '' },
    configFields: [
      { key: 'language', label: 'Language', type: 'select', required: true, options: [
        { label: 'JavaScript', value: 'javascript' },
        { label: 'Python', value: 'python' },
        { label: 'TypeScript', value: 'typescript' },
      ], defaultValue: 'javascript' },
      { key: 'code', label: 'Code', type: 'textarea', required: true, placeholder: '// Write your code here\nreturn { result: "hello" };' },
    ],
  },
  {
    type: 'action.transform',
    category: 'action',
    label: 'Transform Data',
    description: 'Transform data between nodes',
    icon: 'transform',
    color: '#34d399',
    defaultConfig: { transform_type: 'passthrough', expression: '' },
    configFields: [
      { key: 'transform_type', label: 'Transform Type', type: 'select', required: true, options: [
        { label: 'Passthrough', value: 'passthrough' },
        { label: 'JSON Path', value: 'json_path' },
        { label: 'Map', value: 'map' },
      ], defaultValue: 'passthrough' },
      { key: 'expression', label: 'Expression', type: 'text', placeholder: '{{previous_output.data}}' },
    ],
  },
  {
    type: 'action.delay',
    category: 'action',
    label: 'Delay',
    description: 'Wait for a specified duration',
    icon: 'timer',
    color: '#34d399',
    defaultConfig: { duration_ms: 1000 },
    configFields: [
      { key: 'duration_ms', label: 'Duration (ms)', type: 'number', required: true, defaultValue: 1000, placeholder: '1000' },
    ],
  },
  {
    type: 'action.log',
    category: 'action',
    label: 'Log',
    description: 'Log a message for debugging',
    icon: 'description',
    color: '#34d399',
    defaultConfig: { level: 'info', message: '' },
    configFields: [
      { key: 'level', label: 'Log Level', type: 'select', options: [
        { label: 'Debug', value: 'debug' },
        { label: 'Info', value: 'info' },
        { label: 'Warning', value: 'warning' },
        { label: 'Error', value: 'error' },
      ], defaultValue: 'info' },
      { key: 'message', label: 'Message', type: 'textarea', required: true, placeholder: 'Log message' },
    ],
  },

  // --- LOGIC ---
  {
    type: 'logic.condition',
    category: 'logic',
    label: 'Condition',
    description: 'Branch based on a condition',
    icon: 'call_split',
    color: '#fbbf24',
    defaultConfig: { condition: '' },
    configFields: [
      { key: 'condition', label: 'Condition', type: 'text', required: true, placeholder: '{{previous_output.status}} === "success"', description: 'Expression to evaluate' },
    ],
  },
  {
    type: 'logic.switch',
    category: 'logic',
    label: 'Switch',
    description: 'Branch based on a value',
    icon: 'alt_route',
    color: '#fbbf24',
    defaultConfig: { value: '', cases: {}, default_case: 'default' },
    configFields: [
      { key: 'value', label: 'Switch Value', type: 'text', required: true, placeholder: '{{previous_output.type}}' },
      { key: 'cases', label: 'Cases (JSON)', type: 'json', placeholder: '{"case1": "branch1", "case2": "branch2"}' },
      { key: 'default_case', label: 'Default Case', type: 'text', defaultValue: 'default' },
    ],
  },
  {
    type: 'logic.filter',
    category: 'logic',
    label: 'Filter',
    description: 'Filter items from a list',
    icon: 'filter_list',
    color: '#fbbf24',
    defaultConfig: { condition: 'True' },
    configFields: [
      { key: 'condition', label: 'Filter Condition', type: 'text', required: true, placeholder: 'item.status === "open"', description: 'Python expression for each item' },
    ],
  },
  {
    type: 'logic.loop',
    category: 'logic',
    label: 'Loop',
    description: 'Iterate over a list',
    icon: 'loop',
    color: '#fbbf24',
    defaultConfig: { items: '' },
    configFields: [
      { key: 'items', label: 'Items', type: 'text', required: true, placeholder: '{{previous_output.items}}', description: 'Array to iterate over' },
    ],
  },
  {
    type: 'logic.delay',
    category: 'logic',
    label: 'Wait',
    description: 'Pause execution',
    icon: 'hourglass_empty',
    color: '#fbbf24',
    defaultConfig: { duration_ms: 5000 },
    configFields: [
      { key: 'duration_ms', label: 'Wait Duration (ms)', type: 'number', required: true, defaultValue: 5000 },
    ],
  },
]

// Category metadata
export const NODE_CATEGORIES: { category: NodeCategory; label: string; color: string }[] = [
  { category: 'trigger', label: 'Triggers', color: '#818cf8' },
  { category: 'action', label: 'Actions', color: '#34d399' },
  { category: 'logic', label: 'Logic', color: '#fbbf24' },
]

// Helper to get node definition by type
export function getNodeDefinition(nodeType: string): NodeTypeDefinition | undefined {
  return NODE_TYPE_DEFINITIONS.find((def) => def.type === nodeType)
}

// Helper to get category color
export function getCategoryColor(category: NodeCategory): string {
  switch (category) {
    case 'trigger': return '#818cf8'
    case 'action': return '#34d399'
    case 'logic': return '#fbbf24'
    default: return '#6b7280'
  }
}

// Validate a node's configuration
export function validateNodeConfig(node: WorkflowNode): string[] {
  const def = getNodeDefinition(node.data.nodeType)
  if (!def) return ['Unknown node type']

  const errors: string[] = []
  for (const field of def.configFields) {
    if (field.required) {
      const value = node.data.config[field.key]
      if (value === undefined || value === null || value === '') {
        errors.push(`${field.label} is required`)
      }
    }
  }
  return errors
}
