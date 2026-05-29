const fs = require("fs");
const path = require("path");

const [, , filePath, runtime = "bun", optionalFlag] = process.argv;

if (!filePath) {
  console.error("Usage: node scripts/ensure-shebang.js <file> [runtime] [--optional]");
  process.exit(2);
}

const resolvedPath = path.resolve(filePath);
if (!fs.existsSync(resolvedPath)) {
  if (optionalFlag === "--optional") {
    process.exit(0);
  }
  console.error(`Cannot add shebang; file does not exist: ${resolvedPath}`);
  process.exit(1);
}

const shebang = `#!/usr/bin/env ${runtime}`;
const current = fs.readFileSync(resolvedPath, "utf8");

if (current.startsWith(shebang)) {
  process.exit(0);
}

const withoutExistingShebang = current.replace(/^#!.*\r?\n/, "");
fs.writeFileSync(resolvedPath, `${shebang}\n${withoutExistingShebang}`);
