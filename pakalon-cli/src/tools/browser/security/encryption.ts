import { pbkdf2, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { promisify } from "util";

const pbkdf2Async = promisify(pbkdf2);
const PBKDF2_ITERATIONS = 310000;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

type EncryptedPayload = {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
};

function validatePassword(key: string): string {
  const password = key.trim();
  if (!password) {
    throw new Error("Encryption key is required.");
  }
  return password.normalize("NFKC");
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512")) as Buffer;
}

function parseEncryptedPayload(data: string): EncryptedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error("Encrypted state is not valid JSON.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).version !== 1 ||
    typeof (parsed as Record<string, unknown>).salt !== "string" ||
    typeof (parsed as Record<string, unknown>).iv !== "string" ||
    typeof (parsed as Record<string, unknown>).tag !== "string" ||
    typeof (parsed as Record<string, unknown>).data !== "string"
  ) {
    throw new Error("Encrypted state payload is malformed.");
  }

  return parsed as EncryptedPayload;
}

/**
 * Encrypts serialized state using AES-256-GCM.
 */
export async function encryptState(data: string, key: string): Promise<string> {
  const password = validatePassword(key);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const derivedKey = await deriveKey(password, salt);

  const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypts an AES-256-GCM payload previously produced by `encryptState`.
 */
export async function decryptState(data: string, key: string): Promise<string> {
  const password = validatePassword(key);
  const payload = parseEncryptedPayload(data);
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.data, "base64");

  if (salt.length === 0 || iv.length === 0 || tag.length === 0 || ciphertext.length === 0) {
    throw new Error("Encrypted state payload is incomplete.");
  }

  const derivedKey = await deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Failed to decrypt state. The key may be invalid or the data was tampered with.");
  }
}
