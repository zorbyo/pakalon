const fs = require("fs");
const path = require("path");

const mode = process.argv[2] || "all";
const rootDir = path.resolve(__dirname, "..");
const external = ["react-devtools-core", "playwright"];

function ensureShebang(filePath, runtime, optional = false) {
  const resolvedPath = path.resolve(rootDir, filePath);
  if (!fs.existsSync(resolvedPath)) {
    if (optional) return;
    console.error(`Cannot add shebang; file does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  const shebang = `#!/usr/bin/env ${runtime}`;
  const current = fs.readFileSync(resolvedPath, "utf8");
  if (current.startsWith(shebang)) return;

  fs.writeFileSync(resolvedPath, `${shebang}\n${current.replace(/^#!.*\r?\n/, "")}`);
}

async function runBuild(options) {
  if (typeof Bun === "undefined") {
    console.error("This build script must be run with Bun.");
    process.exit(1);
  }

  const result = await Bun.build({
    ...options,
    external,
    minify: true,
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log.message || String(log));
    }
    process.exit(1);
  }
}

async function buildCli() {
  await runBuild({
    entrypoints: ["src/index.tsx"],
    target: "bun",
    outfile: "dist/cli.js",
  });
  ensureShebang("dist/cli.js", "bun");
}

async function buildLegacyCli() {
  await runBuild({
    entrypoints: ["src/cli.ts"],
    target: "node",
    outfile: "dist/legacy-cli.js",
  });
  ensureShebang("dist/legacy-cli.js", "node");
}

async function buildApp() {
  await runBuild({
    entrypoints: ["src/index.tsx"],
    target: "bun",
    outdir: "dist",
  });
  ensureShebang("dist/index.js", "bun", true);
}

(async () => {
  switch (mode) {
    case "all":
      await buildCli();
      await buildApp();
      break;
    case "cli":
      await buildCli();
      break;
    case "legacy-cli":
      await buildLegacyCli();
      break;
    case "app":
      await buildApp();
      break;
    default:
      console.error(`Unknown build target: ${mode}`);
      process.exit(2);
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
