insert into public.opp_alert_settings (wh_id, alert_type, setting_key, setting_value, value_type, description)
values
  ('50144199', 'lag_attention', 'lag_missing_upload_penalty_percent', '10'::jsonb, 'number', 'Штраф к отставанию за отсутствие выгрузки по текущему сроку разбора'),
  ('50144199', 'deadline_adjustments', 'adjust_sps_wmi', '-1'::jsonb, 'number', 'Срок разбора SPS + WMI в днях'),
  ('50144199', 'deadline_adjustments', 'adjust_smc', '-2'::jsonb, 'number', 'Срок разбора SMC в днях'),
  ('50144199', 'deadline_adjustments', 'adjust_sms', '-2'::jsonb, 'number', 'Срок разбора SMS в днях'),
  ('50144199', 'deadline_adjustments', 'adjust_wmi_bz', '-1'::jsonb, 'number', 'Срок разбора WMI Без заказа в днях'),
  ('50144199', 'deadline_adjustments', 'adjust_rwp', '-7'::jsonb, 'number', 'Срок разбора RWP в днях'),
  ('50144199', 'deadline_adjustments', 'adjust_24', '0'::jsonb, 'number', 'Срок разбора 24 в днях'),
  ('50144199', 'deadline_adjustments', 'adjust_ors', '0'::jsonb, 'number', 'Срок разбора ORS в днях'),
  ('50144199', 'deadline_adjustments', 'adjust_repack', '-7'::jsonb, 'number', 'Срок разбора Упаковки в днях')
on conflict (wh_id, alert_type, setting_key)
do update set
  value_type = excluded.value_type,
  description = excluded.description;
