create extension if not exists pgcrypto;

create table if not exists public.weeek_tasks_basic (
  like public.weeek_tasks including defaults including constraints
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.weeek_tasks_basic'::regclass
      and contype = 'p'
  ) then
    alter table public.weeek_tasks_basic
      add constraint weeek_tasks_basic_pkey primary key (id);
  end if;
end;
$$;

alter table public.weeek_tasks_basic
  add column if not exists source_shk_ids text[] not null default '{}'::text[],
  add column if not exists source_tare_id text,
  add column if not exists source_price_sum numeric,
  add column if not exists source_last_movement_at timestamptz,
  add column if not exists search_text text;

alter table public.weeek_tasks_basic
  alter column opp_verdict set default 'Не выбран';

update public.weeek_tasks_basic
set opp_verdict = 'Не выбран'
where nullif(opp_verdict, '') is null
   or opp_verdict = 'Новая';

create unique index if not exists weeek_tasks_basic_source_uidx
  on public.weeek_tasks_basic (source_module, source_id, task_type);

create index if not exists weeek_tasks_basic_master_queue_idx
  on public.weeek_tasks_basic (enabled, master_status, updated_at)
  where enabled = true;

create index if not exists weeek_tasks_basic_board_idx
  on public.weeek_tasks_basic (board_key, target_board_id, target_column_id);

create index if not exists weeek_tasks_basic_opp_verdict_idx
  on public.weeek_tasks_basic (opp_verdict);

create index if not exists weeek_tasks_basic_weeek_task_id_idx
  on public.weeek_tasks_basic (weeek_task_id)
  where weeek_task_id is not null;

create index if not exists weeek_tasks_basic_source_tare_idx
  on public.weeek_tasks_basic (source_tare_id)
  where source_tare_id is not null;

create index if not exists weeek_tasks_basic_source_shk_ids_gin_idx
  on public.weeek_tasks_basic using gin (source_shk_ids);

create index if not exists weeek_tasks_basic_task_status_idx
  on public.weeek_tasks_basic (task_status);

create index if not exists weeek_tasks_basic_reopen_after_idx
  on public.weeek_tasks_basic (reopen_after)
  where reopen_after is not null;

drop trigger if exists trg_set_updated_at_weeek_tasks_basic on public.weeek_tasks_basic;
create trigger trg_set_updated_at_weeek_tasks_basic
before update on public.weeek_tasks_basic
for each row
execute function public.set_updated_at_weeek_tasks();

comment on table public.weeek_tasks_basic is
  'Lightweight/manual WEEEK task queue. Used for XLSX imports and tasks where source rows are uploaded manually, isolated from the main weeek_tasks pipeline.';

comment on column public.weeek_tasks_basic.source_shk_ids is
  'All SHK IDs covered by the task. For tare-grouped tasks this stores every SHK in the tare, so history can be searched by a concrete SHK.';

comment on column public.weeek_tasks_basic.source_tare_id is
  'Tare ID when the task was grouped by common tare.';

