-- До миграции 202610280007 auto_reopen_wms_tasks() сбрасывал opp_verdict
-- на "Не выбран" для ВСЕХ переоткрытых задач без исключения -- 11 задач,
-- чьим последним реальным вердиктом (по wms_task_history) было
-- "Аннулирование после списания" и которые с тех пор успели
-- переоткрыться, из-за этого потеряли привязку к новой папке в
-- "Задачах" и вернулись в обычный Предразбор. Восстанавливаем им
-- вердикт -- то же условие, что проверялось диагностическим запросом
-- перед применением.
with last_deferred as (
    select distinct on (task_id) task_id, created_at as deferred_at, payload->>'verdict' as verdict
    from public.wms_task_history
    where event_type = 'task_deferred'
    order by task_id, created_at desc
),
last_reopen as (
    select distinct on (task_id) task_id, created_at as reopened_at
    from public.wms_task_history
    where event_type = 'task_auto_reopened'
    order by task_id, created_at desc
)
update public.wms_tasks t
set opp_verdict = 'Аннулирование после списания',
    updated_at = timezone('utc', now())
from last_deferred ld, last_reopen lr
where ld.task_id = t.id
  and ld.verdict = 'Аннулирование после списания'
  and lr.task_id = t.id
  and lr.reopened_at > ld.deferred_at
  and t.task_status = 'Не начато'
  and t.opp_verdict <> 'Аннулирование после списания'
  and t.is_deleted = false;
