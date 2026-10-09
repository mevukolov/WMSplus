-- Разовый бэкофилл: таблица wms_task_items и триггер появились в
-- 202610090001 и с этого момента ловят ВСЕ новые/изменённые строки
-- wms_tasks сами. Эта миграция закрывает историю ДО того момента --
-- все существующие строки (включая завершённые и мягко удалённые,
-- is_deleted = true -- цель Фазы 1 полное зеркало истории, а не только
-- активная выборка).
insert into public.wms_task_items (task_id, shk, nm, name, status, price, mx, movement, row_number, raw)
select
    t.id,
    item->>'shk',
    item->>'nm',
    item->>'name',
    item->>'status',
    nullif(item->>'price', '')::numeric,
    item->>'mx',
    item->>'movement',
    nullif(item->>'row_number', '')::integer,
    item->'raw'
from public.wms_tasks t,
     jsonb_array_elements(coalesce(t.source_payload->'task_items', '[]'::jsonb)) item
where item->>'shk' is not null;
