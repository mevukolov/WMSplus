create extension if not exists pgcrypto;

create table if not exists public.wms_achievements (
  id uuid primary key default gen_random_uuid(),
  wh_id text not null default '50144199',
  user_id text not null,
  user_name text,
  achievement_id text not null,
  unlocked_at timestamptz not null default timezone('utc', now()),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.wms_achievements
  add column if not exists wh_id text not null default '50144199',
  add column if not exists user_id text,
  add column if not exists user_name text,
  add column if not exists achievement_id text,
  add column if not exists unlocked_at timestamptz not null default timezone('utc', now()),
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

create unique index if not exists wms_achievements_user_achievement_uidx
  on public.wms_achievements (wh_id, user_id, achievement_id);

create index if not exists wms_achievements_user_unlocked_idx
  on public.wms_achievements (wh_id, user_id, unlocked_at desc);

alter table public.wms_achievements disable row level security;

grant select, insert, update on public.wms_achievements to anon, authenticated;
grant all on public.wms_achievements to service_role;

comment on table public.wms_achievements is 'Unlocked WMS+ achievements by employee/user.';
