-- Цена в журнале нарушений — неизменяемый снимок цены задачи на момент,
-- когда оператор зафиксировал нарушение. Не пересчитываем её из задачи в
-- интерфейсе: сама задача и её цена могут быть актуализированы позднее.
alter table public.wms_violations
    add column if not exists task_price numeric(14, 2) not null default 0;

comment on column public.wms_violations.task_price is
    'Стоимость задачи на момент фиксации нарушения, рубли';

-- Заполняем историю там, где нарушение связано с обычной задачей.
update public.wms_violations as violation
set task_price = round(coalesce(task.source_price_sum, 0)::numeric, 2)
from public.wms_tasks as task
where violation.task_price = 0
  and violation.task_id = task.id::text;

-- Для нарушений из «Чистых списаний» исходная цена находится на позиции,
-- а не на родительской задаче. Это также безопасно заполняет старые записи
-- с одним ШК; составные ШК остаются с нулём, если точного соответствия нет.
update public.wms_violations as violation
set task_price = round(coalesce(item.price, 0)::numeric, 2)
from public.wms_task_items as item
where violation.task_price = 0
  and violation.task_id = item.task_id::text
  and violation.shk = item.shk;

create index if not exists wms_violations_task_price_idx
    on public.wms_violations (task_price);
