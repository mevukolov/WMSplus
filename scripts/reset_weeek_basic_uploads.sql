-- Resets the manual Basic WEEEK upload sandbox.
-- IMPORTANT:
-- 1. This removes rows only from Supabase tables.
-- 2. Already created tasks in WEEEK are NOT deleted by this script.
-- 3. A timestamped backup is created before deletion.

begin;

do $$
declare
  backup_suffix text := to_char(timezone('Europe/Moscow', now()), 'YYYYMMDD_HH24MISS');
  tasks_backup_table text := 'weeek_tasks_basic_backup_' || backup_suffix;
  runs_backup_table text := 'weeek_manual_upload_runs_backup_' || backup_suffix;
begin
  execute format(
    'create table public.%I as
     select *
     from public.weeek_tasks_basic
     where coalesce(source_module, '''') like ''manual_%%''',
    tasks_backup_table
  );

  execute format(
    'create table public.%I as
     select *
     from public.weeek_manual_upload_runs
     where coalesce(source_module, '''') like ''manual_%%''',
    runs_backup_table
  );

  raise notice 'Backup created: public.% and public.%', tasks_backup_table, runs_backup_table;
end $$;

delete from public.weeek_manual_upload_runs
where coalesce(source_module, '') like 'manual_%';

delete from public.weeek_tasks_basic
where coalesce(source_module, '') like 'manual_%';

commit;

select
  'after_reset' as check_name,
  (select count(*) from public.weeek_tasks_basic where coalesce(source_module, '') like 'manual_%') as basic_tasks_left,
  (select count(*) from public.weeek_manual_upload_runs where coalesce(source_module, '') like 'manual_%') as upload_runs_left;
