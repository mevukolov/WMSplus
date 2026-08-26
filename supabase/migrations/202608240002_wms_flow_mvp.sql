-- WMS+ Flow MVP: explicit fields for the future server-side dispatcher.
-- The current browser MVP also mirrors claim data into source_payload.wms_flow,
-- so the UI remains backward-compatible until this migration is applied.

create extension if not exists pgcrypto;

alter table if exists public.wms_tasks
  add column if not exists flow_status text not null default 'active',
  add column if not exists priority_score numeric,
  add column if not exists priority_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists priority_version text,
  add column if not exists priority_calculated_at timestamptz,
  add column if not exists flow_claimed_by text,
  add column if not exists flow_claimed_name text,
  add column if not exists flow_claimed_at timestamptz,
  add column if not exists flow_lock_until timestamptz,
  add column if not exists flow_skip_count integer not null default 0,
  add column if not exists incident_group_id text,
  add column if not exists grouping_key text,
  add column if not exists grouping_confidence numeric;

create index if not exists wms_tasks_flow_status_idx
  on public.wms_tasks (flow_status, priority_score desc nulls last, due_date)
  where is_deleted = false;

create index if not exists wms_tasks_flow_lock_idx
  on public.wms_tasks (flow_lock_until)
  where is_deleted = false and flow_lock_until is not null;

create index if not exists wms_tasks_incident_group_idx
  on public.wms_tasks (incident_group_id)
  where incident_group_id is not null;

create table if not exists public.wms_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.wms_tasks(id) on delete cascade,
  event_type text not null,
  actor_employee_id text,
  actor_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists wms_task_history_task_idx
  on public.wms_task_history (task_id, created_at desc);

create index if not exists wms_task_history_event_idx
  on public.wms_task_history (event_type, created_at desc);

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
    'lock_ttl_minutes', 15,
    'strict_incoming_sections', jsonb_build_array('Запросы входящего потока', 'Коробки на входе'),
    'strict_outgoing_sections', jsonb_build_array('Списания AWH'),
    'note', 'MVP settings. Browser calculates the first Flow score; server-side calibration comes next.'
  )
)
on conflict (version) do update set
  is_active = excluded.is_active,
  settings = excluded.settings,
  updated_at = timezone('utc', now());
