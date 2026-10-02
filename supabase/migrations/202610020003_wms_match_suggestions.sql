-- Первый шаг страглер-фиг эволюции (см. "Риски перехода" в
-- docs/superpowers/specs/2026-10-02-wms-entity-glossary-design.md):
-- выносим no_shk_matches из JSON-массива внутри wms_tasks.source_payload
-- в отдельную реляционную таблицу -- это и есть "Предложение соответствия"
-- из словаря понятий. has_pending_no_shk_match на wms_tasks НЕ убираем --
-- это ровно та денормализованная копия для быстрого чтения списка,
-- которую словарь сам же рекомендует, просто теперь она питается от этой
-- новой таблицы, а не от JSON.

create table public.wms_match_suggestions (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references public.wms_tasks(id) on delete cascade,
    submission_id uuid not null references public.intake_submissions(id),
    nm text,
    task_nm text,
    match_score double precision,
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
    decided_by_id text,
    decided_by_name text,
    decided_at timestamptz,
    snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (task_id, submission_id)
);

create index wms_match_suggestions_task_id_idx on public.wms_match_suggestions(task_id);
create index wms_match_suggestions_submission_id_idx on public.wms_match_suggestions(submission_id);
create index wms_match_suggestions_status_idx on public.wms_match_suggestions(status);

alter table public.wms_match_suggestions enable row level security;

create policy "wms_match_suggestions_authenticated_all" on public.wms_match_suggestions
    for all
    to authenticated
    using (true)
    with check (true);

-- Бэкофилл существующих записей (все decision-статусы, не только pending --
-- история решённых тоже не теряется).
insert into public.wms_match_suggestions
    (task_id, submission_id, nm, task_nm, status, decided_by_id, decided_by_name, decided_at, snapshot, created_at)
select
    t.id as task_id,
    (elem->>'submission_id')::uuid,
    elem->>'nm',
    elem->>'task_nm',
    coalesce(nullif(elem->>'decision', ''), 'pending'),
    nullif(elem->>'decided_by_id', ''),
    nullif(elem->>'decided_by_name', ''),
    nullif(elem->>'decided_at', '')::timestamptz,
    coalesce(elem->'snapshot', '{}'::jsonb),
    coalesce(nullif(elem->>'matched_at', '')::timestamptz, now())
from public.wms_tasks t,
     jsonb_array_elements(coalesce(t.source_payload->'no_shk_matches', '[]'::jsonb)) as elem
where elem->>'submission_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict (task_id, submission_id) do nothing;

-- JSON больше не читается никаким кодом после этой миграции -- очищаем
-- ключ, чтобы не оставлять задвоенную, расходящуюся со временем копию
-- данных прямо в проде.
update public.wms_tasks
set source_payload = source_payload - 'no_shk_matches'
where source_payload ? 'no_shk_matches';

-- Переписываем автопоиск: вставляем строки напрямую (реляционно), вместо
-- сборки jsonb и jsonb_set. on conflict do nothing -- та же дедупликация
-- по (task_id, submission_id), что была в JS-версии через v_known_ids.
create or replace function public.wms_no_shk_bulk_match_and_persist()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    perform set_config('pg_trgm.similarity_threshold', '0.35', true);

    with open_tasks as (
        select id from public.wms_tasks
        where is_deleted = false
          and opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
    ),
    wb_candidates as (
        select s.id as submission_id, elem as nm, s.created_at, s.box_id,
               s.item_text, s.photo_path, s.full_name, s.area, s.sticker_code, s.item_type
        from public.intake_submissions s,
             jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) as elem
        where s.matched_task_id is null
    ),
    pairs as (
        select ti.task_id, sn.*, ti.nm as task_nm, 1 as path_rank, null::double precision as match_score
        from public.wms_task_nm_index ti
        join open_tasks ot on ot.id = ti.task_id
        join wb_candidates sn on sn.nm = ti.nm
        where ti.movement is not null
          and sn.created_at >= (ti.movement - interval '1 day')
          and sn.created_at < (ti.movement + interval '6 day')

        union all

        select ti.task_id, sn.*, ti.nm as task_nm, 2 as path_rank,
               (similarity(lower(trim(dc.name)), lower(trim(dt.name)))
                + similarity(lower(trim(dc.brand)), lower(trim(dt.brand)))) / 2 as match_score
        from public.wms_task_nm_index ti
        join open_tasks ot on ot.id = ti.task_id
        join public.wms_nm_directory dt
            on dt.nm = ti.nm
           and dt.brand is not null and trim(dt.brand) <> '' and lower(trim(dt.brand)) <> 'нет бренда'
           and dt.name is not null and trim(dt.name) <> ''
        join public.wms_nm_directory dc
            on lower(trim(dc.name)) % lower(trim(dt.name))
           and lower(trim(dc.brand)) % lower(trim(dt.brand))
           and similarity(lower(trim(dc.name)), lower(trim(dt.name))) >= 0.5
           and similarity(lower(trim(dc.brand)), lower(trim(dt.brand))) >= 0.35
           and dc.brand is not null and trim(dc.brand) <> '' and lower(trim(dc.brand)) <> 'нет бренда'
           and dc.name is not null and trim(dc.name) <> ''
           and dc.nm <> dt.nm
        join wb_candidates sn on sn.nm = dc.nm
        where ti.movement is not null
          and sn.created_at >= (ti.movement - interval '1 day')
          and sn.created_at < (ti.movement + interval '6 day')
    ),
    best_pairs as (
        select distinct on (task_id, submission_id)
               task_id, submission_id, nm, task_nm, match_score,
               item_text, photo_path, full_name, area, sticker_code, item_type, box_id
        from pairs
        order by task_id, submission_id, path_rank asc, match_score desc nulls last
    ),
    inserted as (
        insert into public.wms_match_suggestions (task_id, submission_id, nm, task_nm, match_score, snapshot)
        select task_id, submission_id, nm, task_nm, match_score,
               jsonb_build_object(
                   'item_text', item_text,
                   'photo_path', photo_path,
                   'full_name', full_name,
                   'area', area,
                   'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'sticker_code', sticker_code,
                   'item_type', item_type,
                   'box_id', box_id
               )
        from best_pairs
        on conflict (task_id, submission_id) do nothing
        returning task_id
    )
    update public.wms_tasks
    set has_pending_no_shk_match = true,
        updated_at = now()
    where id in (select distinct task_id from inserted);

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;
