-- Замена wms_active_tasks_trend (202610290001): та функция реконструировала
-- остаток задним числом по source_generated_at/completed_at -- не
-- совпадало с живым Предразбором (не учитывала исключения Предсписка,
-- АВХ, Коробок на входе, Чистых списаний и т.д. -- reviewGroupedRows в
-- tasks.js применяет их все, упрощённая SQL-реконструкция не могла их
-- точно повторить). Вместо реконструкции -- настоящий снэпшот: клиент
-- сам пишет сюда то же самое reviewGroupedRows(), которое показывает
-- Предразбор, каждый раз когда загружает активные задачи. Цифры за
-- сегодня в графике гарантированно совпадают с тем, что видно в
-- Предразборе, потому что это буквально тот же расчёт.
create table public.wms_active_tasks_daily_snapshot (
    snapshot_date date not null,
    zone text not null,
    active_count integer not null default 0,
    total_price numeric not null default 0,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (snapshot_date, zone)
);

create index wms_active_tasks_daily_snapshot_date_idx on public.wms_active_tasks_daily_snapshot (snapshot_date);

grant select, insert, update, delete on public.wms_active_tasks_daily_snapshot to anon, authenticated;

drop function if exists public.wms_active_tasks_trend(integer);
