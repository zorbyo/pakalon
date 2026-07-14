/**
 * Supabase Edge Function: cli-auth-init
 * ------------------------------------
 *
 * POST /functions/v1/cli-auth-init
 *   Body: { code: "123456", installId: "uuid", expiresAt: 1700000000000 }
 *
 * Registers a 6-digit device code in the `device_codes` table. The
 * web side (`pakalon.dev/auth/verify`) reads this table when the user
 * submits the code on the web page.
 *
 * The CLI falls back to a local JSON-file poll if this function is
 * unreachable, so the auth flow stays usable offline / in self-hosted
 * mode.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface InitRequest {
	code: string;
	installId: string;
	expiresAt: number;
}

Deno.serve(async (req: Request) => {
	if (req.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}
	const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
	const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
	const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	let body: InitRequest;
	try {
		body = (await req.json()) as InitRequest;
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}
	if (!/^\d{6}$/.test(body.code)) {
		return new Response("code must be 6 digits", { status: 400 });
	}

	const { error } = await supabase
		.from("device_codes")
		.upsert(
			{
				code: body.code,
				install_id: body.installId,
				expires_at: new Date(body.expiresAt).toISOString(),
				status: "pending",
			},
			{ onConflict: "code" },
		);

	if (error) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
	return new Response(JSON.stringify({ ok: true, code: body.code }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
});
