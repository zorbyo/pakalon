/**
 * Supabase Edge Function: polar-webhook
 * --------------------------------------
 *
 * POST /functions/v1/polar-webhook
 *   Headers: { webhook-signature: "..." }
 *   Body: Polar webhook payload
 *
 * Receives billing events from Polar (the payment gateway). Verifies the
 * HMAC-SHA256 signature with POLAR_WEBHOOK_SECRET, persists the invoice
 * state to the `polar_invoices` table, and updates the user's profile
 * tier when payment completes.
 *
 * Per CLI-req.md §567 and code.md §14:
 *   - $2 deposit is collected when a user upgrades to Pro.
 *   - Post-paid billing is computed by `calculateBilling` in
 *     `packages/coding-agent/src/auth/billing.ts` and persisted in the
 *     `usage_events` table. This edge function is the write-side for
 *     "invoice paid" / "deposit collected" / "subscription cancelled".
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface PolarWebhookEvent {
	type: string;
	data: {
		id: string;
		status?: string;
		amount?: number;
		currency?: string;
		user_id?: string;
		customer_id?: string;
		paid_at?: string;
		created_at?: string;
		product_id?: string;
		metadata?: Record<string, unknown>;
	};
}

Deno.serve(async (req: Request) => {
	if (req.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
	const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
	const POLAR_WEBHOOK_SECRET = Deno.env.get("POLAR_WEBHOOK_SECRET");
	if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !POLAR_WEBHOOK_SECRET) {
		return new Response("server misconfigured", { status: 500 });
	}

	const sig = req.headers.get("webhook-signature") ?? "";
	const raw = await req.text();
	if (!verifyPolarSignature(raw, sig, POLAR_WEBHOOK_SECRET)) {
		return new Response("invalid signature", { status: 401 });
	}

	let event: PolarWebhookEvent;
	try {
		event = JSON.parse(raw) as PolarWebhookEvent;
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	// Persist the raw event for audit + replay.
	await supabase.from("polar_webhook_events").insert({
		event_id: event.data.id,
		event_type: event.type,
		payload: event,
		received_at: new Date().toISOString(),
	});

	switch (event.type) {
		case "checkout.created":
		case "checkout.updated": {
			await supabase.from("polar_invoices").upsert(
				{
					invoice_id: event.data.id,
					user_id: event.data.user_id ?? null,
					customer_id: event.data.customer_id ?? null,
					amount: event.data.amount ?? 0,
					currency: event.data.currency ?? "USD",
					status: event.data.status ?? "pending",
					product_id: event.data.product_id ?? null,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "invoice_id" },
			);
			break;
		}
		case "subscription.created":
		case "subscription.updated": {
			if (event.data.user_id) {
				await supabase
					.from("profiles")
					.update({ tier: "pro", subscription_status: "active", updated_at: new Date().toISOString() })
					.eq("user_id", event.data.user_id);
			}
			break;
		}
		case "subscription.canceled":
		case "subscription.revoked": {
			if (event.data.user_id) {
				await supabase
					.from("profiles")
					.update({ tier: "free", subscription_status: "canceled", updated_at: new Date().toISOString() })
					.eq("user_id", event.data.user_id);
			}
			break;
		}
		case "invoice.paid": {
			await supabase
				.from("polar_invoices")
				.update({
					status: "paid",
					paid_at: event.data.paid_at ?? new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.eq("invoice_id", event.data.id);
			break;
		}
		case "invoice.refunded": {
			await supabase
				.from("polar_invoices")
				.update({ status: "refunded", updated_at: new Date().toISOString() })
				.eq("invoice_id", event.data.id);
			break;
		}
		default:
			// Other events are recorded in polar_webhook_events but ignored.
			break;
	}

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
});

/**
 * Verify a Polar webhook signature using HMAC-SHA256.
 * Polar's signature format is: "sha256=<hex_digest>" in the
 * `webhook-signature` header. The signed payload is the raw request body.
 */
function verifyPolarSignature(payload: string, signatureHeader: string, secret: string): boolean {
	const match = signatureHeader.match(/^sha256=([0-9a-f]+)$/i);
	if (!match) return false;
	const expected = match[1]!.toLowerCase();

	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
	const actual = Array.from(new Uint8Array(sigBuffer))
		.map(b => b.toString(16).padStart(2, "0"))
		.join("");

	// Constant-time comparison.
	if (actual.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < actual.length; i++) {
		diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}
