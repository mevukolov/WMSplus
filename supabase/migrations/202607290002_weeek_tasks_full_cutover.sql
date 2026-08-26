alter table public.weeek_tasks
  add column if not exists task_status text not null default 'Не начато',
  add column if not exists reopen_after timestamptz,
  add column if not exists opp_verdict_synced_at timestamptz,
  add column if not exists opp_verdict_raw jsonb,
  add column if not exists source_generated_at timestamptz,
  add column if not exists return_board_id text,
  add column if not exists return_board_name text,
  add column if not exists return_column_id text,
  add column if not exists return_column_name text,
  add column if not exists reopen_count integer not null default 0,
  add column if not exists deferred_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists finalized_at timestamptz,
  add column if not exists last_transition text;

alter table public.weeek_tasks
  alter column opp_verdict set default 'Не выбран';

update public.weeek_tasks
set opp_verdict = 'Не выбран'
where nullif(opp_verdict, '') is null
   or (source_module = 'incoming_boxes' and opp_verdict = 'Новая');

create index if not exists weeek_tasks_task_status_idx
  on public.weeek_tasks (task_status);

create index if not exists weeek_tasks_reopen_after_idx
  on public.weeek_tasks (reopen_after)
  where reopen_after is not null;

create index if not exists weeek_tasks_last_transition_idx
  on public.weeek_tasks (last_transition);

comment on column public.weeek_tasks.task_status is
  'Статус задания, который система присваивает по Вердикту ОПП: Завершено, Отложено, Не начато.';

comment on column public.weeek_tasks.reopen_after is
  'Для отложенных задач: дата и время, когда задачу нужно вернуть в работу.';

comment on column public.weeek_tasks.opp_verdict is
  'Вердикт ОПП. Не задаётся модулями подгрузки; синхронизируется из WEEEK пользователем/мастером.';

