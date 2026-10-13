-- wms_task_items (миграция 202610090001, 9 октября) зеркалит
-- wms_tasks.source_payload.task_items через триггер на INSERT/UPDATE
-- source_payload. task_status/task_type/opp_verdict добавились
-- только на следующий день (202610100001) -- и ни разу не
-- бэкфиллились. Задачи, созданные до 9-10 октября и ни разу не
-- тронутые повторной выгрузкой с тех пор, физически имеют строку в
-- wms_task_items (та же версия триггера её завела), но с
-- task_status = null -- что для всех проверок "<> 'Завершено'"
-- означает "не активна". Проверка живыми данными: 4552 из 6142
-- активных ШК (74%) были физически невидимы для всего механизма
-- переклассификации (и автоматического, и ручного Sweep) именно по
-- этой причине.
--
-- Бэкфилл -- простановка task_status/task_type/opp_verdict из
-- текущего состояния родителя для строк, где они ещё null. Если тот
-- же ШК уже реально активен под ДРУГОЙ (более новой) задачей --
-- пропускаем: это настоящий дубль одного и того же ШК в двух
-- задачах, который глобальный уникальный индекс
-- wms_task_items_shk_active_unique и так не даст сделать активным
-- дважды -- разбирать такие случаи отдельно, не задача этой
-- миграции (подтверждено живым прогоном: 50 из 4552 остаются
-- нетронутыми именно по этой причине).
update public.wms_task_items ti
set task_status = t.task_status,
    task_type = coalesce(ti.task_type, t.task_type),
    opp_verdict = coalesce(ti.opp_verdict, t.opp_verdict),
    updated_at = timezone('utc', now())
from public.wms_tasks t
where ti.task_id = t.id
  and ti.task_status is null
  and t.is_deleted = false
  and t.task_status <> 'Завершено'
  and ti.shk = any(t.source_shk_ids)
  and not exists (
      select 1 from public.wms_task_items other
      where other.shk = ti.shk
        and other.id <> ti.id
        and other.task_status <> 'Завершено'
  );
