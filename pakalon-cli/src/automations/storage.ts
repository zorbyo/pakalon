/**
 * Automation Persistence — stores automations locally as JSON.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AutomationRecord } from "./types.js";
import { debugLog } from "@/utils/logger.js";

function storagePath(): string {
  return path.join(os.homedir(), ".config", "pakalon", "automations.json");
}

function readAutomations(): AutomationRecord[] {
  try {
    const raw = fs.readFileSync(storagePath(), "utf-8");
    return JSON.parse(raw) as AutomationRecord[];
  } catch {
    return [];
  }
}

function writeAutomations(automations: AutomationRecord[]): void {
  const filePath = storagePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(automations, null, 2), "utf-8");
  debugLog(`[automations] Persisted ${automations.length} automation(s)`);
}

export function getAutomation(id: string): AutomationRecord | null {
  const automations = readAutomations();
  return automations.find((a) => a.id === id) ?? null;
}

export function getAutomationByName(name: string): AutomationRecord | null {
  const automations = readAutomations();
  return automations.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export function getAllAutomations(): AutomationRecord[] {
  return readAutomations();
}

export function saveAutomation(automation: AutomationRecord): void {
  const automations = readAutomations();
  const idx = automations.findIndex((a) => a.id === automation.id);
  if (idx >= 0) {
    automations[idx] = automation;
    debugLog(`[automations] Updated: ${automation.name}`);
  } else {
    automations.push(automation);
    debugLog(`[automations] Created: ${automation.name}`);
  }
  writeAutomations(automations);
}

export function deleteAutomation(id: string): boolean {
  const automations = readAutomations();
  const idx = automations.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  const removed = automations.splice(idx, 1)[0];
  writeAutomations(automations);
  debugLog(`[automations] Deleted: ${removed?.name}`);
  return true;
}

export function updateAutomationStatus(
  id: string,
  updates: Partial<Pick<AutomationRecord, "enabled" | "lastRunAt" | "lastStatus" | "lastError">>
): AutomationRecord | null {
  const automations = readAutomations();
  const idx = automations.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  automations[idx] = { ...automations[idx]!, ...updates, updatedAt: new Date().toISOString() };
  writeAutomations(automations);
  return automations[idx]!;
}
