-- Окно выгрузки шире одного дня: upload_offset_days правила теперь может
-- означать "не свежее N дней" вместо "ровно N дней назад" (см. сессию
-- 2026-10-15), поэтому один run может фактически покрыть диапазон дат, а
-- не только effective_date/business_date (якорь "сегодня", нужен
-- unique-индексу и "уже выгружено?"). Добавляем отдельные колонки для
-- реально покрытого диапазона -- чисто аддитивно, nullable, старые записи
-- не трогаем.
alter table public.wms_manual_upload_runs
  add column if not exists window_start_date date,
  add column if not exists window_end_date date;

comment on column public.wms_manual_upload_runs.window_start_date is 'Самая старая дата строки, реально вошедшей в этот run (может отличаться от effective_date, если правило admits "N+ дней назад").';
comment on column public.wms_manual_upload_runs.window_end_date is 'Самая новая дата строки, реально вошедшей в этот run.';
