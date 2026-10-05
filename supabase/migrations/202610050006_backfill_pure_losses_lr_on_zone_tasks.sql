-- Задним числом проставляем pure_losses_lr/pure_losses_date_lost на
-- 3902 задачи зоны "Чистые списания", перенесённые миграцией
-- 202610050004 -- тогда эта RPC ещё не хранила lr/date_lost (добавлено
-- в 202610050005). Каждая задача зоны имеет ровно один ШК
-- (source_shk_ids[1]) -- джойним к pure_losses_rep напрямую по нему.
update public.wms_tasks t
set source_payload = jsonb_set(
    jsonb_set(
        coalesce(t.source_payload, '{}'::jsonb),
        '{pure_losses_lr}',
        to_jsonb(p.lr)
    ),
    '{pure_losses_date_lost}',
    to_jsonb(case when p.date_lost ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then p.date_lost else null end)
)
from (
    select distinct on (shk) shk, lr, date_lost
    from public.pure_losses_rep
    order by shk, date_lost desc
) p
where t.task_type = 'Чистые списания'
  and t.is_deleted = false
  and array_length(t.source_shk_ids, 1) = 1
  and t.source_shk_ids[1] = p.shk
  and not (t.source_payload ? 'pure_losses_lr');
