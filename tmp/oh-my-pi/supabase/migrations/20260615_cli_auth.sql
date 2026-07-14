-- Migration: device_codes table for the 6-digit CLI auth flow.
--
-- Run this against your Supabase project:
--   psql "$(supabase db url)" -f migrations/20260615_cli_auth.sql
--
-- Or in the Supabase dashboard SQL editor.

create table if not exists public.device_codes (
    -- The 6-digit numeric code, exactly 6 chars.
    code text primary key check (code ~ '^[0-9]{6}$'),
    -- Stable identifier for the machine that's trying to log in.
    -- Prevents one machine from "stealing" another machine's code via
    -- a brute-force on the 6-digit space.
    install_id text not null,
    -- Expiry timestamp. Server-side checks this on every poll.
    expires_at timestamptz not null,
    -- Confirmation payload (populated by /cli-auth-confirm).
    user_id text,
    email text,
    session_token text,
    -- Lifecycle state: pending → confirmed | expired.
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired')),
    -- Timestamps.
    created_at timestamptz not null default now(),
    confirmed_at timestamptz
);

-- A user only ever confirms a code with their own Clerk session, but
-- belt-and-braces: ensure the session_token is opaque.
alter table public.device_codes alter column session_token type text using session_token::text;

-- Gc: rows that have been pending for more than 5 min can be
-- purged by a daily cron (set up via the supabase dashboard or the
-- pakalon-cli-supabase cron worker).
create index if not exists device_codes_expires_at_idx on public.device_codes (expires_at);
create index if not exists device_codes_install_id_idx on public.device_codes (install_id);
create index if not exists device_codes_status_idx on public.device_codes (status);

-- RLS: only the service role (Edge Functions) can read/write. The
-- CLI never talks to the table directly.
alter table public.device_codes enable row level security;

-- No policies — the table is accessible only to the service role
-- key used by the Edge Functions. The CLI hits the Edge Functions,
-- not the table.
