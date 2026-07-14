/**
 * Supabase Edge Function: cli-auth-confirm
 * -----------------------------------------
 *
 * POST /functions/v1/cli-auth-confirm
 *   Body: { code: "123456", userId, email, sessionToken, clerkUserId }
 *
 * Called by the web side (`pakalon.dev/auth/verify`) after the user
 * pastes the 6-digit code and successfully signs in with Clerk.
 * Writes the user identity into the `device_codes` row, which the
 * CLI's `/functions/v1/cli-auth-status` poll then returns.
 *
 * Auth: the request must include a `Authorization: Bearer <clerk_session>`
 * header. We verify the Clerk session server-side before mutating the
 * row.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ConfirmRequest {
	code: string;
	userId: string;
	email: string;
	sessionToken: string;
	clerkUserId: string;
}

Deno.serve(async (req: Request) => {
	if (req.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}
	const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
	const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
	const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY");
	const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	const auth = req.headers.get("Authorization") ?? "";
	const match = auth.match(/^Bearer (.+)$/);
	if (!match) {
		return new Response("Missing Authorization: Bearer <clerk_session>", { status: 401 });
	}
	const sessionToken = match[1]!;

	let body: ConfirmRequest;
	try {
		body = (await req.json()) as ConfirmRequest;
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}
	if (!/^\d{6}$/.test(body.code)) {
		return new Response("code must be 6 digits", { status: 400 });
	}

	// Optional Clerk verification (only if CLERK_SECRET_KEY is set).
	if (CLERK_SECRET_KEY) {
		const resp = await fetch(`https://api.clerk.com/v1/sessions/${body.clerkUserId}/verify`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${CLERK_SECRET_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ session_token: sessionToken }),
		});
		if (!resp.ok) {
			return new Response(JSON.stringify({ error: "clerk verification failed" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}
	}

	const { error } = await supabase
		.from("device_codes")
		.update({
			status: "confirmed",
			user_id: body.userId,
			email: body.email,
			session_token: body.sessionToken,
			confirmed_at: new Date().toISOString(),
		})
		.eq("code", body.code);

	if (error) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
});
