create extension if not exists pgcrypto;

create table if not exists public.weeek_tasks (
  id uuid primary key default gen_random_uuid(),

  -- Source identity: any module can own a task without depending on box_tracker_rep.
  source_module text not null,
  source_table text,
  source_id text not null,
  source_row_id text,
  source_payload jsonb not null default '{}'::jsonb,

  -- Business routing.
  task_type text not null,
  opp_verdict text not null default 'Новая',
  board_key text not null,
  column_key text,

  -- Desired WEEEK state. weeek-task-master should make WEEEK match these fields.
  title text not null,
  description text,
  priority integer not null default 0 check (priority between 0 and 3),
  start_date date,
  due_date date,
  target_workspace_id text,
  target_project_id text,
  target_board_id text,
  target_board_name text,
  target_column_id text,
  target_column_name text,
  target_assignee_ids text[] not null default '{}'::text[],
  target_custom_fields jsonb not null default '{}'::jsonb,
  target_tags jsonb not null default '[]'::jsonb,

  -- Master control.
  enabled boolean not null default true,
  master_status text not null default 'queued',
  master_action text not null default 'upsert',
  master_note text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  last_request jsonb,
  last_response jsonb,

  -- Actual WEEEK state returned by weeek-task-master.
  weeek_task_id text,
  weeek_task_url text,
  weeek_workspace_id text,
  weeek_project_id text,
  weeek_board_id text,
  weeek_board_name text,
  weeek_column_id text,
  weeek_column_name text,
  weeek_assignee_ids text[] not null default '{}'::text[],
  weeek_completed boolean,
  weeek_deleted boolean,
  weeek_updated_at timestamptz,
  synced_at timestamptz,

  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.weeek_tasks
  add column if not exists source_module text,
  add column if not exists source_table text,
  add column if not exists source_id text,
  add column if not exists source_row_id text,
  add column if not exists source_payload jsonb not null default '{}'::jsonb,
  add column if not exists task_type text,
  add column if not exists opp_verdict text not null default 'Новая',
  add column if not exists board_key text,
  add column if not exists column_key text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists priority integer not null default 0,
  add column if not exists start_date date,
  add column if not exists due_date date,
  add column if not exists target_workspace_id text,
  add column if not exists target_project_id text,
  add column if not exists target_board_id text,
  add column if not exists target_board_name text,
  add column if not exists target_column_id text,
  add column if not exists target_column_name text,
  add column if not exists target_assignee_ids text[] not null default '{}'::text[],
  add column if not exists target_custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists target_tags jsonb not null default '[]'::jsonb,
  add column if not exists enabled boolean not null default true,
  add column if not exists master_status text not null default 'queued',
  add column if not exists master_action text not null default 'upsert',
  add column if not exists master_note text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_error text,
  add column if not exists last_request jsonb,
  add column if not exists last_response jsonb,
  add column if not exists weeek_task_id text,
  add column if not exists weeek_task_url text,
  add column if not exists weeek_workspace_id text,
  add column if not exists weeek_project_id text,
  add column if not exists weeek_board_id text,
  add column if not exists weeek_board_name text,
  add column if not exists weeek_column_id text,
  add column if not exists weeek_column_name text,
  add column if not exists weeek_assignee_ids text[] not null default '{}'::text[],
  add column if not exists weeek_completed boolean,
  add column if not exists weeek_deleted boolean,
  add column if not exists weeek_updated_at timestamptz,
  add column if not exists synced_at timestamptz,
  add column if not exists last_seen_at timestamptz not null default timezone('utc', now()),
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists weeek_tasks_source_uidx
  on public.weeek_tasks (source_module, source_id, task_type);

create index if not exists weeek_tasks_master_queue_idx
  on public.weeek_tasks (enabled, master_status, updated_at)
  where enabled = true;

create index if not exists weeek_tasks_board_idx
  on public.weeek_tasks (board_key, target_board_id, target_column_id);

create index if not exists weeek_tasks_opp_verdict_idx
  on public.weeek_tasks (opp_verdict);

create index if not exists weeek_tasks_weeek_task_id_idx
  on public.weeek_tasks (weeek_task_id)
  where weeek_task_id is not null;

create or replace function public.set_updated_at_weeek_tasks()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_weeek_tasks on public.weeek_tasks;
create trigger trg_set_updated_at_weeek_tasks
before update on public.weeek_tasks
for each row
execute function public.set_updated_at_weeek_tasks();

comment on table public.weeek_tasks is
  'Universal queue/state table for all WEEEK task automations. Business modules write desired task state here; weeek-task-master creates, updates, moves and syncs WEEEK tasks.';

comment on column public.weeek_tasks.opp_verdict is
  'Вердикт ОПП. Business decision field used by automation rules to decide what should happen with the task next.';

comment on column public.weeek_tasks.board_key is
  'Internal board marker used by modules and settings. Example: incoming_boxes, pure_losses, opp_incidents.';

create or replace function public.enqueue_incoming_box_weeek_tasks()
returns integer
language plpgsql
as $$
declare
  affected_count integer;
begin
  insert into public.weeek_tasks (
    source_module,
    source_table,
    source_id,
    source_row_id,
    source_payload,
    task_type,
    opp_verdict,
    board_key,
    column_key,
    title,
    description,
    priority,
    due_date,
    target_workspace_id,
    target_project_id,
    target_board_id,
    target_board_name,
    target_column_name,
    enabled,
    master_status,
    master_action,
    last_seen_at
  )
  select
    'incoming_boxes' as source_module,
    'box_tracker_rep' as source_table,
    b.box as source_id,
    b.source_row_number::text as source_row_id,
    to_jsonb(b) as source_payload,
    'Коробки на входе' as task_type,
    coalesce(nullif(b.analysis_status, ''), 'Новая') as opp_verdict,
    'incoming_boxes' as board_key,
    'incoming_boxes' as column_key,
    'Коробка ' || b.box as title,
    concat_ws(E'\n',
      'Старший входящего потока: ' || coalesce(nullif(b.analysis, ''), '-'),
      'Комментарий входящего потока: ' || coalesce(nullif(b.comment, ''), '-'),
      'Вердикт входящего потока: ' || coalesce(nullif(b.analysis_status, ''), '-'),
      'Кол-во ШК: ' || coalesce(b.shk_qty::text, '-'),
      'Ошибка: ' || coalesce(nullif(b.error, ''), '-'),
      'ID виновного: ' || coalesce(nullif(b.guilty_id, ''), '-')
    ) as description,
    0 as priority,
    case
      when b.date is null then null
      else b.date + 29
    end as due_date,
    '1021782' as target_workspace_id,
    '2' as target_project_id,
    '3' as target_board_id,
    'Коробки' as target_board_name,
    'Коробки на входе' as target_column_name,
    true as enabled,
    'queued' as master_status,
    'upsert' as master_action,
    timezone('utc', now()) as last_seen_at
  from public.box_tracker_rep b
  where nullif(b.box, '') is not null
  on conflict (source_module, source_id, task_type)
  do update set
    source_row_id = excluded.source_row_id,
    source_payload = excluded.source_payload,
    opp_verdict = excluded.opp_verdict,
    board_key = excluded.board_key,
    column_key = excluded.column_key,
    title = excluded.title,
    description = excluded.description,
    priority = excluded.priority,
    due_date = excluded.due_date,
    target_workspace_id = excluded.target_workspace_id,
    target_project_id = excluded.target_project_id,
    target_board_id = excluded.target_board_id,
    target_board_name = excluded.target_board_name,
    target_column_name = excluded.target_column_name,
    enabled = excluded.enabled,
    master_action = excluded.master_action,
    last_seen_at = excluded.last_seen_at,
    master_status = case
      when public.weeek_tasks.master_status not in ('queued', 'processing')
        and (
          public.weeek_tasks.opp_verdict is distinct from excluded.opp_verdict
          or public.weeek_tasks.board_key is distinct from excluded.board_key
          or public.weeek_tasks.column_key is distinct from excluded.column_key
          or public.weeek_tasks.title is distinct from excluded.title
          or public.weeek_tasks.description is distinct from excluded.description
          or public.weeek_tasks.priority is distinct from excluded.priority
          or public.weeek_tasks.due_date is distinct from excluded.due_date
          or public.weeek_tasks.target_board_id is distinct from excluded.target_board_id
          or public.weeek_tasks.target_column_name is distinct from excluded.target_column_name
        )
      then 'queued'
      else public.weeek_tasks.master_status
    end;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

comment on function public.enqueue_incoming_box_weeek_tasks() is
  'Queues incoming box rows from box_tracker_rep into weeek_tasks without using tracker_* or plane_* columns.';

alter table public.weeek_tasks disable row level security;

grant select on public.weeek_tasks to anon, authenticated;
