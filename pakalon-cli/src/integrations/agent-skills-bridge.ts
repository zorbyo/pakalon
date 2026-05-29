import { getRelevantSkills, type RelevantSkill } from "@/skills/vercel-skills-importer.js";

function normalizeQaAnswers(qaAnswers: Map<string, string> | Record<string, string> | undefined): string {
  if (!qaAnswers) return "";

  if (qaAnswers instanceof Map) {
    return Array.from(qaAnswers.entries())
      .map(([question, answer]) => `${question}: ${answer}`)
      .join("\n");
  }

  return Object.entries(qaAnswers)
    .map(([question, answer]) => `${question}: ${answer}`)
    .join("\n");
}

function formatRelevantSkills(skills: RelevantSkill[]): string {
  if (!skills.length) return "";

  const lines = ["## Relevant Vercel Agent Skills", ""];

  for (const skill of skills) {
    lines.push(
      `- **${skill.name}** (${skill.category}, ${skill.relevanceScore}%)`,
      `  - ${skill.description}`,
      `  - ${skill.url}`,
    );
  }

  return lines.join("\n");
}

export async function buildAgentSkillsBridge(
  userPrompt: string,
  qaAnswers: Map<string, string> | Record<string, string> | undefined,
): Promise<string> {
  const prompt = [userPrompt, normalizeQaAnswers(qaAnswers)].filter(Boolean).join("\n\n");
  const relevantSkills = await getRelevantSkills(prompt);
  return formatRelevantSkills(relevantSkills);
}
