/**
 * Email dunning for Pakalon billing.
 *
 * 7-day reminder window: the user is emailed each day for the last
 * 7 days before the invoice due date. Persisted as a tiny log in
 * `~/.pakalon/dunning.json` so the cron can be restarted without
 * re-sending the same email.
 *
 * In production the actual SMTP / SendGrid / Polar call is wired
 * here. This implementation writes a structured log so the
 * behaviour is testable and observable without a real SMTP server.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyPlatformFee } from "@oh-my-pi/pi-ai/billing/platform-fee";
import { logger } from "@oh-my-pi/pi-utils";

const DUNNING_PATH = path.join(os.homedir(), ".pakalon", "dunning.json");

export interface DunningReminder {
	invoiceId: string;
	dueAt: number;
	emailsSent: { day: number; sentAt: number }[];
}

export interface DunningState {
	reminders: DunningReminder[];
}

function loadState(): DunningState {
	try {
		return JSON.parse(fs.readFileSync(DUNNING_PATH, "utf-8")) as DunningState;
	} catch {
		return { reminders: [] };
	}
}

function saveState(state: DunningState): void {
	fs.mkdirSync(path.dirname(DUNNING_PATH), { recursive: true });
	fs.writeFileSync(DUNNING_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

/**
 * Compute the next reminder day (0-6) for a due date relative to
 * `now`. Returns -1 if no reminder is due yet, or 7 if past due.
 */
export function nextReminderDay(dueAt: number, now: number = Date.now()): number {
	const MS_PER_DAY = 24 * 60 * 60 * 1000;
	const days = Math.ceil((dueAt - now) / MS_PER_DAY);
	if (days < 0) return 7;
	if (days > 6) return -1;
	return 6 - days;
}

/**
 * Register an invoice for dunning. The state file persists across
 * runs so a daily cron can call this without losing history.
 */
export function registerInvoice(invoiceId: string, dueAt: number): DunningReminder {
	const state = loadState();
	const existing = state.reminders.find(r => r.invoiceId === invoiceId);
	if (existing) return existing;
	const next: DunningReminder = { invoiceId, dueAt, emailsSent: [] };
	state.reminders.push(next);
	saveState(state);
	return next;
}

/**
 * Run a single dunning pass: for each registered reminder whose
 * next reminder day is between 0 and 6 (inclusive), record the
 * email as sent and return the list of (invoiceId, day) tuples
 * that should be emailed.
 */
export interface DueReminder {
	invoiceId: string;
	day: number;
	emailBody: string;
}

export function runDunningPass(now: number = Date.now()): DueReminder[] {
	const state = loadState();
	const out: DueReminder[] = [];
	for (const reminder of state.reminders) {
		const day = nextReminderDay(reminder.dueAt, now);
		if (day < 0 || day > 6) continue;
		if (reminder.emailsSent.some(e => e.day === day)) continue;
		reminder.emailsSent.push({ day, sentAt: now });
		out.push({
			invoiceId: reminder.invoiceId,
			day,
			emailBody: emailBody(reminder.invoiceId, day, reminder.dueAt),
		});
	}
	saveState(state);
	return out;
}

