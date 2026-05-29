import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type MessageState = 'pending' | 'in_progress' | 'completed' | 'error'

export class MessageNode {
  id: string
  content: string
  role: MessageRole
  parentId?: string
  children: string[]
  state: MessageState
  timestamp: string

  constructor(params: {
    id?: string
    content: string
    role: MessageRole
    parentId?: string
    children?: string[]
    state?: MessageState
    timestamp?: string
  }) {
    this.id = params.id ?? randomUUID()
    this.content = params.content
    this.role = params.role
    this.parentId = params.parentId
    this.children = [...(params.children ?? [])]
    this.state = params.state ?? 'pending'
    this.timestamp = params.timestamp ?? new Date().toISOString()
  }
}

export class MessageTree {
  rootId: string
  nodes: Map<string, MessageNode>
  activeNodeId: string

  constructor(rootContent = '', rootRole: MessageRole = 'system') {
    const root = new MessageNode({ content: rootContent, role: rootRole, state: 'completed' })
    this.rootId = root.id
    this.nodes = new Map([[root.id, root]])
    this.activeNodeId = root.id
  }

  getNode(id: string): MessageNode | undefined {
    return this.nodes.get(id)
  }

  addNode(content: string, role: MessageRole, parentId?: string): MessageNode {
    const resolvedParentId = parentId ?? this.activeNodeId
    const parent = this.nodes.get(resolvedParentId)
    if (!parent) {
      throw new Error(`Parent node not found: ${resolvedParentId}`)
    }

    const node = new MessageNode({ content, role, parentId: resolvedParentId, state: 'in_progress' })
    parent.children.push(node.id)
    this.nodes.set(node.id, node)
    this.activeNodeId = node.id
    return node
  }

  forkNode(nodeId: string): MessageNode {
    const source = this.nodes.get(nodeId)
    if (!source) {
      throw new Error(`Node not found: ${nodeId}`)
    }

    const fork = new MessageNode({
      content: source.content,
      role: source.role,
      parentId: source.id,
      state: 'pending',
    })
    source.children.push(fork.id)
    this.nodes.set(fork.id, fork)
    this.activeNodeId = fork.id
    return fork
  }

  getBranch(nodeId: string): MessageNode[] {
    return this.getPathToRoot(nodeId)
      .map((id) => this.nodes.get(id))
      .filter((node): node is MessageNode => node !== undefined)
  }

  getPathToRoot(nodeId: string): string[] {
    const pathIds: string[] = []
    let current: MessageNode | undefined = this.nodes.get(nodeId)
    while (current) {
      pathIds.unshift(current.id)
      current = current.parentId ? this.nodes.get(current.parentId) : undefined
    }
    return pathIds
  }

  // ── Branch Summarization ────────────────────────────────────────────────

  /**
   * Get the branch path from root to a given node as readable text.
   * Useful for generating a summary of a conversation branch.
   */
  getBranchAsText(nodeId?: string): string {
    const targetId = nodeId ?? this.activeNodeId
    return this.getBranch(targetId)
      .map(n => `[${n.role}] ${n.content.slice(0, 200)}`)
      .join('\n')
  }

  /**
   * Get all leaf nodes (branches that haven't been continued).
   * Leaf nodes represent the "ends" of each conversation path.
   */
  getLeafNodes(): MessageNode[] {
    return [...this.nodes.values()].filter(n => n.children.length === 0)
  }

  /**
   * Get branch paths for all leaf branches with depth information.
   */
  getBranchPaths(): Array<{ nodeId: string; path: string[]; depth: number }> {
    return this.getLeafNodes().map(leaf => ({
      nodeId: leaf.id,
      path: this.getPathToRoot(leaf.id),
      depth: this.getPathToRoot(leaf.id).length,
    }))
  }

  /**
   * Generate a summary of a branch.
   *
   * If a summarizeFn is provided (e.g., an LLM-based summarizer), it will
   * be used for intelligent summarization. Otherwise, a simple extractive
   * summary is generated.
   */
  async summarizeBranch(
    nodeId?: string,
    summarizeFn?: (text: string) => Promise<string>,
  ): Promise<string> {
    const targetId = nodeId ?? this.activeNodeId
    const branch = this.getBranch(targetId)
    const branchText = branch
      .map(n => `[${n.role}] ${n.content}`)
      .join('\n\n')

    if (summarizeFn) {
      return await summarizeFn(branchText)
    }

    // Default extractive summary
    return branch
      .map(n => {
        const preview = n.content.slice(0, 100).replace(/\n/g, ' ')
        return `- ${n.role}: ${preview}${n.content.length > 100 ? '...' : ''}`
      })
      .join('\n')
  }

