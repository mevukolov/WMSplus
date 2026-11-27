create table public.wms_actualization_settings (
    wh_id text primary key,
    settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
    updated_at timestamptz not null default now()
);

insert into public.wms_actualization_settings (wh_id) values ('50144199');

create function public.wms_can_manage_actualization()
returns boolean
language sql stable security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.users
        where auth_uid = auth.uid() and id::text = '1034305'
    );
$$;

revoke all on function public.wms_can_manage_actualization() from public;
grant execute on function public.wms_can_manage_actualization() to authenticated;
revoke all on public.wms_actualization_settings from public, anon, authenticated;
grant select, update on public.wms_actualization_settings to authenticated;
grant all on public.wms_actualization_settings to service_role;

alter table public.wms_actualization_settings enable row level security;
create policy wms_actualization_settings_read on public.wms_actualization_settings
    for select to authenticated using (wh_id = '50144199');
create policy wms_actualization_settings_manage on public.wms_actualization_settings
    for update to authenticated
    using (wh_id = '50144199' and public.wms_can_manage_actualization())
    with check (wh_id = '50144199' and public.wms_can_manage_actualization());

alter table public.wms_routing_rules
    add column is_upload_fallback boolean not null default false,
    add constraint wms_routing_rules_only_zone_fallback
        check (not is_upload_fallback or output_key = 'zone');

-- Mark only the known catch-all rules. Keep their conditions for the
-- existing-task routing functions, which do not read is_upload_fallback.
with known_fallbacks as (
    select distinct on (source_format) id
    from public.wms_routing_rules
    where is_active and output_key = 'zone'
      and jsonb_array_length(conditions) = 1
      and conditions->0->>'attribute' = 'status'
      and conditions->0->>'operator' = 'not_contains'
      and (
          (source_format = 'packaging'
            and target_task_type in ('Упаковка', 'Разбор ОПП // Упаковка')
            and conditions->0->>'value' = 'RWP')
          or (source_format = 'no_order'
            and target_task_type in ('Без заказа', 'Разбор ОПП // Без заказа')
            and conditions->0->>'value' = '__никогда_не_встретится__')
          or (source_format = 'after_sale_movement'
            and target_task_type in ('Движение после продажи', 'Разбор ОПП // Движение после продажи')
            and conditions->0->>'value' = '__никогда_не_встретится__')
      )
    order by source_format, priority
)
update public.wms_routing_rules r set is_upload_fallback = true
from known_fallbacks f where r.id = f.id;

create unique index wms_routing_rules_active_upload_fallback
    on public.wms_routing_rules (source_format)
    where is_active and is_upload_fallback;

create or replace function public.wms_evaluate_rule_batch(
    p_output_key text, p_source_format text, p_rows jsonb
)
returns jsonb
language sql stable security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'row_id', row_data.value->>'row_id',
        'rule_id', matched.id,
        'rule_name', matched.name,
        'output_value', case when matched.id is not null then jsonb_build_object(
            'target_task_type', matched.target_task_type,
            'force_tare_grouping', matched.force_tare_grouping,
            'force_high_priority', matched.force_high_priority,
            'tags', to_jsonb(matched.tags),
            'task_deadline_days', matched.task_deadline_days,
            'upload_offset_days', matched.upload_offset_days
        ) end
    ) order by row_data.ordinality), '[]'::jsonb)
    from jsonb_array_elements(p_rows) with ordinality as row_data(value, ordinality)
    left join lateral (
        select r.*
        from public.wms_routing_rules r
        where r.is_active and r.output_key = p_output_key and r.source_format = p_source_format
          and (r.is_upload_fallback or public.wms_rule_conditions_match(r.conditions, row_data.value - 'row_id'))
        order by r.is_upload_fallback, r.priority
        limit 1
    ) matched on true;
$$;
