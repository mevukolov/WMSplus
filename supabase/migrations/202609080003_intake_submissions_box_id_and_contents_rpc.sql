-- Box-contents photo feed: clicking a box in the "Без ШК" zone opens its
-- contents as a photo tape. Matching items to a box purely by
-- (area, shift_date, shift_type) is ambiguous -- a box that already had
-- "Принесено" clicked mid-shift can be followed by a second forming box
-- for the exact same area/shift/date, and a manually-created box shares
-- that same triple's shape without ever having been the one items were
-- actually counted into. box_id is the precise, unambiguous link: it's
-- only ever set by the form's own save flow (via
-- wms_no_shk_box_log_item's returned id), so older rows and
-- manually-created boxes correctly have nothing to show.
alter table public.intake_submissions
    add column box_id uuid references public.wms_no_shk_boxes(id);

-- Read-only counterpart to wms_no_shk_box_log_item: returns just the
-- fields the "Без ШК" zone's content feed needs, so the zone admin UI
-- never needs (and never gets) direct SELECT access to
-- intake_submissions -- consistent with that table staying insert-only
-- for everyone except this narrow, purpose-built read path. Granted to
-- anon on the same basis as every other table/function this admin app
-- already relies on (see wms_no_shk_box_log_item, wms_no_shk_boxes'
-- open policy) -- there is no real auth layer in this system yet, so
-- this matches the existing risk model rather than introducing a new one.
create or replace function public.wms_no_shk_box_contents(p_box_id uuid)
returns table (
    item_text text,
    category text,
    item_type text,
    full_name text,
    created_at timestamptz,
    photo_path text
)
language sql
security definer
set search_path = public
stable
as $$
    select item_text, category, item_type, full_name, created_at, photo_path
    from public.intake_submissions
    where box_id = p_box_id
    order by created_at asc;
$$;

grant execute on function public.wms_no_shk_box_contents(uuid) to anon;
