create table if not exists public.mistakes_rep (
  emp text,
  emp_workplace text,
  mistake text,
  date date,
  shk text,
  emp_logger text,
  logger_comment text,
  date_logged date
);

alter table public.mistakes_rep
  add column if not exists emp text,
  add column if not exists emp_workplace text,
  add column if not exists mistake text,
  add column if not exists date date,
  add column if not exists shk text,
  add column if not exists emp_logger text,
  add column if not exists logger_comment text,
  add column if not exists date_logged date;

create unique index if not exists mistakes_rep_unique_row_idx
  on public.mistakes_rep (emp, emp_workplace, mistake, date, shk, emp_logger, logger_comment, date_logged);

alter table public.mistakes_rep enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mistakes_rep'
      and policyname = 'mistakes_rep_select_all'
  ) then
    create policy mistakes_rep_select_all
      on public.mistakes_rep
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

grant select on public.mistakes_rep to anon, authenticated;
