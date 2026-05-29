/**
 * Machine ID Tracking
 *
 * Generates and stores unique machine identifiers for:
 * - Telemetry attribution
 * - Device identification
 * - Trial abuse prevention
 *
 * IDs are stored in ~/.config/pakalon/storage.json
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '@/utils/logger.js';

export interface MachineIds {
  machineId: string;
  macMachineId: string;
  devDeviceId: string;
}

const STORAGE_DIR = path.join(os.homedir(), '.config', 'pakalon');
const STORAGE_FILE = path.join(STORAGE_DIR, 'storage.json');

/**
 * Get or create storage directory
 */
function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Read storage file
 */
function readStorage(): Record<string, unknown> {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const content = fs.readFileSync(STORAGE_FILE, 'utf-8');
      return JSON.parse(content) as Record<string, unknown>;
    }
  } catch (error) {
    logger.warn(`[machine-id] Failed to read storage: ${error}`);
  }
  return {};
}

/**
 * Write storage file
 */
function writeStorage(data: Record<string, unknown>): void {
  ensureStorageDir();
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    logger.error(`[machine-id] Failed to write storage: ${error}`);
  }
}

/**
 * Generate a UUID v4
 */
function generateUuid(): string {
  return crypto.randomUUID();
}

/**
 * Generate a machine ID based on hardware characteristics
 */
function generateMachineId(): string {
  const components = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model ?? 'unknown',
    os.totalmem().toString(),
  ];

  const hash = crypto.createHash('sha256');
  hash.update(components.join('-'));
  return hash.digest('hex').slice(0, 32);
}

/**
 * Generate a MAC-based machine ID
 */
function generateMacMachineId(): string {
  const macAddress = getMacAddress();
  const hash = crypto.createHash('sha256');
  hash.update(macAddress);
  return hash.digest('hex').slice(0, 32);
}

/**
 * Get MAC address
 */
function getMacAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (nets) {
      for (const net of nets) {
        if (net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac;
        }
      }
    }
  }
  return '00:00:00:00:00:00';
}

/**
 * Get or create machine IDs
 */
export function getMachineIds(): MachineIds {
  const storage = readStorage();
  const telemetry = storage.telemetry as Partial<MachineIds> | undefined;

  if (telemetry?.machineId && telemetry?.macMachineId && telemetry?.devDeviceId) {
    return {
      machineId: telemetry.machineId,
      macMachineId: telemetry.macMachineId,
      devDeviceId: telemetry.devDeviceId,
    };
  }

  // Generate new IDs
  const ids: MachineIds = {
    machineId: generateMachineId(),
    macMachineId: generateMacMachineId(),
    devDeviceId: generateUuid(),
  };

  // Save to storage
  storage.telemetry = ids;
  writeStorage(storage);

  logger.info('[machine-id] Generated new machine IDs');
  return ids;
}

/**
 * Reset machine IDs (for testing or privacy)
 */
export function resetMachineIds(): MachineIds {
  const ids: MachineIds = {
    machineId: generateMachineId(),
    macMachineId: generateMacMachineId(),
    devDeviceId: generateUuid(),
  };

  const storage = readStorage();
  storage.telemetry = ids;
  writeStorage(storage);

  logger.info('[machine-id] Reset machine IDs');
  return ids;
}

/**
 * Check if machine IDs exist
 */
export function hasMachineIds(): boolean {
  const storage = readStorage();
  const telemetry = storage.telemetry as Partial<MachineIds> | undefined;
  return Boolean(telemetry?.machineId && telemetry?.macMachineId && telemetry?.devDeviceId);
}

/**
 * Get machine info for telemetry
 */
export function getMachineInfo(): {
  ids: MachineIds;
  platform: string;
  arch: string;
  hostname: string;
  nodeVersion: string;
} {
  const ids = getMachineIds();
  return {
    ids,
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    nodeVersion: process.version,
  };
}
