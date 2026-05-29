import fs from "fs";
import path from "path";
import os from "os";
import { cmdListSessions } from "@/commands/session.js";
import { debugLog } from "@/utils/logger.js";
import type { CommandDefinition } from "./types.js";

interface DreamEntry {
  topic: string;
  frequency: number;
  lastSeen: string;
  sessions: string[];
}

interface DreamsData {
  generatedAt: string;
  dreams: DreamEntry[];
}

function dreamsFilePath(): string {
  return path.join(os.homedir(), ".config", "pakalon", "memory", "dreams.json");
}

function ensureDreamsDir(): void {
  const dir = path.dirname(dreamsFilePath());
  fs.mkdirSync(dir, { recursive: true });
}

function readDreams(): DreamsData {
  try {
    const raw = fs.readFileSync(dreamsFilePath(), "utf-8");
    return JSON.parse(raw) as DreamsData;
  } catch {
    return { generatedAt: new Date().toISOString(), dreams: [] };
  }
}

function writeDreams(data: DreamsData): void {
  ensureDreamsDir();
  fs.writeFileSync(dreamsFilePath(), JSON.stringify(data, null, 2), "utf-8");
}

function extractTopics(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "can", "shall",
    "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "out", "off", "over", "under", "again",
    "further", "then", "once", "here", "there", "when", "where",
    "why", "how", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only",
    "own", "same", "so", "than", "too", "very", "just", "because",
    "about", "up", "this", "that", "these", "those", "it", "its",
    "i", "me", "my", "we", "our", "you", "your", "he", "she",
    "him", "her", "they", "them", "their", "what", "which", "who",
    "and", "but", "or", "if", "while",
  ]);

  return words.filter((w) => w.length > 3 && !stopWords.has(w));
}

export async function cmdAutoDream(sessionLimit = 50): Promise<string> {
  const sessions = await cmdListSessions(sessionLimit, null);
  const topicMap = new Map<string, { count: number; sessions: string[] }>();

  for (const session of sessions) {
    const title = session.title ?? "";
    const promptText = session.prompt_text ?? "";
    const combined = `${title} ${promptText}`;
    const topics = extractTopics(combined);
    const seen = new Set<string>();

    for (const topic of topics) {
      if (seen.has(topic)) continue;
      seen.add(topic);
      const existing = topicMap.get(topic);
      if (existing) {
        existing.count++;
        if (!existing.sessions.includes(session.id)) {
          existing.sessions.push(session.id);
        }
      } else {
        topicMap.set(topic, { count: 1, sessions: [session.id] });
      }
    }
  }

  const sorted = [...topicMap.entries()]
    .filter(([, data]) => data.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  const dreams: DreamEntry[] = sorted.map(([topic, data]) => ({
    topic,
    frequency: data.count,
    lastSeen: new Date().toISOString(),
    sessions: data.sessions,
  }));

  const dreamsData: DreamsData = {
    generatedAt: new Date().toISOString(),
    dreams,
  };

  writeDreams(dreamsData);
  debugLog(`[auto-dream] Stored ${dreams.length} dream topics`);

  if (dreams.length === 0) {
    return "No recurring topics found in recent sessions.";
  }

  const lines = [
    "── Auto-Dream: Memory Consolidation ──────────────────────",
    "",
    `Analyzed ${sessions.length} sessions — found ${dreams.length} recurring topics.`,
    "",
    ...dreams.map(
      (d) =>
        `  ${d.topic.padEnd(25)} appeared ${d.frequency}x across ${d.sessions.length} session(s)`,
    ),
    "",
    `Dream data saved to: ${dreamsFilePath()}`,
  ];

  return lines.join("\n");
}

export const autoDreamCommand: CommandDefinition = {
  name: "auto-dream",
  aliases: ["dream"],
  description: "Run memory consolidation over recent sessions",
  usage: "/auto-dream [session-limit]",
  category: "advanced",
  async execute(_context, args) {
    const rawLimit = args[0];
    const limit = rawLimit ? Number(rawLimit) : 50;
    if (!Number.isFinite(limit) || limit <= 0) {
      return {
        success: false,
        message: "Usage: /auto-dream [positive-session-limit]",
      };
    }

    const message = await cmdAutoDream(Math.floor(limit));
    return { success: true, message };
  },
};
