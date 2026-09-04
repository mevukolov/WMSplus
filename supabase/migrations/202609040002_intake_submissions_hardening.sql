-- 202609040002_intake_submissions_hardening.sql
-- Hardening found in final review: intake_submissions is insert-only for
-- anon with `with check (true)` and had no length/range bounds, on a
-- Supabase project shared with the main WMS+ app -- an unbounded
-- item_text or a garbage employee_id costs shared storage/DB quota, not
-- just this feature's own data. Also revoke the default anon grants RLS
-- currently masks (SELECT/UPDATE/DELETE/etc.) as defense-in-depth -- RLS
-- is the only thing stopping them today, and this repo has a precedent
-- of RLS being disabled elsewhere
-- (202603240002_opp_reports_cache_disable_rls.sql). INSERT is
-- deliberately left untouched -- that's the one thing this table is for.
alter table public.intake_submissions
    add constraint intake_submissions_item_text_length
        check (char_length(item_text) between 1 and 2000);

alter table public.intake_submissions
    add constraint intake_submissions_employee_id_positive
        check (employee_id > 0);

revoke select, update, delete, truncate, references, trigger
    on public.intake_submissions from anon;
