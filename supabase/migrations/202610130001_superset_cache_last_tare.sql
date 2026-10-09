-- Фаза 1 движка правил маршрутизации
-- (docs/superpowers/specs/2026-10-12-wms-routing-rules-phase1-design.md):
-- last_tare уже парсится из Superset-файла (normalizeSupersetRow в
-- tasks.js), но нигде не сохранялся -- без него "группировать по таре"
-- физически не на чем работать.
alter table public.wms_superset_cache add column last_tare text;
