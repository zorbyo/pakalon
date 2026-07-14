/**
 * Pakalon first-run banner.
 *
 * Renders a centered ASCII logo from ascii-black.asciimtn + tagline + auth
 * status before the 6-digit device-code flow starts. Honors the `NO_COLOR`
 * env var and the `PAKALON_BANNER` env var (set to `off`/`0`/`false` to skip).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// PAKALON logo rendered from the asciimtn canvas specification.
// Canvas: 125x27, white (#FFFFFF) characters on transparent background.
// This is the canonical logo per the ascii-black.asciimtn animation file.
const PAKALON_LOGO = [
	"        ██████████╗       ██████╗       ██╗       ██╗  ██████████╗   ██╗     ██╗    ██████████╗",
	"        ████████████╗    ████████╗      ██╗       ██╗  ████████████╗ ██╗     ██╗    ████████████╗",
	"        ██╔═══██╔══██╗  ██╔═══██╗      ██╗       ██╗  ██╔═══██╔══██╗████╗ ████╗    ██╔═══██╔══██╗",
	"        ██║   ██║  ██║  ██║   ██║      ██╗       ██╗  ██║   ██║  ██║████╗ ████║    ██║   ██║  ██║",
	"        ██║   ██║  ██║  ██║   ██║      ╚═╝       ╚═╝  ██║   ██║  ██║██╔████╔██║    ██║   ██║  ██║",
	"        ██║   ██║  ██║  ██║   ██║      ██╗       ██╗  ██║   ██║  ██║██║╚██╔╝██║    ██║   ██║  ██║",
	"        ██║   ██████╔═╝  ╚██████╔═╝      ██████████║  ██║   ██████╔═╝ ██║ ╚═╝ ██║    ██║   ██████╔═╝",
	"        ╚═╝   ╚═════╝     ╚═════╝        ╚═════════╝  ╚═╝   ╚═════╝   ╚═╝     ╚═╝    ╚═╝   ╚═════╝",
	"                                                                                                     ",
	"                        The 6-Phase AI Software Factory - v1.0.0                                       ",
	"                          https://pakalon.dev - MIT License - 2026                                     ",
];

const TAGLINE = "Sign in below or press Ctrl+C to quit.";

const COLORS = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	magenta: "\x1b[35m",
	yellow: "\x1b[33m",
	gold: "\x1b[38;5;214m",
	white: "\x1b[37m",
	gray: "\x1b[90m",
	red: "\x1b[31m",
} as const;

function useColor(): boolean {
	if (process.env.NO_COLOR !== undefined) return false;
	if (process.env.FORCE_COLOR === "0") return false;
	return process.stdout.isTTY === true;
}

function isDisabled(): boolean {
	const v = process.env.PAKALON_BANNER?.toLowerCase();
	return v === "off" || v === "0" || v === "false" || v === "no";
}

/** Detect whether the user has any auth record. */
function readAuthMarker(): "signed-in" | "not-signed-in" | "selfhost" {
	try {
		const authPath = path.join(os.homedir(), ".omp", "auth.json");
		if (fs.existsSync(authPath)) {
			const rec = JSON.parse(fs.readFileSync(authPath, "utf-8")) as { email?: string; clerkSessionToken?: string };
			if (rec.clerkSessionToken || rec.email) return "signed-in";
		}
	} catch {
		/* fall through */
	}
	if (process.env.PAKALON_MODE === "selfhosted" || process.env.PAKALON_SELF_HOSTED === "1") {
		return "selfhost";
	}
	return "not-signed-in";
}

function colorize(line: string, color: string, enabled: boolean): string {
	return enabled ? `${color}${line}${COLORS.reset}` : line;
}

/** Pad each line of the banner to the same width as the longest line. */
function padLines(lines: ReadonlyArray<string>): string[] {
	const width = Math.max(...lines.map(l => stripAnsi(l).length));
	return lines.map(line => {
		const len = stripAnsi(line).length;
		const pad = Math.max(0, Math.floor((width - len) / 2));
		return " ".repeat(pad) + line;
	});
}

function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Pad a string to a minimum visual width. */
function padRight(s: string, width: number): string {
	const len = stripAnsi(s).length;
	return s + " ".repeat(Math.max(0, width - len));
}

export interface BannerOptions {
	/** Print the banner to `process.stdout`. Defaults to true. */
	print?: boolean;
	/** Override the auth marker (mostly for tests). */
	authMarker?: "signed-in" | "not-signed-in" | "selfhost";
}

export interface BannerResult {
	lines: string[];
	text: string;
}

/**
 * Build the first-run banner as a multi-line string. The `print`
 * option is true by default; the function returns the text regardless
 * so callers can route it elsewhere (e.g. a log file).
 */
export function renderBanner(opts: BannerOptions = {}): BannerResult {
	if (isDisabled()) {
		return { lines: [], text: "" };
	}
	const color = useColor();
	const auth = opts.authMarker ?? readAuthMarker();
	const authLine =
		auth === "signed-in"
			? colorize("[signed-in] Welcome back.", COLORS.green, color)
			: auth === "selfhost"
				? colorize("[selfhost] Running locally with no auth required.", COLORS.magenta, color)
				: colorize("[not-signed-in] 6-digit code required -> open the URL below.", COLORS.yellow, color);

	const centered = padLines(PAKALON_LOGO).map(line => {
		const isLogo = !line.includes("The 6-Phase");
		return colorize(line, isLogo ? COLORS.gold : COLORS.gray, color);
	});
	const tagLine = colorize(padRight(TAGLINE, PAKALON_LOGO[0]!.length), COLORS.dim, color);
	const authStrip = colorize(padRight(authLine, PAKALON_LOGO[0]!.length), COLORS.reset, color);

	const allLines = ["", ...centered, "", authStrip, tagLine, ""];
	const text = allLines.join("\n");
	if (opts.print !== false) {
		process.stdout.write(`${text}\n`);
	}
	logger.debug("banner: rendered", { auth });
	return { lines: allLines, text };
}
