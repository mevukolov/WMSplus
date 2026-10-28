-- Баг: zone_payload.pure_losses_lr никогда не передавался в
-- wms_pure_losses_absorb_shks из JS (buildPureLossesAbsorbRows в
-- tasks.js/pure_losses.js не включал поле lr) -- починено отдельно в
-- коде. Этой миграцией чиним ТОЛЬКО старые данные: 569 строк
-- wms_task_items с полностью пустым zone_payload ('{}') -- это
-- элементы, перешедшие в зону "Чистые списания" ДО фазового перехода
-- на item-level zone_payload (миграция 202610100003), когда дата/lr
-- писались на wms_tasks.source_payload, а не на wms_task_items.
--
-- Дату можно восстановить из wms_task_history (событие
-- task_moved_to_pure_losses, которое есть у каждой такой строки -- см.
-- диагностику ниже). LR невосстановим: ни у одной из этих строк в
-- истории нет поля lr вообще -- это добавили позже. Такие строки
-- останутся без LR (не попадут ни в одну секцию участка), но хотя бы
-- встанут в правильный месяц вместо "Без даты".
update public.wms_task_items ti
set zone_payload = jsonb_build_object('pure_losses_date_lost', to_char(h.date_lost, 'YYYY-MM-DD')),
    updated_at = timezone('utc', now())
from (
    select distinct on (task_id)
        task_id,
        (payload->>'date_lost')::timestamptz as date_lost
    from public.wms_task_history
    where event_type = 'task_moved_to_pure_losses'
      and payload->>'date_lost' is not null
    order by task_id, created_at desc
) h
where ti.task_id = h.task_id
  and ti.task_type = 'Чистые списания'
  and ti.task_status <> 'Завершено'
  and ti.zone_payload = '{}'::jsonb;
