import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PakalonMode = "cloud" | "selfhosted";

export interface LocalProviderEndpoint {
  baseUrl: string;
  enabled: boolean;
}

export interface LocalProviderConfig {
  ollama?: LocalProviderEndpoint;
  lmstudio?: LocalProviderEndpoint;
}

export interface ModeConfig {
  mode: PakalonMode;
  localProviders: LocalProviderConfig;
  features: {
    telemetry: boolean;
    cloudSync: boolean;
    auth: boolean;
  };
  storage: {
    type: "sqlite";
    path: string;
  };
}

type RawModeConfig = Partial<{
  mode: string;
  localProviders: LocalProviderConfig;
  local_providers: {
    ollama?: { base_url?: string; baseUrl?: string; enabled?: boolean };
    lmstudio?: { base_url?: string; baseUrl?: string; enabled?: boolean };
  };
  features: Partial<ModeConfig["features"]>;
  storage: Partial<ModeConfig["storage"]>;
}>;

function getConfigDir(): string {
  if (process.env.PAKALON_CONFIG_DIR) {
    return expandHome(process.env.PAKALON_CONFIG_DIR);
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "pakalon");
  }

  return path.join(os.homedir(), ".config", "pakalon");
}

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function normalizeMode(value?: string | null): PakalonMode | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "selfhosted" || normalized === "self-hosted" || normalized === "local") {
    return "selfhosted";
  }
  if (normalized === "cloud" || normalized === "saas") return "cloud";
  return null;
}

function readJsonFile(filePath: string): RawModeConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as RawModeConfig;
  } catch {
    return null;
  }
}

function getConfigCandidates(): string[] {
  return [
    process.env.PAKALON_CONFIG_FILE ? expandHome(process.env.PAKALON_CONFIG_FILE) : null,
    path.join(os.homedir(), ".pakalon", "config.json"),
    path.join(getConfigDir(), "config.json"),
    path.join(process.cwd(), ".pakalon", "config.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function loadRawConfig(): RawModeConfig {
  for (const candidate of getConfigCandidates()) {
    const config = readJsonFile(candidate);
    if (config) return config;
  }
  return {};
}

function hasSelfHostedEnvFlag(): boolean {
  if (process.env.SELFHOSTED?.toLowerCase() === "true") return true;
  if (process.env.PAKALON_SELFHOSTED?.toLowerCase() === "true") return true;

  const envPath = path.join(process.cwd(), ".env");
  try {
    if (!fs.existsSync(envPath)) return false;
    const raw = fs.readFileSync(envPath, "utf8");
    return /^SELFHOSTED\s*=\s*true\s*$/im.test(raw);
  } catch {
    return false;
  }
}

function normalizeProvider(
  provider: LocalProviderEndpoint | { base_url?: string; baseUrl?: string; enabled?: boolean } | undefined,
  fallbackBaseUrl: string,
): LocalProviderEndpoint {
  const baseUrl = provider
    ? ("base_url" in provider ? provider.base_url ?? provider.baseUrl : provider.baseUrl)
    : undefined;

  return {
    baseUrl: baseUrl ?? fallbackBaseUrl,
    enabled: provider?.enabled ?? true,
  };
}

export function detectMode(): PakalonMode {
  const envMode = normalizeMode(process.env.PAKALON_MODE);
  if (envMode) return envMode;

  const rawConfig = loadRawConfig();
  const configMode = normalizeMode(rawConfig.mode);
  if (configMode) return configMode;

  if (hasSelfHostedEnvFlag()) return "selfhosted";

  return "cloud";
}

export function isSelfHosted(): boolean {
  return detectMode() === "selfhosted";
}

export function loadModeConfig(): ModeConfig {
  const rawConfig = loadRawConfig();
  const mode = detectMode();
  const legacyProviders = rawConfig.local_providers ?? {};
  const localProviders = rawConfig.localProviders ?? {};
  const defaultStoragePath = path.join(os.homedir(), ".pakalon", "local.db");

  return {
    mode,
    localProviders: {
      ollama: normalizeProvider(
        localProviders.ollama ?? legacyProviders.ollama,
        process.env.PAKALON_OLLAMA_URL ?? "http://localhost:11434",
      ),
      lmstudio: normalizeProvider(
        localProviders.lmstudio ?? legacyProviders.lmstudio,
        process.env.PAKALON_LMSTUDIO_URL ?? "http://localhost:1234",
      ),
    },
    features: {
      telemetry: rawConfig.features?.telemetry ?? mode === "cloud",
      cloudSync: rawConfig.features?.cloudSync ?? mode === "cloud",
      auth: rawConfig.features?.auth ?? mode === "cloud",
    },
    storage: {
      type: "sqlite",
      path: expandHome(process.env.PAKALON_LOCAL_DB ?? rawConfig.storage?.path ?? defaultStoragePath),
    },
  };
}

export function ensureConfigDir(): string {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
