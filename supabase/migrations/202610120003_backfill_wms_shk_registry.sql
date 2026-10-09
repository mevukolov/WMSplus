-- Разовый бэкофилл: триггеры из 202610120002 ловят только НОВУЮ
-- активность с этого момента. Эта миграция закрывает всю историю одним
-- проходом -- состав тары не меняется после создания (решение Фазы 2
-- кандидата D), так что текущий состав wms_task_items = состав на любой
-- момент в прошлом для этой задачи.
insert into public.wms_shk (shk, nm, name, current_task_id)
select distinct on (wi.shk)
    wi.shk, wi.nm, wi.name,
    case when wi.task_status <> 'Завершено' then wi.task_id else null end
from public.wms_task_items wi
order by wi.shk, (wi.task_status <> 'Завершено') desc, wi.updated_at desc
on conflict (shk) do nothing;

insert into public.wms_shk_history (shk, task_id, event_type, actor_employee_id, actor_name, payload, created_at)
select wi.shk, h.task_id, h.event_type, h.actor_employee_id, h.actor_name, h.payload, h.created_at
from public.wms_task_history h
join public.wms_task_items wi on wi.task_id = h.task_id
where not exists (
    -- Триггер из 202610120002 уже активен и мог успеть зазеркалить
    -- какие-то строки wms_task_history, вставленные между применением
    -- того шага и этого бэкофилла (прод живой, окно между миграциями не
    -- нулевое) -- без этой проверки такие строки задвоились бы.
    select 1 from public.wms_shk_history sh
    where sh.shk = wi.shk and sh.task_id = h.task_id
      and sh.event_type = h.event_type and sh.created_at = h.created_at
);
