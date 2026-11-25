-- Filling the newly introduced calculation-period amount must not issue one
-- REST PATCH per historical row when an operator re-uploads a large file.
-- Accept a small JSON batch and update only records that still have no value.
create or replace function public.wms_pure_losses_fill_log_object_amount(
  p_rows jsonb
)
returns integer
language sql
security invoker
set search_path = public
as $$
  with incoming as (
    select
      (row_data ->> 'id')::bigint as id,
      (row_data ->> 'log_object_amount')::numeric as log_object_amount
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row_data
    where row_data ? 'id'
      and row_data ? 'log_object_amount'
  ),
  updated as (
    update public.pure_losses_rep target
    set log_object_amount = incoming.log_object_amount
    from incoming
    where target.id = incoming.id
      and target.log_object_amount is null
    returning target.id
  )
  select count(*)::integer from updated;
$$;

grant execute on function public.wms_pure_losses_fill_log_object_amount(jsonb) to authenticated;
