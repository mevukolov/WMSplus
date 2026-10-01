-- The queue list (wms_no_shk_pending_tasks) trusts the denormalized
-- has_pending_no_shk_match flag rather than scanning no_shk_matches on
-- every query (fine as a perf tradeoff) -- but 202610010006's null-entry
-- cleanup removed entries (including, for some tasks, every remaining
-- pending one) without recomputing the flag, so stale tasks kept
-- appearing in "Быстрая проверка «Без ШК»" with nothing actually pending.
-- Clicking them hit openNoShkMatchModalFresh's own live re-check, which
-- correctly saw no pending match and toasted "Уже неактуально" -- the
-- toast was right, the list that put them there was wrong.
update public.wms_tasks t
set has_pending_no_shk_match = exists (
    select 1
    from jsonb_array_elements(coalesce(t.source_payload->'no_shk_matches', '[]'::jsonb)) m
    where m->>'decision' = 'pending'
)
where has_pending_no_shk_match is distinct from exists (
    select 1
    from jsonb_array_elements(coalesce(t.source_payload->'no_shk_matches', '[]'::jsonb)) m
    where m->>'decision' = 'pending'
);
