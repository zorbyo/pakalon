-- Migration: Polar billing tables.
-- Run after 20260615_cli_auth.sql.
--
-- Adds:
--   - polar_invoices      one row per Polar invoice / checkout
--   - polar_webhook_events audit log of every webhook we received
--   - profiles            per-user tier, subscription, telegram bot token
--   - usage_events        per-call token usage, for post-paid billing math

create table if not exists public.polar_invoices (
    invoice_id text primary key,
    user_id text,
    customer_id text,
    amount integer not null default 0,
    currency text not null default 'USD',
    status text not null default 'pending'
        check (status in ('pending', 'paid', 'refunded', 'failed', 'expired')),
    product_id text,
    paid_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists polar_invoices_user_id_idx on public.polar_invoices (user_id);
create index if not exists polar_invoices_status_idx on public.polar_invoices (status);

create table if not exists public.polar_webhook_events (
    id bigserial primary key,
    event_id text,
    event_type text not null,
    payload jsonb not null,
    received_at timestamptz not null default now()
);

create index if not exists polar_webhook_events_event_type_idx on public.polar_webhook_events (event_type);
create index if not exists polar_webhook_events_received_at_idx on public.polar_webhook_events (received_at);

create table if not exists public.profiles (
    user_id text primary key,
    email text,
    first_name text,
    last_name text,
    image_url text,
    tier text not null default 'free' check (tier in ('free', 'pro')),
    subscription_status text not null default 'none'
        check (subscription_status in ('none', 'active', 'past_due', 'canceled')),
    -- Telegram bot token, stored encrypted with pgsodium.
    bot_token_encrypted bytea,
    -- $2 deposit / credit-card-on-file (Pro only).
    has_deposit boolean not null default false,
    updated_at timestamptz not null default now()
);

create index if not exists profiles_tier_idx on public.profiles (tier);

create table if not exists public.usage_events (
    id bigserial primary key,
    user_id text not null,
    model_id text not null,
    input_tokens bigint not null default 0,
    output_tokens bigint not null default 0,
    web_search_count integer not null default 0,
    session_id text,
    occurred_at timestamptz not null default now()
);

create index if not exists usage_events_user_id_idx on public.usage_events (user_id);
create index if not exists usage_events_occurred_at_idx on public.usage_events (occurred_at);
create index if not exists usage_events_user_month_idx
    on public.usage_events (user_id, date_trunc('month', occurred_at));

-- RLS: only the service role (Edge Functions) can read/write.
alter table public.polar_invoices enable row level security;
alter table public.polar_webhook_events enable row level security;
alter table public.profiles enable row level security;
alter table public.usage_events enable row level security;
