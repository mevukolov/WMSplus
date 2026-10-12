-- Участки разбора (REVIEW_SECTIONS в tasks.js) -- сегодня захардкожены
-- в коде, пользователь хочет управлять ими из интерфейса. Таблица --
-- просто список имён с порядком и флагом активности; код продолжает
-- иметь захардкоженный дефолт на случай пустой таблицы/офлайна (см.
-- activeReviewZones() в tasks.js) -- эта таблица не единственный
-- источник истины, а опциональная надстройка над ним.
create table public.wms_review_zones (
    name text primary key,
    sort_order integer not null,
    is_active boolean not null default true,
    updated_at timestamptz not null default timezone('utc', now())
);

grant select, insert, update, delete on public.wms_review_zones to anon, authenticated;

insert into public.wms_review_zones (name, sort_order) values
    ('Упаковка', 1), ('RWP', 2), ('ПМ', 3), ('Почта', 4),
    ('Предсортировка', 5), ('Маркетплейс', 6), ('ПЦ', 7),
    ('WMI (МП + ПЦ)', 8), ('Без заказа', 9),
    ('Движение после продажи', 10), ('Другие задачи', 11);
