-- Бэкофилл журнала wms_upload_coverage_log из истории wms_manual_upload_runs.
-- Без него пустой журнал заставил бы прогу на первом же открытии чекера
-- после этого релиза попросить широченный исторический период по каждому
-- модулю -- хотя всё это уже было выгружено по старому механизму (вывод
-- покрытия из существования задач/окна рана). До ~10.10 выгрузки шли
-- отдельными кнопками на участок (ПМ/Почта, Предсортировка, Маркетплейс+ПЦ,
-- WMI, RWP отдельно от Упаковки) -- общий "В заказе" появился позже,
-- поэтому карта ниже покрывает оба периода. Основание -- живой запрос
-- distinct(source_module, upload_type) по проду перед написанием миграции.
with run_zone_map (source_module, upload_type, target_task_type, source_format) as (
    values
        ('manual_pm_buffer', 'pm_buffer', 'Разбор ОПП // ПМ', 'general'),
        ('manual_pm_buffer', 'pm_buffer', 'Разбор ОПП // Почта', 'general'),
        ('manual_presort_opp', 'presort', 'Разбор ОПП // Предсортировка', 'general'),
        ('manual_marketplace_pc', 'marketplace_pc', 'Разбор ОПП // Маркетплейс', 'general'),
        ('manual_marketplace_pc', 'marketplace_pc', 'Разбор ОПП // ПЦ', 'general'),
        ('manual_wmi_mp_pc', 'wmi_mp_pc', 'Разбор ОПП // WMI (МП + ПЦ)', 'general'),
        ('manual_general_upload', 'general', 'Разбор ОПП // ПМ', 'general'),
        ('manual_general_upload', 'general', 'Разбор ОПП // Почта', 'general'),
        ('manual_general_upload', 'general', 'Разбор ОПП // Предсортировка', 'general'),
        ('manual_general_upload', 'general', 'Разбор ОПП // Маркетплейс', 'general'),
        ('manual_general_upload', 'general', 'Разбор ОПП // ПЦ', 'general'),
        ('manual_general_upload', 'general', 'Разбор ОПП // WMI (МП + ПЦ)', 'general'),
        ('manual_rwp_opp', 'rwp', 'Разбор ОПП // RWP', 'packaging'),
        ('manual_packaging_opp', 'packaging', 'Разбор ОПП // Упаковка', 'packaging'),
        ('manual_no_order', 'no_order', 'Разбор ОПП // Без заказа', 'no_order'),
        ('manual_after_sale_movement', 'after_sale_movement', 'Разбор ОПП // Движение после продажи', 'after_sale_movement')
)
insert into public.wms_upload_coverage_log (business_date, target_task_type, source_format, checked_at)
select distinct
    d.business_date,
    m.target_task_type,
    m.source_format,
    timezone('utc', now())
from public.wms_manual_upload_runs r
join run_zone_map m on m.source_module = r.source_module and m.upload_type = r.upload_type
cross join lateral generate_series(
    coalesce(r.window_start_date, r.effective_date, r.business_date)::timestamp,
    coalesce(r.window_end_date, r.effective_date, r.business_date)::timestamp,
    interval '1 day'
) as d(business_date)
on conflict (business_date, target_task_type) do nothing;
