with defaults(setting_key, setting_value, description) as (
  values
    ('adjust_sps_wmi', '-1'::jsonb, 'Срок разбора SPS + WMI в днях'),
    ('adjust_smc', '-2'::jsonb, 'Срок разбора SMC в днях'),
    ('adjust_sms', '-2'::jsonb, 'Срок разбора SMS в днях'),
    ('adjust_wmi_bz', '-1'::jsonb, 'Срок разбора WMI Без заказа в днях'),
    ('adjust_rwp', '-7'::jsonb, 'Срок разбора RWP в днях'),
    ('adjust_24', '0'::jsonb, 'Срок разбора 24 в днях'),
    ('adjust_ors', '0'::jsonb, 'Срок разбора ORS в днях'),
    ('adjust_repack', '-7'::jsonb, 'Срок разбора Упаковки в днях')
)
insert into public.opp_alert_settings (wh_id, alert_type, setting_key, setting_value, value_type, description)
select '50144199', 'deadline_adjustments', setting_key, setting_value, 'number', description
from defaults
on conflict (wh_id, alert_type, setting_key)
do update set
  setting_value = excluded.setting_value,
  value_type = excluded.value_type,
  description = excluded.description
where public.opp_alert_settings.updated_by is null;