create table if not exists public.weeek_task_routes (
  id uuid primary key default gen_random_uuid(),
  route_key text not null unique,
  task_type text not null,
  enabled boolean not null default true,

  active_board_id text,
  active_board_name text not null,
  active_default_column_id text,
  active_default_column_name text not null,

  inactive_board_id text,
  inactive_board_name text not null,
  inactive_wait_column_id text,
  inactive_wait_column_name text not null,
  inactive_done_column_id text,
  inactive_done_column_name text not null,

  reopen_after_days integer not null default 2,
  reopen_date_field_id text,
  reopen_date_field_name text not null default 'Дата переоткрытия',

  reopened_tag_id text,
  reopened_tag_name text not null default 'Переоткрытое задание',

  deferred_verdicts text[] not null default array[
    'Отправлен на релиз',
    'Отправлен на списание ревизией',
    'Отправлен запрос'
  ],
  final_verdicts text[] not null default array[
    'Найден/Релиз/Списан',
    'Нет на МХ/Не найден'
  ],
  not_started_verdicts text[] not null default array[
    'Не выбран',
    'Новая',
    'Не начато'
  ],

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.weeek_task_routes
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists route_key text,
  add column if not exists task_type text,
  add column if not exists enabled boolean not null default true,
  add column if not exists active_board_id text,
  add column if not exists active_board_name text not null default '❗️ Активные задачи',
  add column if not exists active_default_column_id text,
  add column if not exists active_default_column_name text not null default 'Коробки на входе',
  add column if not exists inactive_board_id text,
  add column if not exists inactive_board_name text not null default '❌ Неактивные задачи',
  add column if not exists inactive_wait_column_id text,
  add column if not exists inactive_wait_column_name text not null default 'Ожидание',
  add column if not exists inactive_done_column_id text,
  add column if not exists inactive_done_column_name text not null default 'Разбор завершен',
  add column if not exists reopen_after_days integer not null default 2,
  add column if not exists reopen_date_field_id text,
  add column if not exists reopen_date_field_name text not null default 'Дата переоткрытия',
  add column if not exists reopened_tag_id text,
  add column if not exists reopened_tag_name text not null default 'Переоткрытое задание',
  add column if not exists deferred_verdicts text[] not null default array['Отправлен на релиз','Отправлен на списание ревизией','Отправлен запрос'],
  add column if not exists final_verdicts text[] not null default array['Найден/Релиз/Списан','Нет на МХ/Не найден'],
  add column if not exists not_started_verdicts text[] not null default array['Не выбран','Новая','Не начато'],
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists weeek_task_routes_route_key_uidx
  on public.weeek_task_routes (route_key);

create index if not exists weeek_task_routes_enabled_idx
  on public.weeek_task_routes (enabled, route_key);

create or replace function public.set_updated_at_weeek_task_routes()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_weeek_task_routes on public.weeek_task_routes;
create trigger trg_set_updated_at_weeek_task_routes
before update on public.weeek_task_routes
for each row
execute function public.set_updated_at_weeek_task_routes();

insert into public.weeek_task_routes (
  route_key,
  task_type,
  active_board_name,
  active_default_column_name,
  inactive_board_name,
  inactive_wait_column_name,
  inactive_done_column_name,
  reopen_after_days,
  reopen_date_field_name,
  reopened_tag_name,
  deferred_verdicts,
  final_verdicts,
  not_started_verdicts
)
values (
  'incoming_boxes',
  'Коробки на входе',
  '❗️ Активные задачи',
  'Коробки на входе',
  '❌ Неактивные задачи',
  'Ожидание',
  'Разбор завершен',
  2,
  'Дата переоткрытия',
  'Переоткрытое задание',
  array['Отправлен на релиз','Отправлен на списание ревизией','Отправлен запрос'],
  array['Найден/Релиз/Списан','Нет на МХ/Не найден'],
  array['Не выбран','Новая','Не начато']
)
on conflict (route_key) do update set
  task_type = excluded.task_type,
  active_board_name = excluded.active_board_name,
  active_default_column_name = excluded.active_default_column_name,
  inactive_board_name = excluded.inactive_board_name,
  inactive_wait_column_name = excluded.inactive_wait_column_name,
  inactive_done_column_name = excluded.inactive_done_column_name,
  reopen_after_days = excluded.reopen_after_days,
  reopen_date_field_name = excluded.reopen_date_field_name,
  reopened_tag_name = excluded.reopened_tag_name,
  deferred_verdicts = excluded.deferred_verdicts,
  final_verdicts = excluded.final_verdicts,
  not_started_verdicts = excluded.not_started_verdicts;

comment on table public.weeek_task_routes is
  'Routing settings for weeek-task-master: active/inactive boards, columns, verdict groups and reopen rules.';

create or replace function public.upsert_weeek_tasks_from_json(p_tasks jsonb)
returns integer
language plpgsql
as $$
declare
  item jsonb;
  affected_count integer := 0;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_tasks)
  loop
    insert into public.weeek_tasks (
      source_module,
      source_table,
      source_id,
      source_row_id,
      source_payload,
      source_generated_at,
      task_type,
      board_key,
      column_key,
      title,
      description,
      priority,
      start_date,
      due_date,
      target_workspace_id,
      target_project_id,
      target_board_id,
      target_board_name,
      target_column_id,
      target_column_name,
      target_assignee_ids,
      target_custom_fields,
      target_tags,
      enabled,
      master_status,
      master_action,
      last_seen_at
    )
    values (
      item->>'source_module',
      item->>'source_table',
      item->>'source_id',
      item->>'source_row_id',
      coalesce(item->'source_payload', '{}'::jsonb),
      nullif(item->>'source_generated_at', '')::timestamptz,
      item->>'task_type',
      item->>'board_key',
      item->>'column_key',
      item->>'title',
      item->>'description',
      coalesce(nullif(item->>'priority', '')::integer, 0),
      nullif(item->>'start_date', '')::date,
      nullif(item->>'due_date', '')::date,
      item->>'target_workspace_id',
      item->>'target_project_id',
      item->>'target_board_id',
      item->>'target_board_name',
      item->>'target_column_id',
      item->>'target_column_name',
      case
        when jsonb_typeof(item->'target_assignee_ids') = 'array'
          then array(select jsonb_array_elements_text(item->'target_assignee_ids'))
        else '{}'::text[]
      end,
      coalesce(item->'target_custom_fields', '{}'::jsonb),
      coalesce(item->'target_tags', '[]'::jsonb),
      coalesce(nullif(item->>'enabled', '')::boolean, true),
      'queued',
      coalesce(nullif(item->>'master_action', ''), 'upsert'),
      timezone('utc', now())
    )
    on conflict (source_module, source_id, task_type)
    do update set
      source_table = excluded.source_table,
      source_row_id = excluded.source_row_id,
      source_payload = excluded.source_payload,
      source_generated_at = excluded.source_generated_at,
      board_key = excluded.board_key,
      column_key = excluded.column_key,
      title = excluded.title,
      description = excluded.description,
      priority = excluded.priority,
      start_date = excluded.start_date,
      due_date = excluded.due_date,
      target_workspace_id = excluded.target_workspace_id,
      target_project_id = excluded.target_project_id,
      target_board_id = excluded.target_board_id,
      target_board_name = excluded.target_board_name,
      target_column_id = excluded.target_column_id,
      target_column_name = excluded.target_column_name,
      target_assignee_ids = excluded.target_assignee_ids,
      target_custom_fields = excluded.target_custom_fields,
      target_tags = excluded.target_tags,
      enabled = excluded.enabled,
      master_action = excluded.master_action,
      last_seen_at = excluded.last_seen_at,
      master_status = case
        when public.weeek_tasks.task_status = 'Завершено' then public.weeek_tasks.master_status
        when public.weeek_tasks.master_status not in ('queued', 'processing')
          and (
            public.weeek_tasks.board_key is distinct from excluded.board_key
            or public.weeek_tasks.column_key is distinct from excluded.column_key
            or public.weeek_tasks.title is distinct from excluded.title
            or public.weeek_tasks.description is distinct from excluded.description
            or public.weeek_tasks.priority is distinct from excluded.priority
            or public.weeek_tasks.start_date is distinct from excluded.start_date
            or public.weeek_tasks.due_date is distinct from excluded.due_date
            or public.weeek_tasks.target_workspace_id is distinct from excluded.target_workspace_id
            or public.weeek_tasks.target_project_id is distinct from excluded.target_project_id
            or public.weeek_tasks.target_board_id is distinct from excluded.target_board_id
            or public.weeek_tasks.target_column_id is distinct from excluded.target_column_id
            or public.weeek_tasks.target_column_name is distinct from excluded.target_column_name
            or public.weeek_tasks.target_assignee_ids is distinct from excluded.target_assignee_ids
            or public.weeek_tasks.target_custom_fields is distinct from excluded.target_custom_fields
            or public.weeek_tasks.target_tags is distinct from excluded.target_tags
          )
        then 'queued'
        else public.weeek_tasks.master_status
      end;

    affected_count := affected_count + 1;
  end loop;

  return affected_count;
end;
$$;

comment on function public.upsert_weeek_tasks_from_json(jsonb) is
  'Generic module ingest helper. It writes desired task state into weeek_tasks and never overwrites opp_verdict, task_status or reopen_after.';

drop function if exists public.enqueue_incoming_box_weeek_tasks();

do $$
declare
  old_job text;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  foreach old_job in array array[
    'box-tracker-refresh-30m',
    'box-tracker-refresh-10m',
    'box-tracker-upload-10m',
    'box-plane-upload-10m',
    'box-plane-status-sync-10m',
    'box-weeek-upload-5m',
    'box-weeek-upload-10m',
    'box-weeek-status-sync-10m',
    'weeek-tasks-enqueue-incoming-boxes-10m'
  ]
  loop
    if exists (select 1 from cron.job where jobname = old_job) then
      perform cron.unschedule(old_job);
    end if;
  end loop;
end $$;

alter table public.weeek_tasks disable row level security;
alter table public.weeek_task_routes disable row level security;

grant select on public.weeek_tasks to anon, authenticated;
grant select on public.weeek_task_routes to anon, authenticated;

drop table if exists public.box_tracker_rep cascade;
