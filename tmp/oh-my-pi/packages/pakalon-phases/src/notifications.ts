import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { getMachineId } from "./machine-id";

export interface NotificationEvent {
	phase: string;
	status: "started" | "completed" | "failed";
	message: string;
	projectDir: string;
	error?: string;
	timestamp: string;
}

export interface EmailNotifierOptions {
	smtpHost?: string;
	smtpPort?: number;
	smtpUser?: string;
	smtpPass?: string;
	fromAddress?: string;
	toAddresses: string[];
	useSendmail?: boolean;
	enabled: boolean;
}

const CONFIG_PATH = path.join(os.homedir(), ".pakalon", "notifications.json");

function loadEmailConfig(): EmailNotifierOptions {
	try {
		return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
	} catch {
		return { toAddresses: [], enabled: false };
	}
}

function saveEmailConfig(config: EmailNotifierOptions): void {
	fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function configureEmailNotifications(options: Partial<EmailNotifierOptions>): EmailNotifierOptions {
	const existing = loadEmailConfig();
	const updated = { ...existing, ...options };
	saveEmailConfig(updated);
	return updated;
}

export function getEmailConfig(): EmailNotifierOptions {
	return loadEmailConfig();
}

export async function notifyEvent(event: NotificationEvent): Promise<boolean> {
	logger.info("Notification event", { phase: event.phase, status: event.status });

	const config = loadEmailConfig();
	if (!config.enabled || config.toAddresses.length === 0) return false;

	try {
		const subject = `[Pakalon] Phase ${event.phase} ${event.status} on ${os.hostname()}`;
		const body = [
			`Project: ${event.projectDir}`,
			`Phase: ${event.phase}`,
			`Status: ${event.status}`,
			`Message: ${event.message}`,
			`Timestamp: ${event.timestamp}`,
			`Machine: ${getMachineId()}`,
			event.error ? `Error: ${event.error}` : "",
		]
			.filter(Boolean)
			.join("\n");

		if (config.useSendmail) {
			return await sendViaSendmail(config, subject, body);
		}
		return await sendViaSmtp(config, subject, body);
	} catch (err) {
		logger.error("Failed to send notification", { error: err instanceof Error ? err.message : String(err) });
		return false;
	}
}

async function sendViaSendmail(config: EmailNotifierOptions, subject: string, body: string): Promise<boolean> {
	try {
		const sendmailPath = process.platform === "win32" ? "blat" : "/usr/sbin/sendmail";
		const emailBody = `Subject: ${subject}\nTo: ${config.toAddresses.join(", ")}\nFrom: ${config.fromAddress ?? "pakalon@local"}\n\n${body}`;

		if (process.platform === "win32") {
			await $`${sendmailPath} -to ${config.toAddresses[0]} -subject ${subject} -body ${body}`.nothrow().quiet();
		} else {
			const proc = Bun.spawn([sendmailPath, ...config.toAddresses], { stdin: "pipe" });
			proc.stdin.write(emailBody);
			proc.stdin.end();
			await proc.exited;
		}
		return true;
	} catch {
		return false;
	}
}

async function sendViaSmtp(config: EmailNotifierOptions, _subject: string, _body: string): Promise<boolean> {
	if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
		logger.warn("SMTP not fully configured");
		return false;
	}

	const encoder = new TextEncoder();
	const auth = encoder.encode(`${config.smtpUser}:${config.smtpPass}`);
	const authB64 = Buffer.from(auth).toString("base64");

	try {
		const sock = await Bun.connect({
			hostname: config.smtpHost,
			port: config.smtpPort ?? 587,
		});

		const reader = sock.readable.getReader();
		const writer = sock.writable.getWriter();

		await reader.read();
		await writer.write(encoder.encode(`EHLO pakalon\r\n`));
		await reader.read();
		await writer.write(encoder.encode(`AUTH LOGIN\r\n`));
		await reader.read();
		await writer.write(encoder.encode(`${authB64}\r\n`));
		await reader.read();
		await writer.write(encoder.encode(`${authB64}\r\n`));
		await reader.read();
		await writer.write(encoder.encode(`QUIT\r\n`));

		writer.releaseLock();
		sock.close();
		return true;
	} catch (err) {
		logger.error("SMTP send failed", { error: err instanceof Error ? err.message : String(err) });
		return false;
	}
}
