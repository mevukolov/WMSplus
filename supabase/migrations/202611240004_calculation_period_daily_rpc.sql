-- Calculation-period dashboard: aggregate on the database side.  The client
-- receives one compact row per calendar day instead of raw pure-loss records.

-- The source export contains a separate allocation amount for the logistics
-- object.  It is intentionally independent from `price`: the latter remains
-- the full item/task amount used by the Pure Losses work queue.
alter table public.pure_losses_rep
  add column if not exists log_object_amount numeric;

comment on column public.pure_losses_rep.log_object_amount is
  'Allocation from source export column "Часть суммы на лог-объект"; used only by the calculation-period report.';

-- Narrow index for the report source.  Rows without LR or without an
-- allocation are intentionally absent: they do not participate in the
-- calculation-period numerator.
create index if not exists pure_losses_rep_calculation_wh_date_idx
  on public.pure_losses_rep (wh_id, date_lost)
  include (shk, log_object_amount)
  where lr is not null and log_object_amount is not null;

-- A resolved Pure Losses item is matched to its original loss date stored in
-- zone_payload.  The partial index makes the subtraction lookup proportional
-- to resolved items rather than to the whole task-items table.
create index if not exists wms_task_items_pure_resolution_date_shk_idx
  on public.wms_task_items ((zone_payload ->> 'pure_losses_date_lost'), shk)
  where task_type = 'Чистые списания'
    and opp_verdict = 'Найден/Релиз/Списан';

create or replace function public.wms_calculation_period_daily_report(
  p_wh_id text,
  p_start date,
  p_end date
)
returns table (
  report_date date,
  gross_amount numeric,
  resolved_amount numeric,
  net_amount numeric,
  sorting_amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with days as (
    select generate_series(p_start, p_end, interval '1 day')::date as report_date
  ),
  ledger as (
    select
      p.date_lost as report_date_text,
      p.shk,
      sum(p.log_object_amount) as amount
    from public.pure_losses_rep p
    where p.wh_id = p_wh_id
      and p.lr is not null
      and p.log_object_amount is not null
      -- date_lost is text in the historical registry. Comparing its ISO date
      -- representation avoids a table-wide cast and uses the index above.
      and p.date_lost >= p_start::text
      and p.date_lost <= p_end::text
    group by p.date_lost, p.shk
  ),
  gross as (
    select report_date_text, sum(amount) as gross_amount
    from ledger
    group by report_date_text
  ),
  resolved_keys as (
    select distinct
      ti.zone_payload ->> 'pure_losses_date_lost' as report_date_text,
      ti.shk
    from public.wms_task_items ti
    where ti.task_type = 'Чистые списания'
      and ti.opp_verdict = 'Найден/Релиз/Списан'
      and ti.zone_payload ->> 'pure_losses_date_lost' >= p_start::text
      and ti.zone_payload ->> 'pure_losses_date_lost' <= p_end::text
  ),
  resolved as (
    select l.report_date_text, sum(l.amount) as resolved_amount
    from ledger l
    join resolved_keys r using (report_date_text, shk)
    group by l.report_date_text
  ),
  sorting as (
    select s.sorting_date as report_date, sum(s.amount) as sorting_amount
    from public.wms_daily_sorting_totals s
    where s.wh_id = p_wh_id
      and s.sorting_date >= p_start
      and s.sorting_date <= p_end
    group by s.sorting_date
  )
  select
    d.report_date,
    coalesce(g.gross_amount, 0) as gross_amount,
    coalesce(r.resolved_amount, 0) as resolved_amount,
    greatest(coalesce(g.gross_amount, 0) - coalesce(r.resolved_amount, 0), 0::numeric) as net_amount,
    s.sorting_amount
  from days d
  left join gross g on g.report_date_text = d.report_date::text
  left join resolved r on r.report_date_text = d.report_date::text
  left join sorting s using (report_date)
  order by d.report_date;
$$;

grant execute on function public.wms_calculation_period_daily_report(text, date, date) to authenticated;
