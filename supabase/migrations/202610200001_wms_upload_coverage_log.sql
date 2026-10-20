-- Журнал покрытия выгрузок: какие зоны (target_task_type) реально были
-- запрошены у WB за какую бизнес-дату, независимо от того, появились ли
-- по ним строки в файле. До этой миграции "день закрыт?" выводился из
-- существования wms_tasks (task_type + upload_effective_date) или из
-- окна рана -- оба способа ломались в день, когда по зоне физически
-- не было зависшего товара (0 строк != "не проверено"), что и было
-- причиной всей сегодняшней серии багов с календарём "В заказе".
-- Теперь запись делается по окну, которое сама прога показала оператору
-- (uploadWindowForModule) в момент сохранения -- факт запроса периода,
-- а не факт появления строки.
create table if not exists public.wms_upload_coverage_log (
    business_date date not null,
    target_task_type text not null,
    source_format text not null,
    checked_at timestamptz not null default timezone('utc', now()),
    primary key (business_date, target_task_type)
);

create index if not exists wms_upload_coverage_log_format_idx
    on public.wms_upload_coverage_log (source_format, business_date);

comment on table public.wms_upload_coverage_log is
    'Журнал: какие зоны (target_task_type) были реально запрошены у WB за какую бизнес-дату -- заполняется при сохранении выгрузки по показанному оператору окну (uploadWindowForModule), а не по факту появления строк в файле. Источник правды для dayCoveredForModule вместо вывода из существования wms_tasks.';
