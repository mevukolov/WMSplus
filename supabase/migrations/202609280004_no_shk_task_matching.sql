-- 202609280004_no_shk_task_matching.sql
-- Связывает задачи Разбора с фото "Без ШК" (intake_submissions) по
-- вероятному НМ (wb_nm_candidates, уже считает wb-photo-match) и окну дат
-- вокруг последнего движения товара в задаче. Матчинг живёт на клиенте
-- (wms_no_shk_task_matches, вызывается точечно при открытии карточки
-- задачи -- как уже работает связка "Два ШК"/loadSpecialMap), а не
-- фоновым job'ом: окно всего 6 дней, объём intake_submissions не
-- оправдывает отдельный cron. См.
-- docs/superpowers/specs/2026-09-28-task-no-shk-matching-design.md.

alter table public.intake_submissions
    add column if not exists matched_task_id uuid references public.wms_tasks(id),
    add column if not exists matched_shk text,
    add column if not exists matched_at timestamptz,
    add column if not exists matched_by_id text,
    add column if not exists matched_by_name text;

-- Окно матчинга -- всего 6 дней вокруг движения задачи; обычного индекса
-- на created_at достаточно (GIN не оправдан при этом объёме и разбросе).
create index if not exists intake_submissions_created_at_idx
    on public.intake_submissions (created_at);

create or replace function public.wms_no_shk_task_matches(
    p_nms text[],
    p_date_from date,
    p_date_to date
) returns table (
    id uuid,
    item_text text,
    category text,
    item_type text,
    area text,
    full_name text,
    employee_id integer,
    created_at timestamptz,
    photo_path text,
    sticker_code text,
    no_shk_bucket text,
    wb_nm_candidates jsonb,
    matched_task_id uuid,
    matched_shk text
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           created_at, photo_path, sticker_code, no_shk_bucket,
           wb_nm_candidates, matched_task_id, matched_shk
    from public.intake_submissions
    where matched_task_id is null
      and p_nms is not null and array_length(p_nms, 1) > 0
      and created_at >= p_date_from
      and created_at < p_date_to + interval '1 day'
      and exists (
          select 1
          from jsonb_array_elements_text(coalesce(wb_nm_candidates, '[]'::jsonb)) elem
          where elem = any(p_nms)
      )
    order by created_at desc
    limit 50;
$$;

grant execute on function public.wms_no_shk_task_matches(text[], date, date) to anon;

-- Отдаёт задаче эксклюзивное право на эту запись "без ШК": первый
-- "Опознать" побеждает (матчится task_id is null в условии update), любой
-- следующий по той же записи из другой задачи получит 0 строк -- клиент
-- обязан это проверить и НЕ писать историю задачи при пустом результате.
create or replace function public.wms_intake_mark_matched(
    p_submission_id uuid,
    p_task_id uuid,
    p_shk text,
    p_actor_id text,
    p_actor_name text
) returns table (id uuid, matched_task_id uuid, matched_shk text)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    update public.intake_submissions
    set matched_task_id = p_task_id,
        matched_shk = p_shk,
        matched_at = now(),
        matched_by_id = p_actor_id,
        matched_by_name = p_actor_name
    where intake_submissions.id = p_submission_id
      and intake_submissions.matched_task_id is null
    returning intake_submissions.id, intake_submissions.matched_task_id, intake_submissions.matched_shk;
end;
$$;

grant execute on function public.wms_intake_mark_matched(uuid, uuid, text, text, text) to anon;

-- wms_intake_submissions_search должна отдавать matched_task_id/matched_shk
-- фронту (лента "Без ШК" показывает "ШК опознан: ..." на кнопке). Postgres
-- не даёт CREATE OR REPLACE менять состав RETURNS TABLE -- дропаем и
-- создаём заново (тот же приём, что в 202609250001).
drop function if exists public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int, boolean);

create or replace function public.wms_intake_submissions_search(
    p_areas text[] default null,
    p_categories text[] default null,
    p_item_types text[] default null,
    p_employee_query text default null,
    p_date_from date default null,
    p_date_to date default null,
    p_query text default null,
    p_limit int default 50,
    p_offset int default 0,
    p_unassigned_only boolean default false
) returns table (
    id uuid,
    item_text text,
    category text,
    item_type text,
    area text,
    full_name text,
    employee_id integer,
    shift_date date,
    shift_type text,
    no_shk_bucket text,
    created_at timestamptz,
    photo_path text,
    sticker_code text,
    wb_nm_candidates jsonb,
    matched_task_id uuid,
    matched_shk text
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           shift_date, shift_type, no_shk_bucket, created_at, photo_path, sticker_code,
           wb_nm_candidates, matched_task_id, matched_shk
    from public.intake_submissions
    where (p_areas is null or area = any(p_areas))
      and (p_categories is null or category = any(p_categories))
      and (p_item_types is null or item_type = any(p_item_types))
      and (
        p_employee_query is null
        or full_name ilike '%' || p_employee_query || '%'
        or employee_id::text ilike '%' || p_employee_query || '%'
      )
      and (p_date_from is null or shift_date >= p_date_from)
      and (p_date_to is null or shift_date <= p_date_to)
      and (not p_unassigned_only or sticker_code is null)
      and (
        p_query is null or trim(p_query) = ''
        or not exists (
            select 1
            from unnest(regexp_split_to_array(lower(trim(p_query)), '\s+')) as qw
            where word_similarity(qw, lower(coalesce(item_text, '') || ' ' || coalesce(category, ''))) < 0.3
        )
      )
    order by created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0);
$$;

grant execute on function public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int, boolean) to anon;
