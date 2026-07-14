/**
 * Supabase Edge Function: cli-auth-status
 * ----------------------------------------
 *
 * GET /functions/v1/cli-auth-status?code=123456&installId=uuid
 *
 * Returns the current status of a device code. The CLI polls this
 * every 1.5 s. Responses:
 *
 *   200 { status: "pending" }                                    — still waiting
 *   200 { status: "confirmed", userId, email, sessionToken }    — user signed in
 *   200 { status: "expired" }                                    — TTL passed
 *   404 { error: "not found" }                                   — never registered
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
	const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
	const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
	const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	const url = new URL(req.url);
	const code = url.searchParams.get("code");
	const installId = url.searchParams.get("installId");
	if (!code || !installId) {
		return new Response("code and installId are required", { status: 400 });
	}

	const { data, error } = await supabase
		.from("device_codes")
		.select("status, user_id, email, session_token, expires_at, install_id")
		.eq("code", code)
		.maybeSingle();

	if (error) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
	if (!data) {
		return new Response(JSON.stringify({ error: "not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}
	// Reject codes belonging to a different install (defence-in-depth
	// — the verifyUrl also embeds the installId, so this is just a
	// backstop in case someone brute-forces a 6-digit code).
	if (data.install_id !== installId) {
		return new Response(JSON.stringify({ error: "not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}
	// Auto-expire on the server side too.
	if (new Date(data.expires_at).getTime() < Date.now() && data.status === "pending") {
		await supabase.from("device_codes").update({ status: "expired" }).eq("code", code);
		return new Response(JSON.stringify({ status: "expired" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	return new Response(
		JSON.stringify({
			status: data.status,
			userId: data.user_id,
			email: data.email,
			sessionToken: data.session_token,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
});
