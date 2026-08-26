create table if not exists public.opp_alert_settings (
  id bigserial primary key,
  wh_id text not null default '50144199',
  alert_type text not null,
  setting_key text not null,
  setting_value jsonb not null,
  value_type text not null default 'number',
  description text null,
  is_active boolean not null default true,
  updated_by text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint opp_alert_settings_uniq unique (wh_id, alert_type, setting_key)
);

create index if not exists opp_alert_settings_lookup_idx
  on public.opp_alert_settings (wh_id, alert_type, setting_key)
  where is_active = true;

create or replace function public.set_updated_at_opp_alert_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_opp_alert_settings on public.opp_alert_settings;
create trigger trg_set_updated_at_opp_alert_settings
before update on public.opp_alert_settings
for each row
execute function public.set_updated_at_opp_alert_settings();

alter table public.opp_alert_settings disable row level security;

grant select on public.opp_alert_settings to anon, authenticated;
grant all on public.opp_alert_settings to service_role;
grant usage, select on sequence public.opp_alert_settings_id_seq to service_role;

insert into public.opp_alert_settings (wh_id, alert_type, setting_key, setting_value, value_type, description)
values
  ('50144199', 'summary', 'min_total_percent', '70'::jsonb, 'number', 'Красный порог разбора ШК'),
  ('50144199', 'summary', 'warn_total_percent', '85'::jsonb, 'number', 'Желтый порог разбора ШК'),
  ('50144199', 'summary', 'min_sum_percent', '70'::jsonb, 'number', 'Красный порог разбора по сумме'),
  ('50144199', 'summary', 'warn_sum_percent', '85'::jsonb, 'number', 'Желтый порог разбора по сумме'),
  ('50144199', 'summary', 'min_expensive_percent', '70'::jsonb, 'number', 'Красный порог разбора дорогостоя'),
  ('50144199', 'summary', 'warn_expensive_percent', '95'::jsonb, 'number', 'Желтый порог разбора дорогостоя'),
  ('50144199', 'summary', 'low_quality_threshold_percent', '70'::jsonb, 'number', 'Порог низкокачественного разбора'),
  ('50144199', 'summary', 'include_warnings', 'true'::jsonb, 'boolean', 'Показывать предупреждения'),
  ('50144199', 'lag_attention', 'lag_threshold_percent', '30'::jsonb, 'number', 'Порог утреннего отчета по отставанию'),
  ('50144199', 'rush_attention', 'rush_min_total_percent', '70'::jsonb, 'number', 'Порог 17:30 по разбору ШК'),
  ('50144199', 'rush_attention', 'rush_min_expensive_percent', '100'::jsonb, 'number', 'Порог 17:30 по дорогостою'),
  ('50144199', 'weekly_trends', 'trend_min_delta_pp', '10'::jsonb, 'number', 'Минимальное изменение для недельного тренда'),
  ('50144199', 'weekly_trends', 'trend_min_days', '3'::jsonb, 'number', 'Минимум дней в каждом периоде тренда'),
  ('50144199', 'weekly_trends', 'trend_window_days', '7'::jsonb, 'number', 'Размер окна тренда'),
  ('50144199', 'weekly_trends', 'trend_max_items', '12'::jsonb, 'number', 'Максимум строк тренда в сообщении'),
  ('50144199', 'weekly_trends', 'send_empty', 'true'::jsonb, 'boolean', 'Присылать отчет без значимых трендов'),
  ('50144199', 'opp_24_incidents', 'opp24_expensive_price_threshold', '10000'::jsonb, 'number', 'Порог дорогого товара в 24'),
  ('50144199', 'opp_24_incidents', 'opp24_total_count_threshold', '0'::jsonb, 'number', 'Порог аномального количества ШК в 24, 0 выключает'),
  ('50144199', 'opp_24_incidents', 'opp24_total_sum_threshold', '0'::jsonb, 'number', 'Порог аномальной суммы в 24, 0 выключает'),
  ('50144199', 'opp_24_incidents', 'opp24_missing_price_count_threshold', '20'::jsonb, 'number', 'Минимум ШК без цены E для алерта 24'),
  ('50144199', 'opp_24_incidents', 'opp24_missing_price_percent_threshold', '20'::jsonb, 'number', 'Минимальная доля ШК без цены E для алерта 24')
on conflict (wh_id, alert_type, setting_key)
do update set
  value_type = excluded.value_type,
  description = excluded.description;
