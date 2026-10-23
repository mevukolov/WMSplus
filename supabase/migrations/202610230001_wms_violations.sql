-- Нарушения: лог складских ошибок, заполняется оператором после
-- сохранения ЛЮБОГО вердикта задачи (completeTaskFromDetail /
-- completePureLossesItemFromDetail в tasks.js). Денормализованный лог,
-- без FK на wms_tasks/wms_task_items -- тот же принцип, что у
-- wms_task_history/wms_upload_coverage_log: пишем снэпшот на момент
-- события, а не ссылку, которая может протухнуть при удалении/смене
-- задачи. task_id хранится как текст, т.к. "Чистые списания" сегодня
-- используют составной id (task_id+shk), не сам wms_tasks.id.
create table public.wms_violation_types (
    label text primary key,
    sort_order integer not null,
    is_active boolean not null default true,
    updated_at timestamptz not null default timezone('utc', now())
);

grant select, insert, update, delete on public.wms_violation_types to anon, authenticated;

create table public.wms_violations (
    id uuid primary key default gen_random_uuid(),
    task_id text,
    shk text,
    task_type text,
    zone text not null,
    violation_type text not null,
    verdict text,
    culprit_employee_id text,
    culprit_name text,
    comment text,
    logged_by_id text,
    logged_by_name text,
    created_at timestamptz not null default timezone('utc', now())
);

create index wms_violations_created_at_idx on public.wms_violations (created_at);
create index wms_violations_zone_idx on public.wms_violations (zone);
create index wms_violations_violation_type_idx on public.wms_violations (violation_type);
create index wms_violations_culprit_employee_id_idx on public.wms_violations (culprit_employee_id);

grant select, insert, update, delete on public.wms_violations to anon, authenticated;

insert into public.wms_violation_types (label, sort_order) values
    ('Товар не найден на месте', 1),
    ('Неверная сборка/комплектация', 2),
    ('Повреждение товара', 3),
    ('Потеря ШК при перемещении', 4),
    ('Ошибка сортировки по участку', 5),
    ('Прочее', 100);
