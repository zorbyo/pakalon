import * as fs from "fs";
import * as path from "path";

export interface PeerInfo {
  id: string;
  type: "local" | "remote";
  status: "connected" | "idle" | "disconnected";
  name?: string;
  lastSeen: string;
  socketPath?: string;
  sessionId?: string;
  pid?: number;
  cwd?: string;
}

export interface PeerHeartbeatHandle {
  id: string;
  stop: () => void;
}

const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 90_000;

function getPeerDir(projectDir: string): string {
  return path.join(path.resolve(projectDir), ".pakalon", "peers");
}

function getPeerFile(projectDir: string, peerId: string): string {
  return path.join(getPeerDir(projectDir), `${peerId}.json`);
}

function writePeer(projectDir: string, peer: PeerInfo): void {
  const peerDir = getPeerDir(projectDir);
  fs.mkdirSync(peerDir, { recursive: true });
  fs.writeFileSync(getPeerFile(projectDir, peer.id), JSON.stringify(peer, null, 2), "utf-8");
}

function readPeerFile(filePath: string): PeerInfo | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PeerInfo;
    if (!parsed.id || !parsed.lastSeen) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function startPeerHeartbeat(options: {
  projectDir: string;
  sessionId?: string;
  name?: string;
  type?: "local" | "remote";
  socketPath?: string;
}): PeerHeartbeatHandle {
  const projectDir = path.resolve(options.projectDir);
  const peerId = [
    options.type ?? "local",
    process.pid,
    (options.sessionId ?? "sessionless").replace(/[^A-Za-z0-9_.-]/g, "_"),
  ].join("-");

  const buildPeer = (status: PeerInfo["status"]): PeerInfo => ({
    id: peerId,
    type: options.type ?? "local",
    status,
    name: options.name ?? `Pakalon ${process.pid}`,
    lastSeen: new Date().toISOString(),
    socketPath: options.socketPath,
    sessionId: options.sessionId,
    pid: process.pid,
    cwd: projectDir,
  });

  writePeer(projectDir, buildPeer("connected"));
  const timer = setInterval(() => {
    writePeer(projectDir, buildPeer("connected"));
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return {
    id: peerId,
    stop: () => {
      clearInterval(timer);
      try {
        writePeer(projectDir, buildPeer("disconnected"));
      } catch {
        // Best-effort shutdown marker.
      }
    },
  };
}

export function discoverPeers(
  projectDir = process.cwd(),
  options: { includeInactive?: boolean; filter?: "local" | "remote" | "all"; staleAfterMs?: number } = {},
): PeerInfo[] {
  const includeInactive = options.includeInactive ?? false;
  const filter = options.filter ?? "all";
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const peerDir = getPeerDir(projectDir);

  if (!fs.existsSync(peerDir)) return [];

  const now = Date.now();
  const peers: PeerInfo[] = [];

  for (const entry of fs.readdirSync(peerDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const peer = readPeerFile(path.join(peerDir, entry.name));
    if (!peer) continue;

    const ageMs = now - new Date(peer.lastSeen).getTime();
    const status = ageMs > staleAfterMs && peer.status !== "disconnected"
      ? "idle"
      : peer.status;
    const normalized = { ...peer, status };

    if (filter !== "all" && normalized.type !== filter) continue;
    if (!includeInactive && normalized.status === "disconnected") continue;
    peers.push(normalized);
  }

  return peers.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}
