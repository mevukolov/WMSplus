# OPP cache acceleration (Telegram-first)

Сейчас сайт может быть недоступен из-за сетевых ограничений, поэтому основной поток отчетности переводится в Telegram.

Новая логика без `IDLE_TIMEOUT`:
- Google Apps Script сам по таймеру считает Telegram-отчеты;
- Apps Script отправляет готовый payload в Supabase Edge Function `opp-cache-ingest`;
- `opp-cache-ingest` быстро пишет готовый payload в `opp_reports_cache`;
- `opp-cache-ingest` дополнительно пишет историю OPP-смен в `report_runs`/`report_metrics`;
- сайт-метрики и старые scope не удаляются, но больше не обновляются по умолчанию.

Основные Telegram-scope:
- `opp_telegram_shift` — текущая смена, используется для итогов, кнопки и 17:30 алерта;
- `opp_telegram_rolling30` — последние 30 дней, используется для отставания.

Старые scope сохранены для будущей миграции сайта:
- `opp_admin`
- `opp_dashboard_month`
- `opp_dashboard_shift`
- `opp_dashboard_rolling30`

Важно: `opp-cache-refresh` оставлен как совместимость, но для Telegram лучше не использовать его по cron. Он все еще может словить `IDLE_TIMEOUT`, потому что Supabase ждет Google Apps Script. Основной путь теперь: Apps Script -> `opp-cache-ingest` -> Supabase cache -> Telegram.

## 1) Применить миграции

Примените обе миграции:
- `supabase/migrations/202603240001_opp_reports_cache.sql`
- `supabase/migrations/202603240002_opp_reports_cache_disable_rls.sql`

Вторая миграция отключает RLS для `public.opp_reports_cache`.

## 2) Деплой Edge Functions

Функции:
- `supabase/functions/opp-cache-refresh/index.ts`
- `supabase/functions/opp-cache-ingest/index.ts`

```bash
supabase functions deploy opp-cache-refresh
supabase functions deploy opp-cache-ingest --no-verify-jwt
```

Важно: для `opp-cache-ingest` отключите `Verify JWT`.

## 3) Переменные функции

Нужны переменные:
- `OPP_CACHE_TTL_MINUTES` = `30`
- `OPP_CACHE_API_TIMEOUT_MS` = `600000`
- `OPP_CACHE_API_DATA_TYPE` = `opp_table_analisys_script`
- `OPP_CACHE_DEADLINES_DATA_TYPE` = `opp_table_deadlines`
- `OPP_CACHE_TABLE` = `opp_reports_cache`
- `OPP_CACHE_DEFAULT_SCOPES` = `opp_telegram_shift,opp_telegram_rolling30`
- `OPP_CACHE_INGEST_SECRET` = любой длинный секрет для приема payload от Apps Script

Примечание: для `opp_dashboard_month`, `opp_dashboard_shift`, `opp_dashboard_rolling30`, `opp_telegram_shift` и `opp_telegram_rolling30` функция использует облегченный ответ Apps Script
(`skip_period_sheets=1`), чтобы избежать таймаутов.

Для `opp_dashboard_shift` и `opp_telegram_shift` дополнительно включается ускоренный режим Apps Script:
- `skip_today_deadline=1` — не собирает тяжелый блок дедлайнов на текущий момент;
- `shift_current_only=1` — строит `shift_dynamics` только для текущей операционной даты.

Если меняли `google_apps_script_unique_shk_api.gs`, сначала обновите deployment Apps Script, и только потом деплойте/проверяйте `opp-cache-refresh`.

```bash
supabase secrets set \
  OPP_CACHE_TTL_MINUTES="30" \
  OPP_CACHE_API_TIMEOUT_MS="600000" \
  OPP_CACHE_API_DATA_TYPE="opp_table_analisys_script" \
  OPP_CACHE_DEADLINES_DATA_TYPE="opp_table_deadlines" \
  OPP_CACHE_TABLE="opp_reports_cache" \
  OPP_CACHE_DEFAULT_SCOPES="opp_telegram_shift,opp_telegram_rolling30" \
  OPP_CACHE_INGEST_SECRET="<любой-длинный-секрет>"
```

## 4) Настройка Google Apps Script push

В Google Apps Script откройте:
`Project Settings` -> `Script properties` -> `Add script property`.

Добавьте:

```text
OPP_CACHE_INGEST_URL = https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/opp-cache-ingest
OPP_CACHE_INGEST_SECRET = <тот же секрет, что в Supabase OPP_CACHE_INGEST_SECRET>
OPP_CACHE_WH_ID = 50144199
OPP_CACHE_TTL_MINUTES = 90
```

