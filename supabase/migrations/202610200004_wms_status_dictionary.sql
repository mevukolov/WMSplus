-- Словарь статусов (спека 2026-10-20-wms-status-dictionary-design.md):
-- единая таблица (отчёт, статус) -> название/срок списания/срок
-- разбора по умолчанию/участок по умолчанию -- поглощает
-- wms_writeoff_terms и JS-хардкод фоллбэк классификации (этап 2),
-- становится источником обязательных статусов для журнала покрытия
-- (этап 3). status_code = '*' -- зарезервированное значение для
-- catch-all строки формата (правила вида "всё, что не поймали
-- остальные", см. спеку, раздел "Уточнение").
create table public.wms_status_dictionary (
    id uuid primary key default gen_random_uuid(),
    source_format text not null,
    status_code text not null,
    label text not null default '',
    writeoff_days integer,
    default_upload_offset_days integer not null default 0,
    default_task_type text,
    is_required_for_coverage boolean not null default true,
    is_active boolean not null default true,
    sort_order integer not null default 999,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (source_format, status_code)
);

alter table public.wms_status_dictionary
    add constraint wms_status_dictionary_source_format_check
    check (source_format in ('general', 'packaging', 'after_sale_movement', 'no_order'));

create index wms_status_dictionary_format_active_idx
    on public.wms_status_dictionary (source_format, is_active);

comment on table public.wms_status_dictionary is
    'Словарь статусов: единая точка правды (отчёт, статус) -> название/срок списания/срок разбора по умолчанию/участок по умолчанию. status_code=''*'' -- catch-all строка формата (ловит статусы, не перечисленные явно). См. docs/superpowers/specs/2026-10-20-wms-status-dictionary-design.md.';
