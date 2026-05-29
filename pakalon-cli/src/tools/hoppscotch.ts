import { spawn } from "child_process";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

export interface HoppscotchRequestSpec {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: string | Record<string, unknown>;
  expectedStatus?: number;
  extractPaths?: string[];
  timeoutMs?: number;
}

export interface HoppscotchResponseSpec {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  json?: unknown;
  extracted?: Record<string, unknown>;
}

export interface HoppscotchCollectionSpec {
  name: string;
  description?: string;
  requests: HoppscotchRequestSpec[];
}

const COLLECTION_ROOT = path.join(process.cwd(), ".pakalon-agents", "hoppscotch", "collections");

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "collection";
}

function parseJsonBody(body: string | Record<string, unknown> | undefined): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

function applyQuery(url: string, query?: HoppscotchRequestSpec["query"]): string {
  if (!query) return url;
  const nextUrl = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    nextUrl.searchParams.set(key, String(value));
  }
  return nextUrl.toString();
}

function extractPath(value: unknown, pathExpr: string): unknown {
  const segments = pathExpr.replace(/^\./, "").split(".").filter(Boolean);
  let current: unknown = value;

  for (const segment of segments) {
    if (current == null) return undefined;
    const match = segment.match(/^(.*?)(?:\[(\d+)\])?$/);
    const key = match?.[1] ?? segment;
    const index = match?.[2] ? Number(match[2]) : undefined;

    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
    if (index !== undefined) {
      if (!Array.isArray(current)) return undefined;
      current = current[index];
    }
  }

  return current;
}

async function sendNativeRequest(input: HoppscotchRequestSpec): Promise<HoppscotchResponseSpec> {
  const url = applyQuery(input.url, input.query);
  const headers = new Headers(input.headers ?? {});
  const method = (input.method ?? "GET").toUpperCase();
  const body = parseJsonBody(input.body);
  if (body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
    signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  const extracted: Record<string, unknown> = {};
  for (const expr of input.extractPaths ?? []) {
    extracted[expr] = extractPath(json ?? text, expr);
  }

  if (input.expectedStatus && input.expectedStatus !== response.status) {
    extracted["assertionError"] = `Expected ${input.expectedStatus} but received ${response.status}`;
  }

  const headerObject: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headerObject[key] = value;
  });

  return {
    status: response.status,
    ok: response.ok,
    headers: headerObject,
    body: text,
    json,
    extracted: Object.keys(extracted).length ? extracted : undefined,
  };
}

async function tryHoppCli(input: HoppscotchRequestSpec): Promise<HoppscotchResponseSpec | null> {
  if (!existsSync("hopp-cli")) return null;

  return await new Promise<HoppscotchResponseSpec | null>((resolve) => {
    const args = ["--version"];
    const child = spawn("hopp-cli", args, { stdio: "ignore" });
    child.once("error", () => resolve(null));
    child.once("exit", () => resolve(null));
  });
}

export async function hoppscotchSendRequest(input: HoppscotchRequestSpec): Promise<HoppscotchResponseSpec> {
  const cliResult = await tryHoppCli(input);
  if (cliResult) return cliResult;
  return sendNativeRequest(input);
}

export async function hoppscotchCreateCollection(input: HoppscotchCollectionSpec): Promise<{ path: string; collection: HoppscotchCollectionSpec }> {
  await fs.mkdir(COLLECTION_ROOT, { recursive: true });
  const filePath = path.join(COLLECTION_ROOT, `${slugify(input.name)}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  return { path: filePath, collection: input };
}

export async function hoppscotchRunCollection(collection: HoppscotchCollectionSpec | string): Promise<{
  name: string;
  results: Array<HoppscotchResponseSpec & { request: HoppscotchRequestSpec }>;
}> {
  const resolved = typeof collection === "string"
    ? JSON.parse(await fs.readFile(collection, "utf8")) as HoppscotchCollectionSpec
    : collection;

  const results: Array<HoppscotchResponseSpec & { request: HoppscotchRequestSpec }> = [];
  for (const request of resolved.requests) {
    const result = await hoppscotchSendRequest(request);
    results.push({ ...result, request });
  }

  return { name: resolved.name, results };
}

export const hoppscotchSendRequestSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  headers: z.record(z.string()).optional(),
  query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  expectedStatus: z.number().int().positive().optional(),
  extractPaths: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const hoppscotchCreateCollectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  requests: z.array(hoppscotchSendRequestSchema).min(1),
});

export const hoppscotchRunCollectionSchema = z.object({
  collectionPath: z.string().optional(),
  collection: hoppscotchCreateCollectionSchema.optional(),
}).refine((value) => Boolean(value.collectionPath || value.collection), {
  message: "Provide collectionPath or collection",
});

export const hoppscotch_send_request = {
  name: "hoppscotch_send_request",
  description: "Send and validate a Hoppscotch-style HTTP request",
  inputSchema: hoppscotchSendRequestSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input: HoppscotchRequestSpec): Promise<HoppscotchResponseSpec> {
    return hoppscotchSendRequest(input);
  },
};

export const hoppscotch_create_collection = {
  name: "hoppscotch_create_collection",
  description: "Create a reusable Hoppscotch request collection",
  inputSchema: hoppscotchCreateCollectionSchema,
  isReadOnly: false,
  isConcurrencySafe: true,
  async execute(input: HoppscotchCollectionSpec): Promise<unknown> {
    return hoppscotchCreateCollection(input);
  },
};

export const hoppscotch_run_collection = {
  name: "hoppscotch_run_collection",
  description: "Run a Hoppscotch request collection sequentially",
  inputSchema: hoppscotchRunCollectionSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input: { collectionPath?: string; collection?: HoppscotchCollectionSpec }): Promise<unknown> {
    const collection = input.collectionPath ?? input.collection;
    if (!collection) {
      throw new Error("Provide collectionPath or collection");
    }
    return hoppscotchRunCollection(collection);
  },
};
