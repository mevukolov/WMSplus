-- "Получить коробку" открывает карточку каждого товара тем же
-- window.__openIntakeSubmissionCard, что и "Лента без ШК" -- она читает
-- item.wb_nm_candidates/wb_nm_checked_at, чтобы показать "Вероятные
-- номенклатуры". wms_no_shk_box_contents никогда не отдавал ни ту, ни
-- другую колонку, поэтому карточка всегда показывала "проверяется…" и
-- никогда не переставала, независимо от того, отработал ли уже
-- wb-photo-match Edge Function для этого фото.
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
    sticker_code text,
    wb_nm_candidates jsonb,
    wb_nm_checked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, created_at, photo_path, sticker_code,
           wb_nm_candidates, wb_nm_checked_at
    from public.intake_submissions
    where box_id = p_box_id
    order by created_at asc;
$$;

grant execute on function public.wms_no_shk_box_contents(uuid) to anon;
