/**
 * Supabase Authentication Wrapper
 * Replaces Clerk with Supabase for OAuth (GitHub/Google) and session management.
 */
import { createClient, SupabaseClient, User, Session, AuthChangeEvent } from "@supabase/supabase-js";
import { loadCredentials, saveCredentials, clearCredentials } from "./storage.js";

let _client: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!url || !key) {
    throw new Error(
      "Supabase credentials missing. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables."
    );
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return _client;
}

export function resetSupabaseClient(): void {
  _client = null;
}

export interface SupabaseAuthResult {
  user: User | null;
  session: Session | null;
  error: Error | null;
}

export async function signInWithOAuth(provider: "github" | "google"): Promise<SupabaseAuthResult> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: process.env.SUPABASE_REDIRECT_URL ?? "http://localhost:3000/auth/callback",
    },
  });

  if (error) {
    return { user: null, session: null, error };
  }

  // signInWithOAuth returns a URL to redirect to; the actual session is created after redirect.
  // For CLI we need to handle the PKCE flow differently; this wrapper is primarily for the web/app layer.
  return { user: null, session: null, error: null };
}

export async function signOut(): Promise<{ error: Error | null }> {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (!error) {
    clearCredentials();
  }
  return { error: error ?? null };
}

export async function getCurrentUser(): Promise<User | null> {
  const client = getSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
}

export async function getSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  const {
    data: { session },
  } = await client.auth.getSession();
  return session;
}

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): { subscription: { unsubscribe: () => void } } {
  const client = getSupabaseClient();
  return client.auth.onAuthStateChange(callback);
}

export async function refreshSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  const {
    data: { session },
    error,
  } = await client.auth.refreshSession();
  if (error) {
    throw error;
  }
  return session;
}

export { getSupabaseClient };
export type { SupabaseClient, User, Session };
