-- Контур2: параллельная система по согласованному словарю понятий
-- (docs/superpowers/specs/2026-10-02-wms-entity-glossary-design.md).
-- Отдельная схема countour2 -- не трогает public.* (прод) ни единым
-- объектом. Создаём сразу весь набор таблиц, раз словарь согласован целиком.
--
-- Соглашения по всей схеме:
--   * surrogate PK -- uuid default gen_random_uuid(), кроме repo_shk (сам
--     штрихкод уникален сам по себе) и repo_nm (nm уникален сам по себе);
--   * История обработки ШК -- отдельная таблица (не jsonb), чтобы запросы
--     вида "все действия этого сотрудника за смену" не требовали сканировать
--     каждый ШК;
--   * "Задача" не хранит вердикт/сотрудника/время -- только кэш статуса,
--     обновляемый в той же транзакции, что и запись в repo_shk_history.

create schema if not exists countour2;

-- НМ -- справочник товаров
create table countour2.repo_nm (
    nm text primary key,
    name text,
    brand text,
    wb_photo_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- МХ -- место хранения. "Наше" (управляем сами, есть тип/занятость) или
-- "внешнее" (данные только от WB, занятость не администрируем).
create table countour2.repo_mh (
    id uuid primary key default gen_random_uuid(),
    source text not null check (source in ('internal', 'external')),
    kind text,
    capacity integer,
    occupied_count integer,
    external_code text,
    created_at timestamptz not null default now(),
    constraint repo_mh_internal_or_external check (
        (source = 'internal') or (kind is null and capacity is null and occupied_count is null)
    )
);

-- Короб / Тара -- контейнер, хранящий ШК. Состав не хранится здесь --
-- выводится через repo_shk.tara_id.
create table countour2.repo_tara (
    id uuid primary key default gen_random_uuid(),
    mh_id uuid references countour2.repo_mh(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Сотрудник
create table countour2.repo_employee (
    id uuid primary key default gen_random_uuid(),
    full_name text,
    role text,
    created_at timestamptz not null default now()
);

-- Задача -- группировка ШК, без собственного вердикта/сотрудника/времени.
-- status_cache -- денормализованная копия (пишется в той же транзакции,
-- что и repo_shk_history), источник правды всё равно history.
create table countour2.repo_task (
    id uuid primary key default gen_random_uuid(),
    task_type text,
    status_cache text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ШК -- центральная сущность.
create table countour2.repo_shk (
    shk text primary key,
    nm text references countour2.repo_nm(nm),
    movement_status text,
    movement_status_at timestamptz,
    last_wh_id text,
    is_written_off boolean not null default false,
    tara_id uuid references countour2.repo_tara(id),
    mh_id uuid references countour2.repo_mh(id),
    current_task_id uuid references countour2.repo_task(id),
    price numeric,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index repo_shk_tara_id_idx on countour2.repo_shk(tara_id);
create index repo_shk_mh_id_idx on countour2.repo_shk(mh_id);
create index repo_shk_current_task_id_idx on countour2.repo_shk(current_task_id);

-- История обработки ШК -- единственное место, где фиксируется результат
-- НАШЕЙ работы с конкретным ШК. Первая запись может быть "рождение из БШК".
create table countour2.repo_shk_history (
    id uuid primary key default gen_random_uuid(),
    shk text not null references countour2.repo_shk(shk),
    task_id uuid references countour2.repo_task(id),
    verdict text,
    employee_id uuid references countour2.repo_employee(id),
    comment text,
    occurred_at timestamptz not null default now()
);

create index repo_shk_history_shk_idx on countour2.repo_shk_history(shk);
create index repo_shk_history_task_id_idx on countour2.repo_shk_history(task_id);

-- Смена -- временной отрезок + ростер назначенных сотрудников.
create table countour2.repo_shift (
    id uuid primary key default gen_random_uuid(),
    shift_date date,
    wh_id text,
    created_at timestamptz not null default now()
);

create table countour2.repo_shift_roster (
    shift_id uuid not null references countour2.repo_shift(id),
    employee_id uuid not null references countour2.repo_employee(id),
    primary key (shift_id, employee_id)
);

-- БШК -- неидентифицированное фото товара, цель -- слиться с ШК.
create table countour2.repo_bshk (
    id uuid primary key default gen_random_uuid(),
    item_name text,
    category text,
    area text,
    responsible_employee_id uuid references countour2.repo_employee(id),
    captured_at timestamptz not null default now(),
    wb_nm_candidates jsonb,
    wb_nm_checked_at timestamptz,
    assigned_shk text references countour2.repo_shk(shk),
    created_at timestamptz not null default now()
);

create index repo_bshk_assigned_shk_idx on countour2.repo_bshk(assigned_shk);

-- Предложение соответствия -- кандидат на связь БШК <-> ШК/Задача от
-- автопоиска, ДО подтверждения человеком. При confirmed -- появляется
-- запись в repo_shk_history и заполняется repo_bshk.assigned_shk.
create table countour2.repo_match_suggestion (
    id uuid primary key default gen_random_uuid(),
    bshk_id uuid not null references countour2.repo_bshk(id),
    candidate_shk text references countour2.repo_shk(shk),
    candidate_task_id uuid references countour2.repo_task(id),
    confidence numeric,
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    decided_by uuid references countour2.repo_employee(id),
    constraint repo_match_suggestion_one_candidate check (
        (candidate_shk is not null)::int + (candidate_task_id is not null)::int <= 1
    )
);

create index repo_match_suggestion_bshk_id_idx on countour2.repo_match_suggestion(bshk_id);
create index repo_match_suggestion_status_idx on countour2.repo_match_suggestion(status);

-- Инцидент / Ошибка -- привязан к одному ШК.
create table countour2.repo_incident (
    id uuid primary key default gen_random_uuid(),
    shk text references countour2.repo_shk(shk),
    description text,
    occurred_at timestamptz not null default now()
);

-- Два ШК / Пустая упаковка -- одна таблица с дискриминатором (сознательное
-- решение -- не разводить физически то, что сегодня и так живёт в одной
-- таблице в проде). У "Пустой упаковки" shk2/media_2 пустые.
create table countour2.repo_two_shk_event (
    id uuid primary key default gen_random_uuid(),
    event_type text not null check (event_type in ('two_shk', 'empty_pack')),
    shk1 text references countour2.repo_shk(shk),
    shk2 text references countour2.repo_shk(shk),
    media_1 text,
    media_2 text,
    wh_id text,
    occurred_at timestamptz not null default now(),
    constraint repo_two_shk_event_empty_pack_has_no_shk2 check (
        event_type = 'two_shk' or (shk2 is null and media_2 is null)
    )
);
