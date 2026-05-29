/**
 * Skill Evolution Tracker - Track skill usage and improvement over time
 * 
 * Monitors which skills are used, how effective they are,
 * and suggests improvements based on usage patterns.
 */

import fs from "fs/promises";
import path from "path";

export interface SkillUsageEvent {
  skillName: string;
  timestamp: Date;
  success: boolean;
  duration: number;
  error?: string;
}

export interface SkillEvolution {
  skillName: string;
  totalUses: number;
  successfulUses: number;
  failedUses: number;
  averageDuration: number;
  lastUsed: Date;
  firstUsed: Date;
  successRate: number;
  trend: "improving" | "stable" | "declining";
  recommendations: string[];
}

export interface SkillEvolutionReport {
  generatedAt: Date;
  totalSkillsTracked: number;
  mostUsed: SkillEvolution[];
  underperforming: SkillEvolution[];
  recommendations: string[];
  evolutionData: Record<string, SkillEvolution>;
}

const SKILL_TRACKING_FILE = ".pakalon/skill-evolution.json";

class SkillEvolutionTracker {
  private usageEvents: SkillUsageEvent[] = [];
  private trackingPath: string;

  constructor(projectDir: string) {
    this.trackingPath = path.join(projectDir, SKILL_TRACKING_FILE);
  }

  async initialize(): Promise<void> {
    try {
      const data = await fs.readFile(this.trackingPath, "utf-8");
      const parsed = JSON.parse(data);
      this.usageEvents = (parsed.events || []).map((e: any) => ({
        ...e,
        timestamp: new Date(e.timestamp),
      }));
    } catch {
      this.usageEvents = [];
    }
  }

  async recordUsage(event: Omit<SkillUsageEvent, "timestamp">): Promise<void> {
    const fullEvent: SkillUsageEvent = {
      ...event,
      timestamp: new Date(),
    };

    this.usageEvents.push(fullEvent);

    if (this.usageEvents.length > 10000) {
      this.usageEvents = this.usageEvents.slice(-5000);
    }

    await this.persist();
  }

  async getSkillEvolution(skillName: string): Promise<SkillEvolution | null> {
    const skillEvents = this.usageEvents.filter((e) => e.skillName === skillName);

    if (skillEvents.length === 0) {
      return null;
    }

    const successfulUses = skillEvents.filter((e) => e.success).length;
    const failedUses = skillEvents.filter((e) => !e.success).length;
    const totalDuration = skillEvents.reduce((sum, e) => sum + e.duration, 0);

    const now = new Date();
    const recentEvents = skillEvents.filter(
      (e) => now.getTime() - e.timestamp.getTime() < 7 * 24 * 60 * 60 * 1000
    );
    const olderEvents = skillEvents.filter(
      (e) => now.getTime() - e.timestamp.getTime() >= 7 * 24 * 60 * 60 * 1000 &&
             now.getTime() - e.timestamp.getTime() < 14 * 24 * 60 * 60 * 1000
    );

    let trend: SkillEvolution["trend"] = "stable";
    if (recentEvents.length > 0 && olderEvents.length > 0) {
      const recentSuccessRate = recentEvents.filter((e) => e.success).length / recentEvents.length;
      const olderSuccessRate = olderEvents.filter((e) => e.success).length / olderEvents.length;

      if (recentSuccessRate > olderSuccessRate + 0.1) {
        trend = "improving";
      } else if (recentSuccessRate < olderSuccessRate - 0.1) {
        trend = "declining";
      }
    }

    const recommendations: string[] = [];
    if (failedUses > successfulUses) {
      recommendations.push("High failure rate. Consider reviewing the skill instructions.");
    }
    if (trend === "declining") {
      recommendations.push("Success rate is declining. Review recent failures for patterns.");
    }
    if (skillEvents.length > 100 && failedUses / skillEvents.length < 0.05) {
      recommendations.push("Highly reliable skill. Consider using it as a template.");
    }

    const sortedEvents = [...skillEvents].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    return {
      skillName,
      totalUses: skillEvents.length,
      successfulUses,
      failedUses,
      averageDuration: totalDuration / skillEvents.length,
      lastUsed: skillEvents[skillEvents.length - 1].timestamp,
      firstUsed: sortedEvents[0].timestamp,
      successRate: successfulUses / skillEvents.length,
      trend,
      recommendations,
    };
  }

  async generateReport(): Promise<SkillEvolutionReport> {
    const skillNames = [...new Set(this.usageEvents.map((e) => e.skillName))];
    const evolutionData: Record<string, SkillEvolution> = {};
    const mostUsed: SkillEvolution[] = [];
    const underperforming: SkillEvolution[] = [];

    for (const name of skillNames) {
      const evolution = await this.getSkillEvolution(name);
      if (evolution) {
        evolutionData[name] = evolution;
        mostUsed.push(evolution);
        if (evolution.successRate < 0.5) {
          underperforming.push(evolution);
        }
      }
    }

    mostUsed.sort((a, b) => b.totalUses - a.totalUses);
    underperforming.sort((a, b) => a.successRate - b.successRate);

    const recommendations: string[] = [];
    if (underperforming.length > 0) {
      recommendations.push(
        `${underperforming.length} skill(s) have success rate below 50%. Consider updating or disabling them.`
      );
    }
    if (Object.keys(evolutionData).length > 10) {
      recommendations.push(
        "Consider pruning rarely-used skills to reduce clutter."
      );
    }

    return {
      generatedAt: new Date(),
      totalSkillsTracked: skillNames.length,
      mostUsed: mostUsed.slice(0, 10),
      underperforming: underperforming.slice(0, 5),
      recommendations,
      evolutionData,
    };
  }

  async clearHistory(skillName?: string): Promise<void> {
    if (skillName) {
      this.usageEvents = this.usageEvents.filter((e) => e.skillName !== skillName);
    } else {
      this.usageEvents = [];
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.trackingPath), { recursive: true });
    await fs.writeFile(
      this.trackingPath,
      JSON.stringify(
        {
          events: this.usageEvents.map((e) => ({
            ...e,
            timestamp: e.timestamp.toISOString(),
          })),
        },
        null,
        2
      )
    );
  }
}

let globalTracker: SkillEvolutionTracker | null = null;

export async function initializeSkillEvolutionTracker(
  projectDir: string
): Promise<SkillEvolutionTracker> {
  globalTracker = new SkillEvolutionTracker(projectDir);
  await globalTracker.initialize();
  return globalTracker;
}

export function getSkillEvolutionTracker(): SkillEvolutionTracker | null {
  return globalTracker;
}

export async function recordSkillUsage(
  skillName: string,
  success: boolean,
  duration: number,
  error?: string
): Promise<void> {
  if (globalTracker) {
    await globalTracker.recordUsage({ skillName, success, duration, error });
  }
}

export async function getSkillEvolution(
  skillName: string
): Promise<SkillEvolution | null> {
  if (globalTracker) {
    return globalTracker.getSkillEvolution(skillName);
  }
  return null;
}

export async function generateSkillEvolutionReport(): Promise<SkillEvolutionReport | null> {
  if (globalTracker) {
    return globalTracker.generateReport();
  }
  return null;
}