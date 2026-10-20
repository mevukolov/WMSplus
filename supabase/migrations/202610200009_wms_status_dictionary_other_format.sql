-- Расширение словаря на все статусы системы (по просьбе пользователя,
-- после обнаружения ~67 статусов вне 4 форматов выгрузки -- см.
-- комментарий у Task 13 плана и коммит 7704b12). source_format='other'
-- -- статусы, не участвующие ни в одной из 4 выгрузок (Чистые списания
-- и т.п.): нет участка по умолчанию (не маршрутизируются), не
-- обязательны для журнала покрытия (sourceFormatForModule никогда не
-- возвращает 'other' ни для одного реального модуля -- такие строки
-- естественно исключены из dayCoveredForModule/requiredStatusUnitsForModule
-- без доп. кода), существуют только ради срока списания.
alter table public.wms_status_dictionary
    drop constraint wms_status_dictionary_source_format_check;
alter table public.wms_status_dictionary
    add constraint wms_status_dictionary_source_format_check
    check (source_format in ('general', 'packaging', 'after_sale_movement', 'no_order', 'other'));

insert into public.wms_status_dictionary (source_format, status_code, label, writeoff_days, default_task_type, default_upload_offset_days, is_required_for_coverage, is_active)
select
    'other',
    t.term_key,
    coalesce(nullif(t.label, ''), t.term_key),
    t.days_without_movement,
    null,
    0,
    false,
    t.is_active
from public.wms_writeoff_terms t
where t.term_type = 'status'
  and not exists (
      select 1 from public.wms_status_dictionary d
      where d.status_code = t.term_key and d.status_code <> '*'
  )
on conflict (source_format, status_code) do nothing;
