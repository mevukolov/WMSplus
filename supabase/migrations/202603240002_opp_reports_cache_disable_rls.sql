alter table if exists public.opp_reports_cache disable row level security;

drop policy if exists opp_reports_cache_select_all on public.opp_reports_cache;

grant select on public.opp_reports_cache to anon, authenticated;
