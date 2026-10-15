-- Removed per user request: "Параметры модулей" was forward-looking
-- groundwork (202610130013) for future per-module settings (price
-- thresholds, due-date offsets, grouping field) -- confirmed nothing
-- reads it. wms_evaluate_rule's sibling wms_module_setting() RPC
-- (202610130015) was never called from the client either. Both dropped;
-- the admin UI (openModuleSettingsModal and friends) removed in the
-- same change.
drop function if exists public.wms_module_setting(text, text);
drop table if exists public.wms_module_settings;
