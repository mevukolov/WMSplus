-- Общий справочник "артикул WB (nm) -> название + бренд", не привязанный
-- к конкретной задаче -- в отличие от wms_tasks.source_payload.nm_by_shk/
-- name_by_shk (per-task, см. enrichTaskNomenclatureFromSuperset в
-- tasks.js), это глобальный кэш, из которого может читать любая часть
-- системы: для начала -- поиск "Без ШК" (следующая миграция), в
-- перспективе -- более умный матчинг фото<->задача по имени/бренду, а не
-- только по точному nm.
--
-- Два источника заполнения:
--  1. Актуализация (Superset-выгрузка, tasks.js::syncNmDirectoryFromSuperset)
--     -- она уже несёт nm/name/brand на каждый ШК склада, бесплатно, без
--     единого похода к WB.
--  2. wb-photo-match Edge Function -- для nm, которых в Superset никогда
--     не будет (кандидаты с фото без ШК, ещё не привязанные ни к одной
--     задаче), через тот же card.wb.ru, что уже использует wb-card-lookup.
create table if not exists public.wms_nm_directory (
    nm text primary key,
    name text,
    brand text,
    source text not null default 'wb',
    updated_at timestamptz not null default now()
);

-- Батч-апсерт для клиента: актуализация пишет с ролью authenticated,
-- напрямую в таблицу не пускаем -- та же дисциплина, что у остальных
-- write-путей этого приложения (RPC вместо прямых грантов на таблицу).
-- COALESCE на update: если один источник прислал только name (или только
-- brand), не затираем то, что уже знает другой источник про то же nm.
create or replace function public.wms_nm_directory_upsert_batch(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    insert into public.wms_nm_directory (nm, name, brand, source, updated_at)
    select nullif(trim(r->>'nm'), ''),
           nullif(trim(r->>'name'), ''),
           nullif(trim(r->>'brand'), ''),
           coalesce(nullif(trim(r->>'source'), ''), 'superset'),
           now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
    where nullif(trim(r->>'nm'), '') is not null
      and (nullif(trim(r->>'name'), '') is not null or nullif(trim(r->>'brand'), '') is not null)
    on conflict (nm) do update
        set name = coalesce(excluded.name, wms_nm_directory.name),
            brand = coalesce(excluded.brand, wms_nm_directory.brand),
            source = excluded.source,
            updated_at = excluded.updated_at;
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

grant execute on function public.wms_nm_directory_upsert_batch(jsonb) to authenticated;
