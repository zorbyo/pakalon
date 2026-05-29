/**
 * Cloud storage client — replaces Python bridge /tools/storage/*.
 * Supports AWS S3/MinIO and Cloudinary.
 */
import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorageUploadOptions {
  localPath: string;
  remoteKey?: string;
  provider?: "s3" | "cloudinary";
  isPublic?: boolean;
}

export interface StorageDownloadOptions {
  remoteKey: string;
  localPath?: string;
  provider?: "s3" | "cloudinary";
}

export interface StorageListOptions {
  prefix?: string;
  provider?: "s3" | "cloudinary";
}

export interface StorageResult {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
}

export interface StorageFile {
  key: string;
  size: number;
  lastModified: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// S3/MinIO
// ---------------------------------------------------------------------------

async function getS3Client() {
  try {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const endpoint = process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT;
    const region = process.env.S3_REGION ?? "us-east-1";

    return new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? process.env.MINIO_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? process.env.MINIO_SECRET_KEY ?? "",
      },
      forcePathStyle: !!endpoint,
    });
  } catch {
    return null;
  }
}

async function s3Upload(options: StorageUploadOptions): Promise<StorageResult> {
  const s3 = await getS3Client();
  if (!s3) return { success: false, error: "AWS SDK not installed or configured" };

  const bucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET ?? "pakalon";
  const key = options.remoteKey ?? path.basename(options.localPath);

  try {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const body = fs.readFileSync(options.localPath);

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ACL: options.isPublic ? "public-read" : "private",
    }));

    const endpoint = process.env.S3_ENDPOINT ?? "";
    const url = endpoint
      ? `${endpoint}/${bucket}/${key}`
      : `https://${bucket}.s3.amazonaws.com/${key}`;

    return { success: true, key, url };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function s3Download(options: StorageDownloadOptions): Promise<StorageResult> {
  const s3 = await getS3Client();
  if (!s3) return { success: false, error: "AWS SDK not installed or configured" };

  const bucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET ?? "pakalon";

  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: options.remoteKey,
    }));

    if (!result.Body) return { success: false, error: "Empty response body" };

    const localPath = options.localPath ?? path.basename(options.remoteKey);
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const chunks: Buffer[] = [];
    const stream = result.Body as NodeJS.ReadableStream;
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    fs.writeFileSync(localPath, Buffer.concat(chunks));

    return { success: true, key: options.remoteKey, url: localPath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function s3List(options: StorageListOptions): Promise<StorageFile[]> {
  const s3 = await getS3Client();
  if (!s3) return [];

  const bucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET ?? "pakalon";

  try {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: options.prefix ?? "",
      MaxKeys: 100,
    }));

    return (result.Contents ?? []).map((obj) => ({
      key: obj.Key ?? "",
      size: obj.Size ?? 0,
      lastModified: obj.LastModified?.toISOString() ?? "",
    }));
  } catch {
    return [];
  }
}

async function s3Delete(remoteKey: string): Promise<boolean> {
  const s3 = await getS3Client();
  if (!s3) return false;

  const bucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET ?? "pakalon";

  try {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await s3.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: remoteKey,
    }));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cloudinary
// ---------------------------------------------------------------------------

async function cloudinaryUpload(options: StorageUploadOptions): Promise<StorageResult> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
  const apiKey = process.env.CLOUDINARY_API_KEY ?? "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET ?? "";

  if (!cloudName || !apiKey || !apiSecret) {
    return { success: false, error: "Cloudinary credentials not configured" };
  }

  try {
    const cloudinary = await import("cloudinary" as any);
    const v2 = cloudinary.default?.v2 ?? cloudinary.v2;
    v2.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

    const result = await cloudinary.uploader.upload(options.localPath, {
      public_id: options.remoteKey?.replace(/\.[^.]+$/, ""),
      resource_type: "auto",
    });

    return { success: true, url: result.secure_url, key: result.public_id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function uploadFile(options: StorageUploadOptions): Promise<StorageResult> {
  const provider = options.provider ?? (process.env.CLOUDINARY_CLOUD_NAME ? "cloudinary" : "s3");

  if (provider === "cloudinary") {
    return cloudinaryUpload(options);
  }
  return s3Upload(options);
}

export async function downloadFile(options: StorageDownloadOptions): Promise<StorageResult> {
  return s3Download(options);
}

export async function listFiles(options: StorageListOptions = {}): Promise<StorageFile[]> {
  const provider = options.provider ?? "s3";
  if (provider === "s3") {
    return s3List(options);
  }
  return [];
}

export async function deleteFile(remoteKey: string, provider?: string): Promise<boolean> {
  if (provider === "s3" || !provider) {
    return s3Delete(remoteKey);
  }
  return false;
}
