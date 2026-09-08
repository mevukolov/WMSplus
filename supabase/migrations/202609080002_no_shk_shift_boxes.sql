-- 202609080002_no_shk_shift_boxes.sql
-- Shift storage addressing (see
-- docs/superpowers/specs/2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md,
-- Part B). Existing wms_no_shk_boxes rows (manually created by zone
-- staff) are untouched: outside_opp defaults to false, so they keep
-- rendering in the existing "На полу"/shelved views exactly as before.
-- New rows created by the public intake form (via
-- wms_no_shk_box_log_item below) start with outside_opp = true ("Вне
-- ОПП / Формируется") and only flip to false when a person clicks
-- "Принесено" in no_shk_zone.js (Task 8).

alter table public.wms_no_shk_boxes
    drop constraint wms_no_shk_boxes_area_check;

alter table public.wms_no_shk_boxes
    add constraint wms_no_shk_boxes_area_check
        check (area in ('Сортировка', 'Переупаковка', 'ХАБ', 'Маркетплейс'));

alter table public.wms_no_shk_boxes
    add column outside_opp boolean not null default false,
    add column total_items integer not null default 0,
    add column contributor_counts jsonb not null default '{}'::jsonb;

-- At most one "currently forming" box per area+shift at a time.
create unique index wms_no_shk_boxes_forming_idx
    on public.wms_no_shk_boxes (area, shift_date, shift_type)
    where outside_opp;

-- Atomic find-or-create + increment + responsible-person recompute for
-- one item logged from the public intake form. security definer so the
-- anonymous intake-form client never needs SELECT on intake_submissions
-- (which stays insert-only) to get a live count -- this function only
-- ever touches wms_no_shk_boxes, which already grants anon full access
-- (see wms_no_shk_boxes_all policy, "for all using (true)").
create or replace function public.wms_no_shk_box_log_item(
    p_area text,
    p_shift_date date,
    p_shift_type text,
    p_full_name text
) returns table (box_id uuid, total_items integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    insert into public.wms_no_shk_boxes (area, shift_date, shift_type, box_type, responsible_name, outside_opp)
    values (p_area, p_shift_date, p_shift_type, 'Короб', p_full_name, true)
    on conflict (area, shift_date, shift_type) where outside_opp
    do nothing;

    select b.id into v_id
    from public.wms_no_shk_boxes b
    where b.area = p_area and b.shift_date = p_shift_date and b.shift_type = p_shift_type and b.outside_opp
    limit 1;

    update public.wms_no_shk_boxes b
    set contributor_counts = jsonb_set(
            b.contributor_counts,
            array[p_full_name],
            to_jsonb(coalesce((b.contributor_counts ->> p_full_name)::integer, 0) + 1)
        ),
        total_items = b.total_items + 1
    where b.id = v_id;

    update public.wms_no_shk_boxes b
    set responsible_name = sub.name
    from (
        select key as name
        from public.wms_no_shk_boxes b2, jsonb_each_text(b2.contributor_counts)
        where b2.id = v_id
        order by value::integer desc
        limit 1
    ) sub
    where b.id = v_id;

    return query select b.id, b.total_items from public.wms_no_shk_boxes b where b.id = v_id;
end;
$$;

grant execute on function public.wms_no_shk_box_log_item(text, date, text, text) to anon;
