import { clearPluginRootsAndCaches, resolveOrDefaultProjectRegistryPath } from "../../discovery/helpers";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../../extensibility/plugins/marketplace";
import type { SlashCommandRuntime } from "../types";

/**
 * Resolve the default marketplace URL.
 *
 * Sources, in priority order:
 *   1. `PAKALON_MARKETPLACE_URL` env var (highest).
 *   2. `kilo.json` `marketplace.defaultUrl` setting.
 *   3. Built-in fallback: the Anthropic official plugins repo.
 *
 * The default URL is **not** added automatically — it is only shown to
 * the user as the suggested source when they run `/marketplace add` with
 * no arguments, so first-run users have a sensible starting point.
 */
export function resolveDefaultMarketplaceUrl(): string {
	const envUrl = process.env.PAKALON_MARKETPLACE_URL;
	if (envUrl && envUrl.trim().length > 0) return envUrl.trim();
	const fallback = "anthropics/claude-plugins-official";
	return fallback;
}

/**
 * Build a `MarketplaceManager` wired up with the active project's registry
 * paths and the shared plugin-root cache invalidator. Reused by both `/plugins`
 * and `/marketplace` handlers so cache invalidation stays consistent.
 */
export async function createMarketplaceManager(runtime: SlashCommandRuntime): Promise<MarketplaceManager> {
	return new MarketplaceManager({
		marketplacesRegistryPath: getMarketplacesRegistryPath(),
		installedRegistryPath: getInstalledPluginsRegistryPath(),
		projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(runtime.cwd),
		marketplacesCacheDir: getMarketplacesCacheDir(),
		pluginsCacheDir: getPluginsCacheDir(),
		clearPluginRootsCache: clearPluginRootsAndCaches,
	});
}