Если Apps Script не привязан напрямую к нужной таблице, добавьте:

```text
OPP_CACHE_SPREADSHEET_ID = <ID Google таблицы>
```

Если дедлайны нужно переопределить без изменения кода, добавьте:

```json
OPP_CACHE_DEADLINES_JSON = {
  "deadlines": [
    {"key":"SPS_WMI","offset_days":-1,"display_key":"SPS + WMI"},
    {"key":"SMC","offset_days":-2,"display_key":"SMC"},
    {"key":"SMS","offset_days":-2,"display_key":"SMS"},
    {"key":"WMI_BZ","offset_days":-1,"display_key":"WMI Без заказа"},
    {"key":"RWP","offset_days":-7,"display_key":"RWP"},
    {"key":"24","offset_days":0,"display_key":"24"},
    {"key":"ORS","offset_days":0,"display_key":"ORS"},
    {"key":"REPACK","offset_days":-7,"display_key":"Упаковка"}
  ]
}
```

После сохранения Script Properties:

1. В Apps Script выберите функцию `setupOppTelegramCacheTriggers`.
2. Нажмите `Run`.
3. Разрешите доступы.

Она создаст триггеры:
- `pushOppTelegramShiftCacheToSupabase` каждые 30 минут;
- `pushOppTelegramRolling30CacheToSupabase` около 08:55 МСК;
- `pushOppTelegramRolling30CacheToSupabase` около 20:20 МСК.

Для ручной проверки запустите:
- `pushOppTelegramShiftCacheToSupabase` — обновить текущую смену;
- `pushOppTelegramRolling30CacheToSupabase` — обновить 30-дневное отставание;
- `pushOppTelegramCacheToSupabase` — обновить оба кэша.

## 5) Проверка ingest через SQL

Проверить, что кэш появился:

```sql
select
  cache_scope,
  max(refreshed_at) as last_refresh,
  count(*) as rows
from public.opp_reports_cache
where wh_id = '50144199'
  and cache_scope in ('opp_telegram_shift', 'opp_telegram_rolling30')
group by cache_scope
order by cache_scope;
```

Проверить последние ответы `opp-cache-ingest`:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by created desc
limit 20;
```

## 6) Что отключить в Supabase cron

Старые Supabase cron для refresh лучше отключить. Они больше не нужны для Telegram и могут давать `IDLE_TIMEOUT`.

```sql
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'opp-cache-refresh-admin-30m',
  'opp-cache-refresh-month-30m',
  'opp-cache-refresh-rolling30-30m',
  'opp-cache-refresh-shift-30m',
  'opp-cache-refresh-30m',
  'opp-cache-refresh-telegram-shift-30m',
  'opp-cache-refresh-telegram-shift-before-rush-1725-msk',
  'opp-cache-refresh-telegram-lag-0855-msk',
  'opp-cache-refresh-telegram-lag-2020-msk'
);
```

## 7) Что осталось для сайта

Во фронте уже включено:
- чтение из `opp_reports_cache` по `(wh_id, cache_scope, date_from, date_to)`
- fallback к Apps Script API при пустом/просроченном кэше
- fallback к устаревшему кэшу, если API временно недоступен
- отображение `Выгрузка: ...`

Но сайт сейчас не является основным потребителем. Для будущей миграции можно будет либо перевести страницы на Telegram-scope, либо вернуть отдельные cron-задачи для `opp_dashboard_*`.

## 8) Проверка

1. Проверьте ответы cron:

```sql
select id, status_code, error_msg, created
from net._http_response
order by created desc
limit 20;
```

2. Проверьте кэш:

```sql
select cache_scope, max(refreshed_at) as last_refresh, count(*) as rows
from public.opp_reports_cache
group by cache_scope
order by cache_scope;
```

Ожидание: `status_code = 200`, и есть свежие scope:
- `opp_telegram_shift`
- `opp_telegram_rolling30`

## 9) История выгрузок

Для полноценного логирования, а не только кэша, примените:

```text
supabase/migrations/202607130001_report_logging.sql
```

Подробная инструкция: `REPORT_LOGGING_SETUP.md`.

После этого каждый успешный `opp_telegram_shift` будет добавлять запись в:
- `public.report_runs`
- `public.report_metrics`

Проверка:

```sql
select *
from public.opp_shift_report_runs
where wh_id = '50144199'
order by created_at desc
limit 20;
```
