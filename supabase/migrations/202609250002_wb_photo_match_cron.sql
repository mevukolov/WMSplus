-- Раз в минуту дёргаем Edge Function wb-photo-match (поиск вероятных nm
-- по фото для ленты «Без ШК»). Секрет для авторизации вызова хранится в
-- Vault (wb_photo_match_secret) -- НЕ в этой миграции -- добавляется
-- отдельной командой при разворачивании:
--   select vault.create_secret('<random-value>', 'wb_photo_match_secret');
-- Та же строка ставится как секрет самой функции:
--   supabase secrets set WB_PHOTO_MATCH_SECRET=<тот же random-value>
-- Пока секрета в Vault нет, диспетчер просто ничего не отправляет --
-- это осознанно (no-op до ручной настройки), не ошибка.

create extension if not exists pg_net;

create or replace function public.wb_photo_match_dispatch()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'wb_photo_match_secret'
  limit 1;

  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/wb-photo-match',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('secret', v_secret)
  );
end;
$$;

comment on function public.wb_photo_match_dispatch() is
  'Раз в минуту вызывает Edge Function wb-photo-match (подбор вероятных nm по фото для ленты «Без ШК»). Секрет читается из Vault (wb_photo_match_secret); без него -- no-op.';

-- cron.schedule() апсертит по имени джобы на pg_cron >= 1.4 -- безопасно перезапускать.
select cron.schedule(
  'wb-photo-match-1m',
  '* * * * *',
  $$select public.wb_photo_match_dispatch();$$
);
