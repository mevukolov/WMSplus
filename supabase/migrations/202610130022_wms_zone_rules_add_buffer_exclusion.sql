-- Воспроизводит !mxHasBuffer(row), который в хардкоде применяется ко
-- всем GWS/WMI/PWT/PAP/SMC-веткам marketplace_pc одинаково. Правила
-- остаются is_active=false -- эта миграция сама по себе не меняет
-- ничего в проде.
update public.wms_routing_rules
set conditions = conditions || jsonb_build_array(jsonb_build_object('attribute', 'mx', 'operator', 'not_contains', 'value', 'буфер'))
where output_key = 'zone'
  and target_task_type in ('Маркетплейс', 'ПЦ', 'WMI (МП + ПЦ)');
