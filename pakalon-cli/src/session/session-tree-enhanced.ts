/**
 * Enhanced Session Tree — Branch summarization, forking, move/navigate, checkpoint/rollback.
 *
 * Provides comprehensive session tree management:
 * - Branch summarization with LLM
 * - Session forking (SessionForkOptions)
 * - Session move/navigate (moveTo, navigateTree)
 * - Checkpoint/rollback
 * - Branch diffing
 * - Tree visualization
 *
 * Port from Pi's session tree patterns.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";
export type MessageState = "pending" | "in_progress" | "completed" | "error";

export interface TreeNode {
  id: string;
  content: string;
  role: MessageRole;
  parentId?: string;
  children: string[];
  state: MessageState;
  timestamp: string;
  metadata?: Record<string, unknown>;
  tokenCount?: number;
}

export interface SessionForkOptions {
  /** Source node ID to fork from */
  sourceNodeId: string;
  /** New content for the forked branch */
  content?: string;
  /** Whether to copy children */
  copyChildren?: boolean;
  /** Metadata for the new node */
  metadata?: Record<string, unknown>;
}

export interface CheckpointData {
  /** Checkpoint ID */
  id: string;
  /** Session ID */
  sessionId: string;
  /** Tree snapshot */
  tree: SerializedMessageTree;
  /** Checkpoint label */
  label?: string;
  /** When checkpoint was created */
  createdAt: Date;
  /** Token count at checkpoint */
  tokenCount?: number;
}

export interface BranchSummary {
  /** Branch node ID */
  nodeId: string;
  /** Summary text */
  summary: string;
  /** Message count in branch */
  messageCount: number;
  /** Token count in branch */
  tokenCount: number;
  /** Branch depth */
  depth: number;
}

