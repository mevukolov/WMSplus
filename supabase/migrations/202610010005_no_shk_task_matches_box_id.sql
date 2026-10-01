-- refreshTaskNoShkMatches (tasks.js) now stores submission.box_id into the
-- match's snapshot, for the new "Оклейте товар под ШК" box-location
-- prompt -- this RPC's result shape needs box_id for the client to have
-- it available. Return shape changed (new out column), so the old
-- signature has to be dropped first -- CREATE OR REPLACE can't change a
-- function's row type defined by OUT/RETURNS TABLE parameters.
drop function if exists public.wms_no_shk_task_matches(text[], date, date);

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
    matched_shk text,
    box_id uuid
) language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           created_at, photo_path, sticker_code, no_shk_bucket,
           wb_nm_candidates, matched_task_id, matched_shk, box_id
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
