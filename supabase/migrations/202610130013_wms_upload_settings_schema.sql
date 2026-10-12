-- Фаза 2b, подпроект 1 (движок настроек): wms_routing_rules (Фаза 1)
-- расширяется до универсального условного движка -- не только зона,
-- любой тип решения (output_key), с единым output_value вместо
-- жёстко зашитых target_task_type/grouping_attribute. Старые колонки
-- НЕ удаляются -- на них по-прежнему завязан уже работающий в проде
-- код Фазы 1/2a (wms_apply_routing_rules, wms_compute_reroute_target),
-- который в этом подпроекте не меняется по существу (фикс см.
-- 202610130016).

-- target_task_type было NOT NULL (единственный output Фазы 1) --
-- теперь не каждое правило обязано его иметь (например
-- priority_tier-правило его не использует вообще).
alter table public.wms_routing_rules alter column target_task_type drop not null;

alter table public.wms_routing_rules
    add column if not exists output_key text not null default 'zone',
    add column if not exists output_value jsonb;

-- Бэкофилл: все существующие правила Фазы 1 -- это zone-правила;
-- переносим их target_task_type/grouping_attribute в output_value.
update public.wms_routing_rules
set output_value = jsonb_build_object(
    'target_task_type', target_task_type,
    'grouping_attribute', grouping_attribute
)
where output_value is null;

alter table public.wms_routing_rules alter column output_value set not null;

-- Приоритет был глобально уникален -- теперь уникален В ПРЕДЕЛАХ
-- output_key (у разных типов решений независимые очереди правил).
alter table public.wms_routing_rules drop constraint if exists wms_routing_rules_priority_key;
create unique index if not exists wms_routing_rules_output_key_priority_unique
    on public.wms_routing_rules (output_key, priority);

-- Защитная сетка: если для output_key='zone' output_value не
-- передан (устаревшая вкладка браузера, прямой insert в обход
-- актуального JS), выводим его из target_task_type/grouping_attribute
-- автоматически, вместо падения на NOT NULL.
create or replace function public.wms_routing_rules_default_output_value()
returns trigger
language plpgsql
as $$
begin
    if new.output_value is null and new.output_key = 'zone' then
        new.output_value := jsonb_build_object(
            'target_task_type', new.target_task_type,
            'grouping_attribute', new.grouping_attribute
        );
    end if;
    return new;
end;
$$;

drop trigger if exists wms_routing_rules_default_output_value on public.wms_routing_rules;
create trigger wms_routing_rules_default_output_value
    before insert or update on public.wms_routing_rules
    for each row
    execute function public.wms_routing_rules_default_output_value();

-- Нестатичные параметры модуля без условий (due-date сдвиги,
-- cheap-пороги, поле группировки и т.п.) -- заполняются конкретными
-- значениями при подключении каждого модуля в будущих подпроектах,
-- не здесь.
create table public.wms_module_settings (
    module text not null,
    setting_key text not null,
    value jsonb not null,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (module, setting_key)
);

grant select, insert, update, delete on public.wms_module_settings to anon, authenticated;
