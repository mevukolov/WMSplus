-- Поиск "Без ШК" (search.html) теперь matчит ещё и по названию/бренду,
-- которые wb-photo-match подобрал по фото (wb_nm_candidates) -- через
-- джойн с wms_nm_directory (202609300005). item_text/category/item_type
-- остаются первым и самым точным путём совпадения; директория -- запасной,
-- когда оператор ещё не успел вписать нормальное наименование, а WB уже
-- предположил, что это за товар.
--
-- matched_nm_name/matched_nm_brand возвращаются только когда совпадение
-- пришло именно через директорию (не через item_text/category/item_type),
-- чтобы фронт мог показать "Похоже: <name> · <brand>" только когда это
-- реально объясняет, почему результат попал в выдачу.
drop function if exists public.wms_search_no_shk_items(text, date);

create function public.wms_search_no_shk_items(
    p_query text default null,
    p_date date default null
)
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
    matched_nm_name text,
    matched_nm_brand text
)
language sql
security definer
set search_path = public
stable
as $$
    with q as (
        select nullif('%' || regexp_replace(regexp_replace(trim(coalesce(p_query, '')), '[%_]', ' ', 'g'), '\s+', ' ', 'g') || '%', '%%') as pattern
    ),
    -- distinct on: a submission can carry several candidate nm's, more
    -- than one of which might match the query (e.g. same brand on two
    -- guesses) -- without this, the left join below would duplicate that
    -- submission once per matching candidate. q is referenced as a scalar
    -- subquery (always exactly one row) rather than joined in, so mixing
    -- it into this FROM list can't trip over comma/JOIN precedence with
    -- the lateral jsonb_array_elements_text below.
    nm_hit as (
        select distinct on (s.id) s.id, d.name, d.brand
        from public.intake_submissions s
        cross join lateral jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) as cand(nm)
        join public.wms_nm_directory d on d.nm = cand.nm
        where (select pattern from q) is not null
          and (d.name ilike (select pattern from q) or d.brand ilike (select pattern from q))
        order by s.id, d.updated_at desc
    )
    select s.id, s.item_text, s.category, s.item_type, s.area, s.full_name,
           s.created_at, s.photo_path, s.sticker_code,
           nm_hit.name, nm_hit.brand
    from public.intake_submissions s
    left join nm_hit on nm_hit.id = s.id
    where (p_date is null or s.shift_date = p_date)
      and (
          (select pattern from q) is null
          or s.item_text ilike (select pattern from q)
          or s.category ilike (select pattern from q)
          or s.item_type ilike (select pattern from q)
          or nm_hit.id is not null
      )
    order by s.created_at desc;
$$;

grant execute on function public.wms_search_no_shk_items(text, date) to authenticated;
