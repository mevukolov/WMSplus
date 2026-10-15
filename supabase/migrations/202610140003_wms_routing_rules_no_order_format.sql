-- Исправление найденной после деплоя ошибки: "Без заказа" нельзя
-- классифицировать по статусу строки вместе с остальными general-
-- участками. "Без заказа"-принадлежность определяется ВНЕШНЕ (какой
-- фильтр выбрали при экспорте из WB), её нет в самих данных строки --
-- проверено на реальных задачах: статусы WMI/PSR/SMS/PAP/GWS/SPS/SWT/
-- SMC/PWT у "Без заказа" ПОЛНОСТЬЮ пересекаются со статусами, которые
-- are позитивными признаками Предсортировки/Маркетплейса/ПЦ/WMI/ПМ.
-- Объединение в общий source_format='general' увело бы ~37% строк не
-- в ту зону. "Без заказа" возвращается отдельной кнопкой/source_format,
-- но остаётся на движке правил (USD/TMM-разделение + фильтры).
alter table public.wms_routing_rules
    drop constraint if exists wms_routing_rules_source_format_check;
alter table public.wms_routing_rules
    add constraint wms_routing_rules_source_format_check
    check (source_format in ('general', 'packaging', 'after_sale_movement', 'no_order'));

update public.wms_routing_rules
set source_format = 'no_order', updated_at = now()
where from_zone = 'Разбор ОПП // Без заказа';
