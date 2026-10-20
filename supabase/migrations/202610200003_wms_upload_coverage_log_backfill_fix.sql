-- Фикс бэкофилла 202610200002: тот бэкофилл применял ОБЩЕЕ окно рана
-- (window_start_date/window_end_date, посчитанное по ВСЕМ попавшим в
-- выгрузку строкам СРАЗУ, напр. 6 разных зон general в одном файле) к
-- КАЖДОЙ зоне формата по отдельности. Если у одной зоны реальные строки
-- были свежее/старше, чем у соседней в том же файле (напр. Маркетплейс
-- с офсетом -5 тянет окно назад дальше, чем у Предсортировки с офсетом
-- -2), её задним числом помечало "проверено" на даты, которых у неё
-- самой в wms_tasks на самом деле нет -- подтверждено живым запросом:
-- "Разбор ОПП // Предсортировка" реально есть только по 17.10
-- включительно, но бэкофилл из-за общего окно рана 13.10-18.10 пометил
-- и 18.10 тоже. Та же блендинг-проблема потенциально у ПМ/Почта
-- (общий ран manual_pm_buffer) и Маркетплейс/ПЦ (manual_marketplace_pc).
-- Источник истины для ИСТОРИЧЕСКОГО бэкофилла -- сам wms_tasks
-- (task_type + upload_effective_date), он уже зона-specific по
-- построению, блендинга нет. Удаляем ровно тот единственный батч
-- бэкофилла (один checked_at на все 620 строк -- после него реальных
-- сохранений ещё не было) и переливаем из wms_tasks.
delete from public.wms_upload_coverage_log
where checked_at = '2026-10-20 07:54:36.194863+00'::timestamptz;

with zone_format_map (target_task_type, source_format) as (
    values
        ('Разбор ОПП // ПМ', 'general'),
        ('Разбор ОПП // Почта', 'general'),
        ('Разбор ОПП // Предсортировка', 'general'),
        ('Разбор ОПП // Маркетплейс', 'general'),
        ('Разбор ОПП // ПЦ', 'general'),
        ('Разбор ОПП // WMI (МП + ПЦ)', 'general'),
        ('Разбор ОПП // RWP', 'packaging'),
        ('Разбор ОПП // Упаковка', 'packaging'),
        ('Разбор ОПП // Без заказа', 'no_order'),
        ('Разбор ОПП // Движение после продажи', 'after_sale_movement')
)
insert into public.wms_upload_coverage_log (business_date, target_task_type, source_format, checked_at)
select distinct
    t.upload_effective_date,
    t.task_type,
    m.source_format,
    timezone('utc', now())
from public.wms_tasks t
join zone_format_map m on m.target_task_type = t.task_type
where t.upload_effective_date is not null
on conflict (business_date, target_task_type) do nothing;
