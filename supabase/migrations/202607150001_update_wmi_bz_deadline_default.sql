update public.opp_alert_settings
set
  setting_value = '-1'::jsonb,
  description = 'Срок разбора WMI Без заказа в днях'
where wh_id = '50144199'
  and alert_type = 'deadline_adjustments'
  and setting_key = 'adjust_wmi_bz'
  and (
    updated_by is null
    or setting_value = '-0.5'::jsonb
  );
