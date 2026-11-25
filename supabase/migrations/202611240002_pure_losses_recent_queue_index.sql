-- «Чистые списания» теперь сначала показывает только текущий и прошлый
-- календарные месяцы, а архив загружает отдельно. Индекс соответствует
-- рабочему фильтру: активные item-строки зоны и дата из zone_payload.
-- Это исключает полное чтение исторической очереди при каждом открытии
-- вкладки.
create index if not exists wms_task_items_pure_losses_active_date_idx
  on public.wms_task_items ((zone_payload ->> 'pure_losses_date_lost'))
  where task_type = 'Чистые списания'
    and task_status <> 'Завершено';
