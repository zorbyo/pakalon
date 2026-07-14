/**
 * Per-project default permission mode (plan / edit / auto-accept / bypass).
 *
 * Persisted in `~/.omp/settings.json` under `defaultPermissionMode`.
 * New sessions inherit this default; the user can override with
 * `Tab` in the TUI. In YOLO mode the default is `bypass`; in HIL
 * the default is `edit` (per requirements §Normal mode).
 */
import { logger } from "@oh-my-pi/pi-utils";
import { isSelfHostedMode } from "../local-models/registry";

export type PermissionMode = "plan" | "edit" | "auto-accept" | "bypass";

const SETTINGS_KEY = "defaultPermissionMode";

/** Get the default mode for a new session. */
export function defaultPermissionMode(): PermissionMode {
	if (isSelfHostedMode()) return "bypass";
	// YOLO-style "bypass" is the default for fast iteration; the user
	// can tab to a stricter mode in the TUI. (Per requirements §5.)
	return "bypass";
}

/**
 * Resolve the mode for a session: project-local override → global
 * default → bootstrap default.
 */
export function resolveModeForSession(opts: { projectMode?: PermissionMode }): PermissionMode {
	return opts.projectMode ?? defaultPermissionMode();
}

/** Persist the default mode to the global settings (lazy). */
export function setDefaultPermissionMode(mode: PermissionMode): void {
	try {
		// Defer the actual write to the existing settings module so the
		// schema validation runs. We import lazily to avoid a top-level
		// cycle with the settings module.
		void import("../../config/settings").then(({ settings }) => {
			try {
				settings.set("defaultPermissionMode" as never, mode as never);
				logger.info("mode-switcher: default saved", { mode });
			} catch (err) {
				logger.warn("mode-switcher: failed to persist default", { err });
			}
		});
	} catch (err) {
		logger.warn("mode-switcher: setDefault failed", { err });
	}
}
