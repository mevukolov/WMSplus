-- Test Web Push subscriptions for the authenticated mobile WMS+ app.
-- Browsers never write this table directly: the Edge Function verifies the
-- caller's JWT and stores its own subscription with the service role.

create table if not exists public.wms_web_push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    auth_uid uuid not null references auth.users(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists wms_web_push_subscriptions_auth_uid_idx
    on public.wms_web_push_subscriptions (auth_uid);

alter table public.wms_web_push_subscriptions enable row level security;

-- The table contains device-specific push endpoints.  Reads and writes go
-- only through the authenticated Edge Function using the service role.
revoke all on public.wms_web_push_subscriptions from anon, authenticated;