export interface SerializedMessageTree {
  rootId: string;
  activeNodeId: string;
  nodes: Array<{
    id: string;
    content: string;
    role: MessageRole;
    parentId?: string;
    children: string[];
    state: MessageState;
    timestamp: string;
    metadata?: Record<string, unknown>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Message Tree
// ─────────────────────────────────────────────────────────────────────────────

export class EnhancedMessageTree {
  rootId: string;
  nodes: Map<string, TreeNode>;
  activeNodeId: string;

  constructor(rootContent = "", rootRole: MessageRole = "system") {
    const root: TreeNode = {
      id: randomUUID(),
      content: rootContent,
      role: rootRole,
      children: [],
      state: "completed",
      timestamp: new Date().toISOString(),
    };
    this.rootId = root.id;
    this.nodes = new Map([[root.id, root]]);
    this.activeNodeId = root.id;
  }

  /**
   * Add a new node.
   */
  addNode(content: string, role: MessageRole, parentId?: string): TreeNode {
    const resolvedParentId = parentId ?? this.activeNodeId;
    const parent = this.nodes.get(resolvedParentId);
    if (!parent) {
      throw new Error(`Parent node not found: ${resolvedParentId}`);
    }

    const node: TreeNode = {
      id: randomUUID(),
      content,
      role,
      parentId: resolvedParentId,
      children: [],
      state: "in_progress",
      timestamp: new Date().toISOString(),
    };

    parent.children.push(node.id);
    this.nodes.set(node.id, node);
    this.activeNodeId = node.id;

    return node;
  }

  /**
   * Fork a node (create a new branch).
   */
  forkNode(options: SessionForkOptions): TreeNode {
    const source = this.nodes.get(options.sourceNodeId);
    if (!source) {
      throw new Error(`Source node not found: ${options.sourceNodeId}`);
    }

    const fork: TreeNode = {
      id: randomUUID(),
      content: options.content ?? source.content,
      role: source.role,
      parentId: source.id,
      children: [],
      state: "pending",
      timestamp: new Date().toISOString(),
      metadata: options.metadata,
    };

    source.children.push(fork.id);
    this.nodes.set(fork.id, fork);
    this.activeNodeId = fork.id;

    // Optionally copy children
    if (options.copyChildren) {
      this.copyChildrenRecursive(source.id, fork.id);
    }

    logger.debug("[SessionTree] Forked node", {
      sourceId: source.id,
      forkId: fork.id,
    });

    return fork;
  }

  private copyChildrenRecursive(sourceParentId: string, targetParentId: string): void {
    const sourceParent = this.nodes.get(sourceParentId);
    const targetParent = this.nodes.get(targetParentId);
    if (!sourceParent || !targetParent) return;

    for (const childId of sourceParent.children) {
      const child = this.nodes.get(childId);
      if (!child) continue;

      const newChild: TreeNode = {
        id: randomUUID(),
        content: child.content,
        role: child.role,
        parentId: targetParentId,
        children: [],
        state: child.state,
        timestamp: child.timestamp,
        metadata: child.metadata ? { ...child.metadata } : undefined,
      };

      targetParent.children.push(newChild.id);
      this.nodes.set(newChild.id, newChild);

      // Recurse
      this.copyChildrenRecursive(childId, newChild.id);
    }
  }

  /**
   * Move to a specific node.
   */
  moveTo(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    this.activeNodeId = nodeId;
    return true;
  }

  /**
   * Navigate tree (get path from root to active node).
   */
  navigateTree(): TreeNode[] {
    return this.getPathToRoot(this.activeNodeId)
      .map((id) => this.nodes.get(id))
      .filter((node): node is TreeNode => node !== undefined);
  }

  /**
   * Get path from a node to root.
   */
  getPathToRoot(nodeId: string): string[] {
    const pathIds: string[] = [];
    let current: TreeNode | undefined = this.nodes.get(nodeId);
    while (current) {
      pathIds.unshift(current.id);
      current = current.parentId ? this.nodes.get(current.parentId) : undefined;
    }
    return pathIds;
  }

  /**
   * Get branch (path from leaf to root).
   */
  getBranch(nodeId: string): TreeNode[] {
    return this.getPathToRoot(nodeId)
      .map((id) => this.nodes.get(id))
      .filter((node): node is TreeNode => node !== undefined);
  }

  /**
   * Get all leaf nodes.
   */
  getLeafNodes(): TreeNode[] {
    return [...this.nodes.values()].filter((n) => n.children.length === 0);
  }

  /**
   * Summarize a branch (extractive summary).
   */
  async summarizeBranch(
    nodeId: string,
    summarizeFn?: (text: string) => Promise<string>
  ): Promise<BranchSummary> {
    const branch = this.getBranch(nodeId);
    const branchText = branch.map((n) => `[${n.role}] ${n.content}`).join("\n\n");

    let summary: string;
    if (summarizeFn) {
      summary = await summarizeFn(branchText);
    } else {
      // Default extractive summary
      summary = branch
        .map((n) => {
          const preview = n.content.slice(0, 100).replace(/\n/g, " ");
          return `- ${n.role}: ${preview}${n.content.length > 100 ? "..." : ""}`;
        })
        .join("\n");
    }

    const tokenCount = branch.reduce((sum, n) => sum + (n.tokenCount ?? 0), 0);

    return {
      nodeId,
      summary,
      messageCount: branch.length,
      tokenCount,
      depth: branch.length,
    };
  }

  /**
   * Summarize all branches.
   */
  async summarizeAllBranches(
    summarizeFn?: (text: string) => Promise<string>
  ): Promise<BranchSummary[]> {
    const leaves = this.getLeafNodes();
    const summaries: BranchSummary[] = [];

    for (const leaf of leaves) {
      const summary = await this.summarizeBranch(leaf.id, summarizeFn);
      summaries.push(summary);
    }

    return summaries;
  }

  /**
   * Create a checkpoint.
   */
  createCheckpoint(sessionId: string, label?: string): CheckpointData {
    return {
      id: randomUUID(),
      sessionId,
      tree: this.serialize(),
      label,
      createdAt: new Date(),
      tokenCount: this.getTokenCount(),
    };
  }

  /**
   * Restore from checkpoint.
   */
  restoreFromCheckpoint(checkpoint: CheckpointData): void {
    const tree = deserializeTree(checkpoint.tree);
    this.rootId = tree.rootId;
    this.nodes = tree.nodes;
    this.activeNodeId = tree.activeNodeId;

    logger.debug("[SessionTree] Restored from checkpoint", {
      checkpointId: checkpoint.id,
    });
  }

  /**
   * Get token count.
   */
  getTokenCount(): number {
    return [...this.nodes.values()].reduce((sum, n) => sum + (n.tokenCount ?? 0), 0);
  }

  /**
   * Get node count.
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Serialize tree.
   */
  serialize(): SerializedMessageTree {
    return {
      rootId: this.rootId,
      activeNodeId: this.activeNodeId,
      nodes: [...this.nodes.values()].map((n) => ({
        id: n.id,
        content: n.content,
        role: n.role,
        parentId: n.parentId,
        children: [...n.children],
        state: n.state,
        timestamp: n.timestamp,
        metadata: n.metadata,
      })),
    };
  }

  /**
   * Visualize tree as ASCII.
   */
  visualize(nodeId?: string, indent = ""): string {
    const targetId = nodeId ?? this.rootId;
    const node = this.nodes.get(targetId);
    if (!node) return "";

    const isActive = targetId === this.activeNodeId;
    const marker = isActive ? "◉" : "○";
    const roleLabel = node.role.padEnd(10);
    const preview = node.content.slice(0, 40).replace(/\n/g, "\\n");

    let result = `${indent}${marker} ${roleLabel} ${preview}${node.content.length > 40 ? "..." : ""}\n`;

    for (const childId of node.children) {
      result += this.visualize(childId, indent + "  ");
    }

    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deserialization
// ─────────────────────────────────────────────────────────────────────────────

function deserializeTree(serialized: SerializedMessageTree): EnhancedMessageTree {
  const tree = Object.create(EnhancedMessageTree.prototype) as EnhancedMessageTree;
  tree.rootId = serialized.rootId;
  tree.activeNodeId = serialized.activeNodeId;
  tree.nodes = new Map<string, TreeNode>();

  for (const node of serialized.nodes) {
    tree.nodes.set(node.id, {
      id: node.id,
      content: node.content,
      role: node.role,
      parentId: node.parentId,
      children: [...node.children],
      state: node.state,
      timestamp: node.timestamp,
      metadata: node.metadata,
    });
  }

  return tree;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Tree Store
// ─────────────────────────────────────────────────────────────────────────────

export class SessionTreeStore {
  private storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath ?? path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "pakalon",
      "trees"
    );
  }

  /**
   * Save a tree.
   */
  saveTree(sessionId: string, tree: EnhancedMessageTree): void {
    const dir = this.storePath;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${sessionId}.json`);
    const data = {
      sessionId,
      tree: tree.serialize(),
      savedAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    logger.debug("[SessionTreeStore] Saved tree", { sessionId });
  }

  /**
   * Load a tree.
   */
  loadTree(sessionId: string): EnhancedMessageTree | null {
    const filePath = path.join(this.storePath, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      return deserializeTree(data.tree);
    } catch (error) {
      logger.error("[SessionTreeStore] Failed to load tree", {
        sessionId,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * List all trees.
   */
  listTrees(): string[] {
    if (!fs.existsSync(this.storePath)) return [];

    return fs
      .readdirSync(this.storePath)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createEnhancedSessionTree(
  rootContent?: string,
  rootRole?: MessageRole
): EnhancedMessageTree {
  return new EnhancedMessageTree(rootContent, rootRole);
}

export function createSessionTreeStore(storePath?: string): SessionTreeStore {
  return new SessionTreeStore(storePath);
}
