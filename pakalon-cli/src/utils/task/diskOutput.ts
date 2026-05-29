import { constants as fsConstants } from 'fs';
import {
  type FileHandle,
  mkdir,
  open,
  stat,
  symlink,
  unlink,
} from 'fs/promises';
import { join } from 'path';

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

const DEFAULT_MAX_READ_BYTES = 8 * 1024 * 1024; // 8MB

export const MAX_TASK_OUTPUT_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
export const MAX_TASK_OUTPUT_BYTES_DISPLAY = '5GB';

let _taskOutputDir: string | undefined;

export function getTaskOutputDir(): string {
  if (_taskOutputDir === undefined) {
    const projectDir = process.cwd();
    _taskOutputDir = join(projectDir, '.pakalon', '.tasks');
  }
  return _taskOutputDir;
}

export function _resetTaskOutputDirForTest(): void {
  _taskOutputDir = undefined;
}

async function ensureOutputDir(): Promise<void> {
  await mkdir(getTaskOutputDir(), { recursive: true });
}

export function getTaskOutputPath(taskId: string): string {
  return join(getTaskOutputDir(), `${taskId}.output`);
}

const _pendingOps = new Set<Promise<unknown>>();

function track<T>(p: Promise<T>): Promise<T> {
  _pendingOps.add(p);
  void p.finally(() => _pendingOps.delete(p)).catch(() => {});
  return p;
}

export class DiskTaskOutput {
  #path: string;
  #fileHandle: FileHandle | null = null;
  #queue: string[] = [];
  #bytesWritten = 0;
  #capped = false;
  #flushPromise: Promise<void> | null = null;
  #flushResolve: (() => void) | null = null;

  constructor(taskId: string) {
    this.#path = getTaskOutputPath(taskId);
  }

  append(content: string): void {
    if (this.#capped) {
      return;
    }
    this.#bytesWritten += content.length;
    if (this.#bytesWritten > MAX_TASK_OUTPUT_BYTES) {
      this.#capped = true;
      this.#queue.push(
        `\n[output truncated: exceeded ${MAX_TASK_OUTPUT_BYTES_DISPLAY} disk cap]\n`,
      );
    } else {
      this.#queue.push(content);
    }
    if (!this.#flushPromise) {
      this.#flushPromise = new Promise<void>(resolve => {
        this.#flushResolve = resolve;
      });
      void track(this.#drain());
    }
  }

  flush(): Promise<void> {
    return this.#flushPromise ?? Promise.resolve();
  }

  cancel(): void {
    this.#queue.length = 0;
  }

  async #drainAllChunks(): Promise<void> {
    while (true) {
      try {
        if (!this.#fileHandle) {
          await ensureOutputDir();
          this.#fileHandle = await open(
            this.#path,
            process.platform === 'win32'
              ? 'a'
              : fsConstants.O_WRONLY |
                  fsConstants.O_APPEND |
                  fsConstants.O_CREAT |
                  O_NOFOLLOW,
          );
        }
        while (true) {
          await this.#writeAllChunks();
          if (this.#queue.length === 0) {
            break;
          }
        }
      } finally {
        if (this.#fileHandle) {
          const fileHandle = this.#fileHandle;
          this.#fileHandle = null;
          await fileHandle.close();
        }
      }
      if (this.#queue.length) {
        continue;
      }
      break;
    }
  }

  #writeAllChunks(): Promise<void> {
    return this.#fileHandle!.appendFile(this.#queueToBuffers());
  }

  #queueToBuffers(): Buffer {
    const queue = this.#queue.splice(0, this.#queue.length);
    let totalLength = 0;
    for (const str of queue) {
      totalLength += Buffer.byteLength(str, 'utf8');
    }
    const buffer = Buffer.allocUnsafe(totalLength);
    let offset = 0;
    for (const str of queue) {
      offset += buffer.write(str, offset, 'utf8');
    }
    return buffer;
  }

  async #drain(): Promise<void> {
    try {
      await this.#drainAllChunks();
    } catch (e) {
      if (this.#queue.length > 0) {
        try {
          await this.#drainAllChunks();
        } catch (e2) {
          console.error('[diskOutput] Failed to write task output:', e2);
        }
      }
    } finally {
      const resolve = this.#flushResolve!;
      this.#flushPromise = null;
      this.#flushResolve = null;
      resolve();
    }
  }
}

const outputs = new Map<string, DiskTaskOutput>();

export async function _clearOutputsForTest(): Promise<void> {
  for (const output of outputs.values()) {
    output.cancel();
  }
  while (_pendingOps.size > 0) {
    await Promise.allSettled([..._pendingOps]);
  }
  outputs.clear();
}