  /**
   * Summarize all leaf branches for navigation and overview.
   * Returns an array of summaries, one per leaf branch.
   */
  async summarizeAllBranches(
    summarizeFn?: (text: string) => Promise<string>,
  ): Promise<Array<{ nodeId: string; depth: number; summary: string; messageCount: number }>> {
    const leaves = this.getLeafNodes()
    const results: Array<{ nodeId: string; depth: number; summary: string; messageCount: number }> = []

    for (const leaf of leaves) {
      const branch = this.getBranch(leaf.id)
      const summary = await this.summarizeBranch(leaf.id, summarizeFn)
      results.push({
        nodeId: leaf.id,
        depth: branch.length,
        summary,
        messageCount: branch.length,
      })
    }

    return results
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  /**
   * Navigate to a sibling branch (next or previous child of same parent).
   * Returns the sibling node, or null if no sibling in that direction.
   */
  navigateSibling(direction: 'next' | 'prev'): MessageNode | null {
    const current = this.nodes.get(this.activeNodeId)
    if (!current?.parentId) return null

    const parent = this.nodes.get(current.parentId)
    if (!parent) return null

    const siblingIndex = parent.children.indexOf(current.id)
    if (siblingIndex === -1) return null

    const newIndex = direction === 'next' ? siblingIndex + 1 : siblingIndex - 1
    if (newIndex < 0 || newIndex >= parent.children.length) return null

    const siblingId = parent.children[newIndex]
    if (!siblingId) return null

    this.activeNodeId = siblingId
    return this.nodes.get(siblingId) ?? null
  }

  /**
   * Get the depth of a node from the root.
   */
  getDepth(nodeId?: string): number {
    return this.getPathToRoot(nodeId ?? this.activeNodeId).length
  }

  /**
   * Get the number of branches (leaf nodes) in the tree.
   */
  getBranchCount(): number {
    return this.getLeafNodes().length
  }

  /**
   * Get the total number of nodes in the tree.
   */
  getNodeCount(): number {
    return this.nodes.size
  }

  // ── Branch Diffing ──────────────────────────────────────────────────────

  /**
   * Find the common ancestor between two nodes.
   * Returns the deepest node that is an ancestor of both.
   */
  findCommonAncestor(nodeId1: string, nodeId2: string): MessageNode | null {
    const path1 = this.getPathToRoot(nodeId1)
    const path2 = this.getPathToRoot(nodeId2)

    let common: MessageNode | null = null
    for (let i = 0; i < Math.min(path1.length, path2.length); i++) {
      if (path1[i] === path2[i]) {
        const node = this.nodes.get(path1[i]!)
        if (node) common = node
      } else {
        break
      }
    }

    return common
  }

  /**
   * Diff two branches to show where they diverge and their respective paths.
   */
  diffBranches(nodeId1: string, nodeId2: string): {
    commonAncestor: MessageNode | null
    branch1Path: string[]
    branch2Path: string[]
    branch1Length: number
    branch2Length: number
  } {
    const commonAncestor = this.findCommonAncestor(nodeId1, nodeId2)
    const path1 = this.getPathToRoot(nodeId1)
    const path2 = this.getPathToRoot(nodeId2)

    // Find where paths diverge
    let divergeIndex = 0
    while (
      divergeIndex < path1.length &&
      divergeIndex < path2.length &&
      path1[divergeIndex] === path2[divergeIndex]
    ) {
      divergeIndex++
    }

    return {
      commonAncestor,
      branch1Path: path1.slice(divergeIndex),
      branch2Path: path2.slice(divergeIndex),
      branch1Length: path1.length - divergeIndex,
      branch2Length: path2.length - divergeIndex,
    }
  }

  // ── Visualization ───────────────────────────────────────────────────────

  /**
   * Render the tree as an ASCII tree diagram for debugging.
   */
  visualize(nodeId?: string, indent = ''): string {
    const targetId = nodeId ?? this.rootId
    const node = this.nodes.get(targetId)
    if (!node) return ''

    const isActive = targetId === this.activeNodeId
    const marker = isActive ? '◉' : '○'
    const roleLabel = node.role.padEnd(10)
    const preview = node.content.slice(0, 40).replace(/\n/g, '\\n')

    let result = `${indent}${marker} ${roleLabel} ${preview}${node.content.length > 40 ? '...' : ''}\n`

    for (const childId of node.children) {
      result += this.visualize(childId, indent + '  ')
    }

    return result
  }
}

export interface TreeSessionData {
  sessionId: string
  tree: SerializedMessageTree
  savedAt: string
}

export interface SerializedMessageNode {
  id: string
  content: string
  role: MessageRole
  parentId?: string
  children: string[]
  state: MessageState
  timestamp: string
}

export interface SerializedMessageTree {
  rootId: string
  activeNodeId: string
  nodes: SerializedMessageNode[]
}

function getTreeDir(): string {
  const base = process.env.PAKALON_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'pakalon')
  const dir = path.join(base, 'trees')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function treePath(sessionId: string): string {
  return path.join(getTreeDir(), `${sessionId}.json`)
}

function serializeTree(tree: MessageTree): SerializedMessageTree {
  return {
    rootId: tree.rootId,
    activeNodeId: tree.activeNodeId,
    nodes: [...tree.nodes.values()].map((node) => ({
      id: node.id,
      content: node.content,
      role: node.role,
      parentId: node.parentId,
      children: [...node.children],
      state: node.state,
      timestamp: node.timestamp,
    })),
  }
}

function deserializeTree(serialized: SerializedMessageTree): MessageTree {
  const tree = Object.create(MessageTree.prototype) as MessageTree
  tree.rootId = serialized.rootId
  tree.activeNodeId = serialized.activeNodeId
  tree.nodes = new Map<string, MessageNode>()

  for (const node of serialized.nodes) {
    tree.nodes.set(node.id, new MessageNode(node))
  }

  return tree
}

export class TreeSessionStore {
  saveTree(sessionId: string, tree: MessageTree): void {
    const data: TreeSessionData = {
      sessionId,
      tree: serializeTree(tree),
      savedAt: new Date().toISOString(),
    }
    fs.writeFileSync(treePath(sessionId), JSON.stringify(data, null, 2), 'utf-8')
  }

