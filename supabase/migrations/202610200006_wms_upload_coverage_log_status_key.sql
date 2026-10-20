-- Журнал покрытия на статусный ключ (этап 3 спеки
-- 2026-10-20-wms-status-dictionary-design.md). Заменяет ключ
-- (business_date, target_task_type, source_format), введённый
-- миграцией 202610200001, на (business_date, source_format,
-- status_code, rule_key) -- единица учёта теперь статус (и его
-- правило, если их у статуса несколько -- см. спеку, "Вариант 2").
-- Таблица создана сегодня же (202610200001-3), ещё не накопила
-- значимой истории сверх бэкофилла -- пересоздаём, а не alter'им.
drop table public.wms_upload_coverage_log;

create table public.wms_upload_coverage_log (
    business_date date not null,
    source_format text not null,
    status_code text not null,
    rule_key text not null,
    checked_at timestamptz not null default timezone('utc', now()),
    primary key (business_date, source_format, status_code, rule_key)
);

create index wms_upload_coverage_log_status_idx
    on public.wms_upload_coverage_log (source_format, status_code, business_date);

comment on table public.wms_upload_coverage_log is
    'Журнал: какой статус (и, если их несколько у статуса, какое именно правило -- rule_key, иначе ''__default__'') был реально запрошен у WB за бизнес-дату. Заполняется при сохранении выгрузки по показанному оператору окну, не по факту появления строк. См. docs/superpowers/specs/2026-10-20-wms-status-dictionary-design.md.';
