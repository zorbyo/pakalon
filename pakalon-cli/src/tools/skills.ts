/**
 * Skill system — on-demand domain expertise loading.
 *
 * Skills are discovered from:
 * - ~/.agents/skills
 * - .pakalon/skills
 * - target-embedded skill trees
 * - vendored everything-claude-code skill trees
 */
import { findSkillCatalogEntry, discoverSkillCatalog, searchSkillCatalog } from "@/skills/catalog.js";

export interface Skill {
  name: string;
  description: string;
  content?: string;
  source: "global" | "project" | "embedded" | "vendored";
  path: string;
}

function toToolSkill(entry: {
  name: string;
  description: string;
  content?: string;
  source: "global" | "project" | "embedded" | "vendored";
  path: string;
}): Skill {
  return {
    name: entry.name,
    description: entry.description,
    content: entry.content,
    source: entry.source,
    path: entry.path,
  };
}

/**
 * List available skills from project, global, embedded, and vendored sources.
 */
export function listSkills(projectDir?: string): Skill[] {
  return discoverSkillCatalog({ includeContent: false, projectDir }).map(toToolSkill);
}

/**
 * Load a specific skill by exact or fuzzy name.
 */
export function loadSkill(skillName: string, projectDir?: string): Skill | null {
  const skill = findSkillCatalogEntry(skillName, { includeContent: true, projectDir });
  return skill ? toToolSkill(skill) : null;
}

/**
 * Search skills by keyword, trigger, or body content.
 */
export function searchSkills(query: string, projectDir?: string): Skill[] {
  return searchSkillCatalog(query, { includeContent: true, projectDir }).map(toToolSkill);
}