function getOrCreateOutput(taskId: string): DiskTaskOutput {
  let output = outputs.get(taskId);
  if (!output) {
    output = new DiskTaskOutput(taskId);
    outputs.set(taskId, output);
  }
  return output;
}

export function appendTaskOutput(taskId: string, content: string): void {
  getOrCreateOutput(taskId).append(content);
}

export async function flushTaskOutput(taskId: string): Promise<void> {
  const output = outputs.get(taskId);
  if (output) {
    await output.flush();
  }
}

export function evictTaskOutput(taskId: string): Promise<void> {
  return track(
    (async () => {
      const output = outputs.get(taskId);
      if (output) {
        await output.flush();
        outputs.delete(taskId);
      }
    })(),
  );
}

export async function getTaskOutputDelta(
  taskId: string,
  fromOffset: number,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<{ content: string; newOffset: number }> {
  try {
    const result = await readFileRange(
      getTaskOutputPath(taskId),
      fromOffset,
      maxBytes,
    );
    if (!result) {
      return { content: '', newOffset: fromOffset };
    }
    return {
      content: result.content,
      newOffset: fromOffset + result.bytesRead,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: '', newOffset: fromOffset };
    }
    console.error('[diskOutput] Error reading task output delta:', e);
    return { content: '', newOffset: fromOffset };
  }
}

export async function getTaskOutput(
  taskId: string,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<string> {
  try {
    const { content, bytesTotal, bytesRead } = await tailFile(
      getTaskOutputPath(taskId),
      maxBytes,
    );
    if (bytesTotal > bytesRead) {
      return `[${Math.round((bytesTotal - bytesRead) / 1024)}KB of earlier output omitted]\n${content}`;
    }
    return content;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    console.error('[diskOutput] Error reading task output:', e);
    return '';
  }
}

export async function getTaskOutputSize(taskId: string): Promise<number> {
  try {
    return (await stat(getTaskOutputPath(taskId))).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    console.error('[diskOutput] Error getting task output size:', e);
    return 0;
  }
}

export async function cleanupTaskOutput(taskId: string): Promise<void> {
  const output = outputs.get(taskId);
  if (output) {
    output.cancel();
    outputs.delete(taskId);
  }
  try {
    await unlink(getTaskOutputPath(taskId));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[diskOutput] Error cleaning up task output:', e);
    }
  }
}

export function initTaskOutput(taskId: string): Promise<string> {
  return track(
    (async () => {
      await ensureOutputDir();
      const outputPath = getTaskOutputPath(taskId);
      const fh = await open(
        outputPath,
        process.platform === 'win32'
          ? 'wx'
          : fsConstants.O_WRONLY |
              fsConstants.O_CREAT |
              fsConstants.O_EXCL |
              O_NOFOLLOW,
      );
      await fh.close();
      return outputPath;
    })(),
  );
}

async function readFileRange(
  filePath: string,
  offset: number,
  maxBytes: number,
): Promise<{ content: string; bytesRead: number } | null> {
  const { open: fsOpen } = await import('fs/promises');
  try {
    const fh = await fsOpen(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(maxBytes);
      const { bytesRead } = await fh.read(buffer, 0, maxBytes, offset);
      if (bytesRead === 0) {
        return null;
      }
      return {
        content: buffer.toString('utf8', 0, bytesRead),
        bytesRead,
      };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

export async function tailFile(
  filePath: string,
  maxBytes: number,
): Promise<{ content: string; bytesTotal: number; bytesRead: number }> {
  const { open: fsOpen, stat: fsStat } = await import('fs/promises');
  try {
    const stats = await fsStat(filePath);
    const bytesTotal = stats.size;
    if (bytesTotal === 0) {
      return { content: '', bytesTotal: 0, bytesRead: 0 };
    }
    const startOffset = Math.max(0, bytesTotal - maxBytes);
    const bytesToRead = bytesTotal - startOffset;
    const fh = await fsOpen(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await fh.read(buffer, 0, bytesToRead, startOffset);
      return {
        content: buffer.toString('utf8', 0, bytesRead),
        bytesTotal,
        bytesRead,
      };
    } finally {
      await fh.close();
    }
  } catch {
    return { content: '', bytesTotal: 0, bytesRead: 0 };
  }
}

export function initTaskOutputAsSymlink(
  taskId: string,
  targetPath: string,
): Promise<string> {
  return track(
    (async () => {
      try {
        await ensureOutputDir();
        const outputPath = getTaskOutputPath(taskId);

        try {
          await symlink(targetPath, outputPath);
        } catch {
          await unlink(outputPath);
          await symlink(targetPath, outputPath);
        }

        return outputPath;
      } catch (error) {
        console.error('[diskOutput] Failed to create symlink:', error);
        return initTaskOutput(taskId);
      }
    })(),
  );
}