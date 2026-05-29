/**
 * Skill-Aware Tool Router
 *
 * Routes tool usage based on active skills. This enables:
 *   1. Permission-aware tool sorting — when in a skill context, sort
 *      skill-allowed tools higher and skill-restricted tools lower
 *   2. Skill restriction filtering — tools not allowed by active
 *      skills can be hidden or demoted
 *   3. Tool suggestion ordering — suggest tools that match the
 *      current skill context first
 */

import type { ToolPermissionContext, PermissionMode } from "./tool-types.js";
import type { ToolDefinition } from "./executor.js";

// ============================================================================
// Types
// ============================================================================

export interface SkillToolRules {
  /** Tool names that this skill allows (empty = all allowed) */
  allowedTools: string[];
  /** Tool names that this skill explicitly restricts */
  restrictedTools: string[];
  /** Whether to deny all tools not explicitly allowed */
  denyUnlistedTools: boolean;
}

export interface SkillToolProfile {
  skillName: string;
  rules: SkillToolRules;
  priority: number; // Higher = takes precedence on conflict
}

export interface SkillAwareRoutingConfig {
  /** Whether to enable skill-based tool filtering */
  enabled: boolean;
  /** Whether to hide restricted tools (vs just demoting) */
  hideRestrictedTools: boolean;
  /** Priority threshold — skills below this are advisory only */
  advisoryPriorityThreshold: number;
  /** Whether to show skill context in tool descriptions */
  annotateWithSkillContext: boolean;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: SkillAwareRoutingConfig = {
  enabled: true,
  hideRestrictedTools: false,
  advisoryPriorityThreshold: 10,
  annotateWithSkillContext: false,
};

// ============================================================================
// Router
// ============================================================================

export class SkillAwareRouter {
  private config: SkillAwareRoutingConfig;
  private profiles: Map<string, SkillToolProfile>;

  constructor(config?: Partial<SkillAwareRoutingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.profiles = new Map();
  }

  /** Register or update a skill's tool profile. */
  registerSkillProfile(profile: SkillToolProfile): void {
    this.profiles.set(profile.skillName, profile);
  }

  /** Remove a skill's tool profile. */
  unregisterSkillProfile(skillName: string): void {
    this.profiles.delete(skillName);
  }

  /** Get the merged rules for all provided skill names. */
  getMergedRules(skillNames: string[]): SkillToolRules {
    const relevantProfiles = skillNames
      .map((name) => this.profiles.get(name))
      .filter((p): p is SkillToolProfile => p !== undefined)
      .sort((a, b) => b.priority - a.priority);

    if (relevantProfiles.length === 0) {
      return {
        allowedTools: [],
        restrictedTools: [],
        denyUnlistedTools: false,
      };
    }

    // Merge: highest priority wins for allow/restrict
    const allowedSet = new Set<string>();
    const restrictedSet = new Set<string>();
    let denyUnlisted = false;

    for (const profile of relevantProfiles) {
      for (const tool of profile.rules.allowedTools) {
        allowedSet.add(tool);
      }
      for (const tool of profile.rules.restrictedTools) {
        restrictedSet.add(tool);
      }
      if (profile.rules.denyUnlistedTools) {
        denyUnlisted = true;
      }
    }

    // Remove any tool that is restricted from the allowed list
    for (const restricted of restrictedSet) {
      allowedSet.delete(restricted);
    }

    return {
      allowedTools: Array.from(allowedSet),
      restrictedTools: Array.from(restrictedSet),
      denyUnlistedTools: denyUnlisted,
    };
  }

  /**
   * Filter and sort tools based on active skills.
   *
   * @param tools All available tools
   * @param skillNames Active skill names
   * @param permissionContext Current permission context
   * @returns Sorted/filtered tool arrays
   */
  routeTools(
    tools: ToolDefinition[],
    skillNames: string[],
    permissionContext: ToolPermissionContext,
  ): {
    primaryTools: ToolDefinition[];
    restrictedTools: ToolDefinition[];
    blockedTools: ToolDefinition[];
  } {
    if (!this.config.enabled || skillNames.length === 0) {
      return {
        primaryTools: tools,
        restrictedTools: [],
        blockedTools: [],
      };
    }

    const rules = this.getMergedRules(skillNames);
    const primary: ToolDefinition[] = [];
    const restricted: ToolDefinition[] = [];
    const blocked: ToolDefinition[] = [];

    for (const tool of tools) {
      const toolName = tool.name ?? tool.method ?? "";

      // Check if tool is explicitly restricted
      if (rules.restrictedTools.includes(toolName)) {
        if (this.config.hideRestrictedTools) {
          blocked.push(tool);
        } else {
          restricted.push(tool);
        }
        continue;
      }

      // Check if tool is explicitly allowed
      if (rules.allowedTools.length > 0) {
        if (rules.allowedTools.includes(toolName)) {
          primary.push(tool);
        } else if (rules.denyUnlistedTools) {
          blocked.push(tool);
        } else {
          // Not in allowed list but denyUnlisted is false: demote to restricted
          restricted.push(tool);
        }
      } else {
        // No allowed list: everything is primary unless restricted or denied
        primary.push(tool);
      }
    }

    // Sort each list: write tools before read tools, then alphabetically
    const sortTools = (list: ToolDefinition[]) => {
      list.sort((a, b) => {
        const aName = a.name ?? a.method ?? "";
        const bName = b.name ?? b.method ?? "";
        const aIsRead = this.isReadTool(aName);
        const bIsRead = this.isReadTool(bName);
        if (aIsRead !== bIsRead) return aIsRead ? 1 : -1;
        return aName.localeCompare(bName);
      });
    };

    sortTools(primary);
    sortTools(restricted);
    sortTools(blocked);

    return { primaryTools: primary, restrictedTools, blockedTools };
  }

  /**
   * Annotate tool descriptions with skill context when enabled.
   */
  annotateToolDescription(
    description: string,
    toolName: string,
    skillNames: string[],
  ): string {
    if (!this.config.annotateWithSkillContext || skillNames.length === 0) {
      return description;
    }

    const rules = this.getMergedRules(skillNames);

    if (rules.restrictedTools.includes(toolName)) {
      return `${description} [restricted by active skills: ${skillNames.join(", ")}]`;
    }

    if (rules.allowedTools.includes(toolName)) {
      return `${description} [preferred by active skills: ${skillNames.join(", ")}]`;
    }

    return description;
  }

  /** Get the current config. */
  getConfig(): SkillAwareRoutingConfig {
    return { ...this.config };
  }

  /** Update config. */
  updateConfig(config: Partial<SkillAwareRoutingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Get all registered profiles. */
  getAllProfiles(): SkillToolProfile[] {
    return Array.from(this.profiles.values());
  }

  // -- Private helpers --

  private isReadTool(toolName: string): boolean {
    const readPrefixes = [
      "read",
      "grep",
      "glob",
      "search",
      "list",
      "view",
      "lsp",
      "show",
    ];
    return readPrefixes.some((prefix) =>
      toolName.toLowerCase().startsWith(prefix),
    );
  }
}
