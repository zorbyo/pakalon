import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { discoverPeers, startPeerHeartbeat } from "@/peers/discovery.js";

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-peers-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("peer discovery", () => {
  it("discovers active project peer heartbeats", () => {
    const projectDir = makeProjectDir();
    const heartbeat = startPeerHeartbeat({
      projectDir,
      sessionId: "session-1",
      name: "test peer",
      type: "local",
    });

    try {
      const peers = discoverPeers(projectDir);
      expect(peers).toHaveLength(1);
      expect(peers[0]).toMatchObject({
        id: heartbeat.id,
        name: "test peer",
        status: "connected",
        sessionId: "session-1",
      });
    } finally {
      heartbeat.stop();
    }
  });
});
