-- Daily denominator for the calculation-period loss report.  The value is
-- entered on the next shift opening, after the real sorting total is known.
create table if not exists public.wms_daily_sorting_totals (
  id uuid primary key default gen_random_uuid(),
  wh_id text not null,
  sorting_date date not null,
  amount numeric not null check (amount >= 0),
  comment text not null default '',
  entered_by_id text,
  entered_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (wh_id, sorting_date)
);

create index if not exists wms_daily_sorting_totals_wh_date_idx
  on public.wms_daily_sorting_totals (wh_id, sorting_date desc);

create or replace function public.set_updated_at_wms_daily_sorting_totals()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_wms_daily_sorting_totals on public.wms_daily_sorting_totals;
create trigger trg_set_updated_at_wms_daily_sorting_totals
before update on public.wms_daily_sorting_totals
for each row execute function public.set_updated_at_wms_daily_sorting_totals();

alter table public.wms_daily_sorting_totals enable row level security;

drop policy if exists wms_daily_sorting_totals_authenticated_all on public.wms_daily_sorting_totals;
create policy wms_daily_sorting_totals_authenticated_all on public.wms_daily_sorting_totals
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update on public.wms_daily_sorting_totals to authenticated;
revoke all on public.wms_daily_sorting_totals from anon;

comment on table public.wms_daily_sorting_totals is
  'Actual daily sorting amount used as the denominator in the calculation-period loss report.';