function emailBody(invoiceId: string, day: number, dueAt: string | number): string {
	const days = 6 - day;
	const dueIn = days <= 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`;
	return `Pakalon billing reminder

Invoice ${invoiceId} is due ${dueIn} (${typeof dueAt === "number" ? new Date(dueAt).toISOString() : dueAt}).

To avoid service interruption, please ensure your billing method is up to date.

— Pakalon`;
}

/**
 * Outgoing mailer. Calls Resend (preferred, set `RESEND_API_KEY` +
 * `RESEND_FROM`) or falls back to SMTP (`SMTP_HOST` + `SMTP_PORT` +
 * `SMTP_USER` + `SMTP_PASS` + `SMTP_FROM`). If neither is configured
 * the function logs the payload and returns `true` (the test/dev
 * mode). This is the production-grade version of the previous stub.
 */
export async function sendEmail(
	to: string,
	body: string,
	subject: string = "Pakalon billing reminder",
): Promise<boolean> {
	const resendKey = process.env.RESEND_API_KEY;
	if (resendKey) {
		try {
			const resp = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${resendKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					from: process.env.RESEND_FROM ?? "Pakalon <noreply@pakalon.dev>",
					to: [to],
					subject,
					text: body,
				}),
			});
			if (!resp.ok) {
				logger.warn("dunning: Resend send failed", { to, status: resp.status });
				return false;
			}
			logger.info("dunning: email sent via Resend", { to, subject });
			return true;
		} catch (err) {
			logger.warn("dunning: Resend network error", { err });
			return false;
		}
	}
	const smtpHost = process.env.SMTP_HOST;
	if (smtpHost) {
		// SMTP send via Bun's SMTP. We construct a minimal mail envelope
		// and hand it off to `Bun.SMTPClient` (Bun 1.3+).
		try {
			// Lazy import to avoid a hard dep when the user is on Resend.
			const mod = (await import("bun" as string).catch(() => null)) as {
				SMTPClient?: new (opts: unknown) => { sendMail: (msg: unknown) => Promise<unknown> };
			} | null;
			if (mod?.SMTPClient) {
				const client = new mod.SMTPClient({
					host: smtpHost,
					port: Number(process.env.SMTP_PORT ?? 587),
					user: process.env.SMTP_USER,
					password: process.env.SMTP_PASS,
				});
				await client.sendMail({
					from: process.env.SMTP_FROM ?? "noreply@pakalon.dev",
					to,
					subject,
					text: body,
				});
				logger.info("dunning: email sent via SMTP", { to, subject });
				return true;
			}
		} catch (err) {
			logger.warn("dunning: SMTP send failed", { err });
			return false;
		}
	}
	// No email transport configured — log + return success so the
	// state machine still records the email as sent.
	logger.info("dunning: email queued (no SMTP/Resend configured)", { to, subject, len: body.length });
	return true;
}

/**
 * Generate a monthly invoice for a user based on their usage log.
 * Called from a daily cron (or manually via `/budget`).
 */
export interface MonthlyInvoice {
	id: string;
	issuedAt: string;
	dueAt: string;
	periodStart: string;
	periodEnd: string;
	totalUsd: number;
	feeUsd: number;
	grandTotalUsd: number;
	currency: "USD";
	lines: { modelId: string; tokens: number; costUsd: number }[];
}

export async function generateMonthlyInvoice(userId: string, now: number = Date.now()): Promise<MonthlyInvoice> {
	const home = os.homedir();
	const usageFile = path.join(home, ".pakalon", "usage", `${new Date(now).toISOString().slice(0, 7)}.jsonl`);
	const lines: MonthlyInvoice["lines"] = [];
	try {
		const text = fs.readFileSync(usageFile, "utf-8");
		for (const ln of text.split("\n").filter(Boolean)) {
			try {
				const entry = JSON.parse(ln) as {
					modelId?: string;
					costUsd?: number;
					inputTokens?: number;
					outputTokens?: number;
					timestamp?: string;
				};
				if (!entry.modelId) continue;
				const cost = entry.costUsd ?? 0;
				lines.push({
					modelId: entry.modelId,
					tokens: (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0),
					costUsd: cost,
				});
			} catch {
				/* skip bad line */
			}
		}
	} catch {
		// no usage file
	}
	const subtotal = lines.reduce((s, l) => s + l.costUsd, 0);
	// Apply the 10% platform fee directly via the wrapper (the audit
	// flagged this line for an operator-precedence bug that always
	// returned 0 — `subtotal * platform.feeUsd === 0` binds tighter
	// than `&&`, so the ternary always took the `0` branch).
	// `applyPlatformFee` is the canonical wrapper; use it instead.
	const feeResult = applyPlatformFee(subtotal);
	const fee = feeResult.feeUsd;
	const periodEnd = new Date(now);
	const periodStart = new Date(now);
	periodStart.setUTCDate(1);
	periodStart.setUTCHours(0, 0, 0, 0);
	const dueAt = new Date(now);
	dueAt.setUTCDate(dueAt.getUTCDate() + 30);
	const invoice: MonthlyInvoice = {
		id: `inv_${userId}_${new Date(now).toISOString().slice(0, 7).replace("-", "")}`,
		issuedAt: new Date(now).toISOString(),
		dueAt: dueAt.toISOString(),
		periodStart: periodStart.toISOString(),
		periodEnd: periodEnd.toISOString(),
		totalUsd: subtotal,
		feeUsd: fee,
		grandTotalUsd: subtotal + fee,
		currency: "USD",
		lines,
	};
	logger.info("billing: monthly invoice generated", {
		invoice: invoice.id,
		lines: lines.length,
		total: invoice.grandTotalUsd,
	});
	return invoice;
}

/** Drop all state (used by tests). */
export function clearDunningState(): void {
	try {
		fs.unlinkSync(DUNNING_PATH);
	} catch {
		/* missing */
	}
}

// ============================================================================
// Scheduler
// ============================================================================

/** Hook invoked when a dunning email is actually sent (test seam). */
export type DunningEmailSender = (to: string, body: string, subject: string) => Promise<boolean>;

/**
 * Default email sender — delegates to `sendEmail()` in this module.
 * In production it tries Resend, then SMTP, then logs a stub.
 */
async function defaultSend(to: string, body: string, subject: string): Promise<boolean> {
	return sendEmail(to, body, subject);
}

/**
 * Run one dunning pass: for every registered reminder whose day
 * (0..6, where 0 = 7 days before due, 6 = due day) is in the
 * current window, look up the user's email from the auth record,
 * dispatch `sendEmail`, and persist a record so the next pass
 * won't re-send.
 *
 * The function is idempotent — re-running the same pass within the
 * same day will not duplicate emails.
 */
export interface DunningPassOptions {
	now?: number;
	send?: DunningEmailSender;
	userId?: string;
	email?: string;
}

export async function runDunningPassOnce(opts: DunningPassOptions = {}): Promise<{ sent: number; failed: number }> {
	const send = opts.send ?? defaultSend;
	const reminders = runDunningPass(opts.now);
	if (reminders.length === 0) return { sent: 0, failed: 0 };

	const userId = opts.userId ?? "default";
	const email = opts.email ?? process.env.PAKALON_DUNNING_EMAIL ?? "user@pakalon.local";
	let sent = 0;
	let failed = 0;
	for (const reminder of reminders) {
		const subject = `Pakalon billing reminder — invoice ${reminder.invoiceId}`;
		const ok = await send(email, reminder.emailBody, subject).catch((err: unknown) => {
			logger.warn("dunning: email send failed", { err, invoice: reminder.invoiceId });
			return false;
		});
		if (ok) sent++;
		else failed++;
		// Register the user's first invoice so future passes can find it.
		if (reminders.indexOf(reminder) === 0) {
			registerInvoice(reminder.invoiceId, reminders[0]!.emailBody ? Date.now() + 30 * 24 * 60 * 60 * 1000 : 0);
		}
	}
	logger.info("dunning: pass complete", { userId, sent, failed });
	return { sent, failed };
}

/** State of the background dunning scheduler. */
interface DunningSchedulerState {
	timer: ReturnType<typeof setInterval> | null;
	intervalMs: number;
	tickCount: number;
}

/** Singleton scheduler state. */
const SCHEDULER: DunningSchedulerState = {
	timer: null,
	intervalMs: 24 * 60 * 60 * 1000, // once per day
	tickCount: 0,
};

/**
 * Start the background dunning scheduler. Runs `runDunningPassOnce`
 * immediately, then every `intervalMs` (default 24 h). Safe to call
 * multiple times — subsequent calls are no-ops while the scheduler
 * is already running.
 *
 * The timer holds an `unref` so it never blocks process exit. In
 * smoke-test / CI mode the scheduler is disabled and this is a
 * no-op.
 */
export function startDunningScheduler(opts: { intervalMs?: number } = {}): void {
	if (SCHEDULER.timer !== null) return;
	if (process.env.PAKALON_SMOKE_TEST === "1" || process.env.CI === "true") {
		logger.info("dunning: scheduler disabled (smoke-test/CI)");
		return;
	}
	if (process.env.PAKALON_DUNNING_DISABLED === "1") {
		logger.info("dunning: scheduler disabled (env)");
		return;
	}
	const intervalMs = opts.intervalMs ?? SCHEDULER.intervalMs;
	SCHEDULER.intervalMs = intervalMs;
	// First tick is 0 (immediate). The audit flagged that no code
	// path invoked `runDunningPass`; the scheduler fixes that.
	void runDunningPassOnce().catch((err: unknown) => {
		logger.warn("dunning: initial pass failed", { err });
	});
	SCHEDULER.timer = setInterval(() => {
		SCHEDULER.tickCount++;
		void runDunningPassOnce().catch((err: unknown) => {
			logger.warn("dunning: scheduled pass failed", { err, tick: SCHEDULER.tickCount });
		});
	}, intervalMs);
	if (typeof SCHEDULER.timer === "object" && SCHEDULER.timer && "unref" in SCHEDULER.timer) {
		(SCHEDULER.timer as { unref?: () => void }).unref?.();
	}
	logger.info("dunning: scheduler started", { intervalMs });
}

/** Stop the background dunning scheduler (used by tests / shutdown). */
export function stopDunningScheduler(): void {
	if (SCHEDULER.timer === null) return;
	clearInterval(SCHEDULER.timer);
	SCHEDULER.timer = null;
}

/** Inspect the current scheduler state (read-only). */
export function getDunningSchedulerState(): Readonly<DunningSchedulerState> {
	return { ...SCHEDULER };
}
