-- WMS+ Flow Stage 2: richer default score settings and history indexes.
-- Safe to run after 202608240002_wms_flow_mvp.sql; uses IF NOT EXISTS / ON CONFLICT.

create extension if not exists pgcrypto;

create table if not exists public.wms_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.wms_tasks(id) on delete cascade,
  event_type text not null,
  actor_employee_id text,
  actor_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists wms_task_history_actor_idx
  on public.wms_task_history (actor_employee_id, created_at desc)
  where actor_employee_id is not null;

create index if not exists wms_task_history_event_actor_idx
  on public.wms_task_history (event_type, actor_employee_id, created_at desc);

create table if not exists public.wms_flow_score_settings (
  version text primary key,
  is_active boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.wms_flow_score_settings (version, is_active, settings)
values (
  'flow-mvp-2026-08-24',
  true,
  jsonb_build_object(
    'lockTtlMinutes', 15,
    'lock_ttl_minutes', 15,
    'weights', jsonb_build_object(
      'price', 1,
      'urgency', 1,
      'source', 1,
      'mass', 1,
      'age', 1,
      'reopen', 1,
      'tags', 1,
      'group', 1,
      'zone', 1,
      'skill', 1
    ),
    'sourceBoosts', jsonb_build_object(
      'incomingFlowRequests', 60000,
      'awhWriteoffs', 18000,
      'incomingBoxes', 16000,
      'prespisokSecondLine', 22000,
      'afterSaleMovement', 14000
    ),
    'zone', jsonb_build_object(
      'own', 1.18,
      'otherFlexible', 0.82,
      'overflowBonus', 0.22,
      'heavyLoadBonus', 0.14,
      'strictBonus', 0.08
    ),
    'grouping', jsonb_build_object(
      'enabled', true,
      'minCount', 3,
      'windowMinutes', 120,
      'perExtraTask', 1800,
      'pricePercent', 0.08,
      'maxBonus', 42000
    ),
    'skill', jsonb_build_object(
      'enabled', true,
      'lookbackDays', 14,
      'minCompleted', 5,
      'perCompletion', 0.008,
      'maxMultiplier', 1.16
    ),
    'note', 'Stage 2: browser Flow score uses weights, live zone load, personal manual-completion stats and experimental MX/status/time grouping.'
  )
)
on conflict (version) do update set
  is_active = excluded.is_active,
  settings = public.wms_flow_score_settings.settings || excluded.settings,
  updated_at = timezone('utc', now());