create or replace function public.upsert_weeek_tasks_basic_from_json(p_tasks jsonb)
returns integer
language plpgsql
as $$
declare
  item jsonb;
  affected_count integer := 0;
  v_source_shk_ids text[];
  v_source_price_sum numeric;
  v_source_last_movement_at timestamptz;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_tasks)
  loop
    v_source_shk_ids := case
      when jsonb_typeof(item->'source_shk_ids') = 'array'
        then array(select jsonb_array_elements_text(item->'source_shk_ids'))
      else '{}'::text[]
    end;

    v_source_price_sum := null;
    begin
      v_source_price_sum := nullif(item->>'source_price_sum', '')::numeric;
    exception when others then
      v_source_price_sum := null;
    end;

    v_source_last_movement_at := null;
    begin
      v_source_last_movement_at := nullif(item->>'source_last_movement_at', '')::timestamptz;
    exception when others then
      v_source_last_movement_at := null;
    end;

    insert into public.weeek_tasks_basic (
      source_module,
      source_table,
      source_id,
      source_row_id,
      source_payload,
      source_generated_at,
      source_shk_ids,
      source_tare_id,
      source_price_sum,
      source_last_movement_at,
      search_text,
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
      v_source_shk_ids,
      nullif(item->>'source_tare_id', ''),
      v_source_price_sum,
      v_source_last_movement_at,
      nullif(item->>'search_text', ''),
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
      source_shk_ids = excluded.source_shk_ids,
      source_tare_id = excluded.source_tare_id,
      source_price_sum = excluded.source_price_sum,
      source_last_movement_at = excluded.source_last_movement_at,
      search_text = excluded.search_text,
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
        when public.weeek_tasks_basic.task_status = 'Завершено' then public.weeek_tasks_basic.master_status
        when public.weeek_tasks_basic.master_status not in ('queued', 'processing')
          and (
            public.weeek_tasks_basic.source_payload is distinct from excluded.source_payload
            or public.weeek_tasks_basic.source_shk_ids is distinct from excluded.source_shk_ids
            or public.weeek_tasks_basic.source_tare_id is distinct from excluded.source_tare_id
            or public.weeek_tasks_basic.source_price_sum is distinct from excluded.source_price_sum
            or public.weeek_tasks_basic.source_last_movement_at is distinct from excluded.source_last_movement_at
            or public.weeek_tasks_basic.board_key is distinct from excluded.board_key
            or public.weeek_tasks_basic.column_key is distinct from excluded.column_key
            or public.weeek_tasks_basic.title is distinct from excluded.title
            or public.weeek_tasks_basic.description is distinct from excluded.description
            or public.weeek_tasks_basic.priority is distinct from excluded.priority
            or public.weeek_tasks_basic.start_date is distinct from excluded.start_date
            or public.weeek_tasks_basic.due_date is distinct from excluded.due_date
            or public.weeek_tasks_basic.target_workspace_id is distinct from excluded.target_workspace_id
            or public.weeek_tasks_basic.target_project_id is distinct from excluded.target_project_id
            or public.weeek_tasks_basic.target_board_id is distinct from excluded.target_board_id
            or public.weeek_tasks_basic.target_board_name is distinct from excluded.target_board_name
            or public.weeek_tasks_basic.target_column_id is distinct from excluded.target_column_id
            or public.weeek_tasks_basic.target_column_name is distinct from excluded.target_column_name
            or public.weeek_tasks_basic.target_assignee_ids is distinct from excluded.target_assignee_ids
            or public.weeek_tasks_basic.target_custom_fields is distinct from excluded.target_custom_fields
            or public.weeek_tasks_basic.target_tags is distinct from excluded.target_tags
          )
        then 'queued'
        else public.weeek_tasks_basic.master_status
      end;

    affected_count := affected_count + 1;
  end loop;

  return affected_count;
end;
$$;

comment on function public.upsert_weeek_tasks_basic_from_json(jsonb) is
  'Manual/basic WEEEK ingest helper. Keeps user verdict/reopen status intact and stores SHK arrays for future search.';

insert into public.weeek_task_routes (
  route_key,
  task_type,
  active_board_id,
  active_board_name,
  active_default_column_id,
  active_default_column_name,
  inactive_board_id,
  inactive_board_name,
  inactive_wait_column_id,
  inactive_wait_column_name,
  inactive_done_column_id,
  inactive_done_column_name,
  reopen_after_days,
  reopen_date_field_id,
  reopen_date_field_name,
  reopened_tag_name,
  deferred_verdicts,
  final_verdicts,
  not_started_verdicts
)
values (
  'manual_packaging_opp',
  'Разбор ОПП // Упаковка',
  '3',
  '❗️ Активные задачи',
  null,
  'Упаковка',
  '7',
  '❌ Неактивные задачи',
  null,
  'Ожидание',
  null,
  'Разбор завершен',
  2,
  'a25fe442-940f-4bd9-86c0-eeb25de06655',
  'Дата переоткрытия',
  'Переоткрытое задание',
  array['Отправлен на релиз','Отправлен на списание ревизией','Отправлен запрос'],
  array['Найден/Релиз/Списан','Нет на МХ/Не найден'],
  array['Не выбран','Новая','Не начато']
)
on conflict (route_key) do update set
  task_type = excluded.task_type,
  active_board_id = excluded.active_board_id,
  active_board_name = excluded.active_board_name,
  active_default_column_id = excluded.active_default_column_id,
  active_default_column_name = excluded.active_default_column_name,
  inactive_board_id = excluded.inactive_board_id,
  inactive_board_name = excluded.inactive_board_name,
  inactive_wait_column_id = excluded.inactive_wait_column_id,
  inactive_wait_column_name = excluded.inactive_wait_column_name,
  inactive_done_column_id = excluded.inactive_done_column_id,
  inactive_done_column_name = excluded.inactive_done_column_name,
  reopen_after_days = excluded.reopen_after_days,
  reopen_date_field_id = excluded.reopen_date_field_id,
  reopen_date_field_name = excluded.reopen_date_field_name,
  reopened_tag_name = excluded.reopened_tag_name,
  deferred_verdicts = excluded.deferred_verdicts,
  final_verdicts = excluded.final_verdicts,
  not_started_verdicts = excluded.not_started_verdicts,
  updated_at = timezone('utc', now());

alter table public.weeek_tasks_basic disable row level security;
grant select on public.weeek_tasks_basic to anon, authenticated;