  loadTree(sessionId: string): MessageTree | null {
    const filePath = treePath(sessionId)
    if (!fs.existsSync(filePath)) {
      return null
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const data = parsed as Partial<TreeSessionData>
    if (!data.tree || !Array.isArray(data.tree.nodes)) {
      return null
    }

    return deserializeTree(data.tree)
  }

  listTrees(): string[] {
    return fs
      .readdirSync(getTreeDir())
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''))
  }
}

export function createTreeSession(rootContent = '', rootRole: MessageRole = 'system'): MessageTree {
  return new MessageTree(rootContent, rootRole)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree Session Navigator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-level navigator for a MessageTree.
 * Provides convenience methods for traversing the tree.
 */
export class TreeSessionNavigator {
  private tree: MessageTree

  constructor(tree: MessageTree) {
    this.tree = tree
  }

  /** Navigate to a specific node by ID */
  goTo(nodeId: string): boolean {
    if (!this.tree.getNode(nodeId)) return false
    this.tree.activeNodeId = nodeId
    return true
  }

  /** Navigate to the parent of the current node */
  goUp(): boolean {
    const current = this.tree.getNode(this.tree.activeNodeId)
    if (!current?.parentId) return false
    this.tree.activeNodeId = current.parentId
    return true
  }

  /** Navigate to a child of the current node by index */
  goDown(index: number): boolean {
    const current = this.tree.getNode(this.tree.activeNodeId)
    if (!current) return false
    const childId = current.children[index]
    if (!childId) return false
    this.tree.activeNodeId = childId
    return true
  }

  /** Navigate to the next sibling */
  goNext(): boolean {
    return this.tree.navigateSibling('next') !== null
  }

  /** Navigate to the previous sibling */
  goPrev(): boolean {
    return this.tree.navigateSibling('prev') !== null
  }

  /** Navigate to the root node */
  goToRoot(): void {
    this.tree.activeNodeId = this.tree.rootId
  }

  /** Get the current branch path as breadcrumbs */
  getBreadcrumbs(): Array<{ nodeId: string; role: string; summary: string }> {
    const path = this.tree.getPathToRoot(this.tree.activeNodeId)
    return path.map(id => {
      const node = this.tree.getNode(id)!
      return {
        nodeId: id,
        role: node.role,
        summary: node.content.slice(0, 50).replace(/\n/g, ' '),
      }
    })
  }

  /** Get all leaf branches with summaries */
  async getBranchOverview(
    summarizeFn?: (text: string) => Promise<string>,
  ): Promise<Array<{ nodeId: string; depth: number; summary: string }>> {
    return await this.tree.summarizeAllBranches(summarizeFn)
  }

  /** Check if navigation to parent is possible */
  canGoUp(): boolean {
    const current = this.tree.getNode(this.tree.activeNodeId)
    return !!current?.parentId
  }

  /** Check if navigation to children is possible */
  canGoDown(): boolean {
    const current = this.tree.getNode(this.tree.activeNodeId)
    return !!current && current.children.length > 0
  }

  /** Check if navigation to siblings is possible */
  canGoNext(): boolean {
    const current = this.tree.getNode(this.tree.activeNodeId)
    if (!current?.parentId) return false
    const parent = this.tree.getNode(current.parentId)
    if (!parent) return false
    const idx = parent.children.indexOf(current.id)
    return idx >= 0 && idx < parent.children.length - 1
  }

  canGoPrev(): boolean {
    const current = this.tree.getNode(this.tree.activeNodeId)
    if (!current?.parentId) return false
    const parent = this.tree.getNode(current.parentId)
    if (!parent) return false
    const idx = parent.children.indexOf(current.id)
    return idx > 0
  }
}
