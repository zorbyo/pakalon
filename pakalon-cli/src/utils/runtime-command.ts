/**
 * Runtime command helpers.
 *
 * In local source/dev mode, the global `pakalon` binary may not be installed,
 * so retry hints should point to the dev command instead.
 */

type BunLike = {
  main?: string;
};

function getBunMainPath(): string | undefined {
  return (globalThis as { Bun?: BunLike }).Bun?.main;
}

function isSourceDevRun(): boolean {
  const lifecycle = process.env.npm_lifecycle_event?.toLowerCase();
  if (lifecycle === "dev") return true;

  const bunMain = getBunMainPath()?.toLowerCase();
  if (bunMain?.includes("/src/index.tsx") || bunMain?.includes("\\src\\index.tsx")) {
    return true;
  }

  const argv = process.argv.join(" ").toLowerCase();
  return argv.includes("src/index.tsx");
}

export function getRetryCommand(): string | null {
  if (isSourceDevRun()) return "bun run dev";
  if (process.env.npm_lifecycle_event) return "pakalon";
  return null;
}

export function formatRetryInstruction(): string {
  const retryCommand = getRetryCommand();
  return retryCommand
    ? `Run \`${retryCommand}\` again to retry.`
    : "Run the same command again to retry.";
}
