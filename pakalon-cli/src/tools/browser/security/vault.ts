import { mkdir, readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { randomBytes } from "crypto";
import { decryptState, encryptState } from "./encryption";

export interface Credential {
  id: string;
  url: string;
  username: string;
  password: string;
}

type VaultStore = {
  version: 1;
  credentials: Credential[];
};

type VaultFile = {
  version: 1;
  payload: string;
};

const VAULT_DIR = path.join(os.homedir(), ".config", "pakalon");
const VAULT_FILE = path.join(VAULT_DIR, "browser-vault.json");
const VAULT_KEY_FILE = path.join(VAULT_DIR, "browser-vault.key");

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCredential(credential: Credential): Credential {
  if (!credential || typeof credential !== "object") {
    throw new Error("Invalid credential payload.");
  }

  const { id, url, username, password } = credential;
  if (!isNonEmptyString(id) || !isNonEmptyString(url) || !isNonEmptyString(username) || !isNonEmptyString(password)) {
    throw new Error("Credential fields must be non-empty strings.");
  }

  return {
    id: id.trim(),
    url: url.trim(),
    username: username.trim(),
    password,
  };
}

function createEmptyStore(): VaultStore {
  return { version: 1, credentials: [] };
}

async function ensureVaultDirectory(): Promise<void> {
  await mkdir(VAULT_DIR, { recursive: true });
}

async function loadOrCreateVaultKey(): Promise<string> {
  await ensureVaultDirectory();

  try {
    const existing = (await readFile(VAULT_KEY_FILE, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Fall through and generate a new key.
  }

  const generated = randomBytes(32).toString("hex");
  await writeFile(VAULT_KEY_FILE, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  return generated;
}

async function readVaultFile(): Promise<VaultFile | null> {
  try {
    const raw = await readFile(VAULT_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).version === 1 &&
      typeof (parsed as Record<string, unknown>).payload === "string"
    ) {
      return parsed as VaultFile;
    }
    throw new Error("Vault file is malformed.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error instanceof Error ? error : new Error("Failed to read vault file.");
  }
}

async function writeVaultFile(store: VaultStore, key: string): Promise<void> {
  await ensureVaultDirectory();
  const payload = await encryptState(JSON.stringify(store), key);
  const file: VaultFile = { version: 1, payload };
  await writeFile(VAULT_FILE, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function loadStore(key: string): Promise<VaultStore> {
  const file = await readVaultFile();
  if (!file) {
    return createEmptyStore();
  }

  const decrypted = await decryptState(file.payload, key);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    throw new Error("Vault contents are not valid JSON.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).version !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).credentials)
  ) {
    throw new Error("Vault store is malformed.");
  }

  const credentials = (parsed as Record<string, unknown>).credentials as unknown[];
  return {
    version: 1,
    credentials: credentials.filter((item): item is Credential => {
      if (typeof item !== "object" || item === null) {
        return false;
      }

      const record = item as Record<string, unknown>;
      return isNonEmptyString(record.id) && isNonEmptyString(record.url) && isNonEmptyString(record.username) && isNonEmptyString(record.password);
    }).map((item) => ({
      id: item.id.trim(),
      url: item.url.trim(),
      username: item.username.trim(),
      password: item.password,
    })),
  };
}

/**
 * Encrypted credential vault for browser automation.
 */
export class AuthVault {
  private keyPromise: Promise<string> | null = null;

  private getKey(): Promise<string> {
    if (!this.keyPromise) {
      this.keyPromise = loadOrCreateVaultKey();
    }
    return this.keyPromise;
  }

  /**
   * Saves or updates a credential entry.
   */
  async save(credential: Credential): Promise<void> {
    const key = await this.getKey();
    const normalized = validateCredential(credential);
    const store = await loadStore(key);

    const next = store.credentials.filter((item) => item.id !== normalized.id);
    next.push(normalized);
    await writeVaultFile({ version: 1, credentials: next }, key);
  }

  /**
   * Returns a credential by id.
   */
  async get(id: string): Promise<Credential | undefined> {
    if (!isNonEmptyString(id)) {
      return undefined;
    }

    const key = await this.getKey();
    const store = await loadStore(key);
    const found = store.credentials.find((credential) => credential.id === id.trim());
    return found ? { ...found } : undefined;
  }

  /**
   * Lists all stored credentials.
   */
  async list(): Promise<Credential[]> {
    const key = await this.getKey();
    const store = await loadStore(key);
    return store.credentials.map((credential) => ({ ...credential }));
  }

  /**
   * Deletes a credential by id.
   */
  async delete(id: string): Promise<void> {
    if (!isNonEmptyString(id)) {
      return;
    }

    const key = await this.getKey();
    const store = await loadStore(key);
    const next = store.credentials.filter((credential) => credential.id !== id.trim());

    if (next.length !== store.credentials.length) {
      await writeVaultFile({ version: 1, credentials: next }, key);
    }
  }
}
