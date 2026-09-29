-- "Получить коробку" flow (Разбор -> Задачи -> Без ШК): an operator claims
-- the single oldest eligible box (on a shelf or "на полу", 7+ days old),
-- scans its label, works through its contents one item at a time via the
-- existing intake-submission card/sticker-assign flow, then the box is
-- marked fully disassembled.
--
-- Claim/complete themselves are plain UPDATEs from the client (anon already
-- has UPDATE on wms_no_shk_boxes -- see the RLS lockdown's exclusion list)
-- guarded by a WHERE clause the client retries against on conflict; no RPC
-- needed for those. Postgres re-checks a row's WHERE clause after acquiring
-- its UPDATE lock, so two operators racing for the same row is safe without
-- SELECT ... FOR UPDATE: only one UPDATE's WHERE still matches once the
-- first commits.
alter table public.wms_no_shk_boxes
    add column disassembly_started_at timestamptz,
    add column disassembly_started_by text,
    add column disassembled_at timestamptz,
    add column disassembled_by text;

-- Extends the existing box-contents feed with `id` (needed to call
-- wms_intake_assign_sticker from the item's own card) and `area` (so the
-- reused window.__openIntakeSubmissionCard card can render its area pill).
-- CREATE OR REPLACE can't change a RETURNS TABLE shape, so drop + recreate
-- (matches how 202609080005 handled the same constraint) and re-grant.
drop function if exists public.wms_no_shk_box_contents(uuid);

create function public.wms_no_shk_box_contents(p_box_id uuid)
returns table (
    id uuid,
    item_text text,
    category text,
    item_type text,
    area text,
    full_name text,
    created_at timestamptz,
    photo_path text,
    sticker_code text
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, created_at, photo_path, sticker_code
    from public.intake_submissions
    where box_id = p_box_id
    order by created_at asc;
$$;

grant execute on function public.wms_no_shk_box_contents(uuid) to anon;

-- КГТ items never go into a box (see 202609100001's own note), so they
-- can't be counted via box_id -- the "Получить коробку" prompt instead
-- shows how many the box's own responsible logged on the same area/shift
-- while this box was being formed, matched by the same dimensions a box
-- itself is identified by (area, responsible, shift_date, shift_type).
create function public.wms_no_shk_box_kgt_count(p_box_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
    select count(*)::int
    from public.intake_submissions s
    join public.wms_no_shk_boxes b on b.id = p_box_id
    where s.item_type = 'КГТ'
      and s.area = b.area
      and s.full_name = b.responsible_name
      and s.shift_date = b.shift_date
      and s.shift_type = b.shift_type;
$$;

grant execute on function public.wms_no_shk_box_kgt_count(uuid) to anon;
