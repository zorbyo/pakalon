# `/penpot` — Open Penpot + sync the wireframe

Open Penpot in a Chromium tab and spawn `sync.js` so user edits in
Penpot flow back into the wireframe files. Used by phase 2.

## Arguments

- `$ARGUMENTS` — optional. The path to a wireframe SVG to import
  into Penpot.

## Steps

1. Start the Penpot container:
   `docker run -d --rm -p 9001:9001 -v penpot_data:/data penpotapp/penpot`
2. Wait for HTTP 200 on `http://localhost:9001/api/health`.
3. Open the Chromium tab at the Penpot URL.
4. Spawn `sync.js` in the project root (writes a heartbeat to
   `.pakalon-agents/.sync.pid`).
5. On exit, stop the container and kill `sync.js`.

## Rules

- Cooldown 30s between sync cycles to prevent token thrash.
- Container start/stop is idempotent.
