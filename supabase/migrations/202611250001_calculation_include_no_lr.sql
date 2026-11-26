-- Calculation-period numerator includes both LR and no-LR write-offs.  The
-- Counterparty ID eligibility flag remains mandatory.
drop index if exists public.pure_losses_rep_calculation_counterparty_idx;

create index if not exists pure_losses_rep_calculation_counterparty_idx
  on public.pure_losses_rep (wh_id, date_lost)
  include (shk, log_object_amount)
  where log_object_amount is not null
    and is_calculation_counterparty is true;

create or replace function public.wms_calculation_period_daily_report(
  p_wh_id text, p_start date, p_end date
)
returns table (
  report_date date, gross_amount numeric, resolved_amount numeric, net_amount numeric,
  sorting_amount numeric, source_rows integer, allocation_rows integer
)
language sql stable security invoker set search_path = public
as $$
  with days as (
    select generate_series(p_start, p_end, interval '1 day')::date as report_date
  ), source_rows as (
    select p.date_lost as report_date_text, p.shk, p.log_object_amount
    from public.pure_losses_rep p
    where p.wh_id = p_wh_id
      and p.is_calculation_counterparty is true
      and p.date_lost >= p_start::text and p.date_lost <= p_end::text
  ), coverage as (
    select report_date_text, count(*)::integer as source_rows, count(log_object_amount)::integer as allocation_rows
    from source_rows group by report_date_text
  ), ledger as (
    select report_date_text, shk, sum(log_object_amount) as amount
    from source_rows where log_object_amount is not null group by report_date_text, shk
  ), gross as (
    select report_date_text, sum(amount) as gross_amount from ledger group by report_date_text
  ), resolved_keys as (
    select distinct ti.zone_payload ->> 'pure_losses_date_lost' as report_date_text, ti.shk
    from public.wms_task_items ti
    where ti.task_type = 'Чистые списания' and ti.opp_verdict = 'Найден/Релиз/Списан'
      and ti.zone_payload ->> 'pure_losses_date_lost' >= p_start::text
      and ti.zone_payload ->> 'pure_losses_date_lost' <= p_end::text
  ), resolved as (
    select l.report_date_text, sum(l.amount) as resolved_amount
    from ledger l join resolved_keys r using (report_date_text, shk) group by l.report_date_text
  ), sorting as (
    select sorting_date as report_date, sum(amount) as sorting_amount
    from public.wms_daily_sorting_totals
    where wh_id = p_wh_id and sorting_date >= p_start and sorting_date <= p_end
    group by sorting_date
  )
  select d.report_date, coalesce(g.gross_amount,0), coalesce(r.resolved_amount,0),
    greatest(coalesce(g.gross_amount,0)-coalesce(r.resolved_amount,0),0::numeric),
    s.sorting_amount, coalesce(c.source_rows,0), coalesce(c.allocation_rows,0)
  from days d
  left join coverage c on c.report_date_text = d.report_date::text
  left join gross g on g.report_date_text = d.report_date::text
  left join resolved r on r.report_date_text = d.report_date::text
  left join sorting s using (report_date)
  order by d.report_date;
$$;
