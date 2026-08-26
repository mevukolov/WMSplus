# Report logging setup

Это отдельный слой истории, не кэш.

Кэш (`opp_reports_cache`) хранит актуальное состояние для Telegram/сайта и перезаписывается.
Лог (`report_runs` + `report_metrics`) хранит каждый запуск append-only, чтобы смотреть динамику работы.

## 1. Применить миграцию

В Supabase SQL Editor выполните:

```sql
-- Скопируйте и выполните содержимое файла:
-- supabase/migrations/202607130001_report_logging.sql
```

Будут созданы:
- `public.report_runs` — один ряд на выгрузку/проверку;
- `public.report_metrics` — показатели этой выгрузки;
- `public.report_metrics_flat` — удобный view для просмотра метрик строками;
- `public.opp_shift_report_runs` — удобный view по OPP-сменам в широком виде.
- `public.opp_shift_detail_latest_metrics` — последние дневные метрики по каждой выгрузке для анализа трендов.

## 2. Деплой функций

```bash
supabase functions deploy opp-cache-ingest --no-verify-jwt
supabase functions deploy report-log-ingest --no-verify-jwt
```

`opp-cache-ingest` теперь делает две вещи:
- обновляет `opp_reports_cache`;
- пишет историю OPP-смены в `report_runs` и `report_metrics`, если scope = `opp_telegram_shift`.

`report-log-ingest` нужен для внешних механизмов, например Google Apps Script ежедневных списаний.

## 3. Secrets

Можно использовать тот же секрет, что и для OPP cache ingest:

```bash
supabase secrets set REPORT_LOG_INGEST_SECRET="<тот же или новый длинный секрет>"
```

Если `REPORT_LOG_INGEST_SECRET` не задан, функция попробует fallback:
- `OPP_CACHE_INGEST_SECRET`;
- `OPP_ALERT_SECRET`.

## 4. Включить лог ежедневных списаний

В Apps Script ежедневных списаний откройте:
`Project Settings` -> `Script properties`.

Добавьте:

```text
REPORT_LOG_ENABLED = 1
REPORT_LOG_INGEST_URL = https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/report-log-ingest
REPORT_LOG_INGEST_SECRET = <секрет из Supabase>
WRITE_OFFS_WH_ID = 50144199
```

После этого `runDailyWriteoffsCheck` и ретраи будут писать историю в БД.
Если логирование упадет, Telegram-сообщение не сломается: ошибка уйдет в Apps Script `Logger`.

## 5. Быстрая проверка

После ручного запуска `pushOppTelegramShiftCacheToSupabase`:

```sql
select
  id,
  created_at,
  generated_at,
  wh_id,
  mechanism,
  report_scope,
  shift_id,
  shift_date
from public.report_runs
where mechanism = 'Анализ таблицы ОПП'
order by created_at desc
limit 20;
```

Проверить OPP-смены в широком виде:

```sql
select *
from public.opp_shift_report_runs
where wh_id = '50144199'
order by created_at desc
limit 20;
```

Проверить данные для недельных трендов:

```sql
select
  shift_date,
  group_name,
  metric_name,
  value_num
from public.opp_shift_detail_latest_metrics
where wh_id = '50144199'
order by shift_date desc, group_name, metric_key
limit 100;
```

Проверить метрики конкретного запуска:

```sql
select
  metric_key,
  metric_name,
  group_name,
  value_num,
  value_text,
  unit,
  severity
from public.report_metrics
where run_id = <RUN_ID>
order by group_name nulls first, metric_key;
```

Проверить ежедневные списания:

```sql
select
  r.created_at,
  r.mechanism,
  r.period_from,
  r.status,
  m.metric_name,
  m.value_num,
  m.unit,
  m.severity
from public.report_runs r
join public.report_metrics m on m.run_id = r.id
where r.mechanism = 'Анализ таблицы куратора по списаниям'
order by r.created_at desc, m.metric_key
limit 50;
```

## 6. Как читать схему

`report_runs`:
- `created_at` — когда запись попала в БД;
- `generated_at` — когда источник сформировал отчет;
- `mechanism` — механизм выгрузки: например `Анализ таблицы ОПП`;
- `report_scope` — технический тип отчета: например `opp_telegram_shift`;
- `shift_id`, `shift_date` — смена, если применимо;
- `period_from`, `period_to` — период расчета;
- `payload` — исходный компактный JSON для расследований.

`report_metrics`:
- `metric_key` — техническое имя показателя;
- `metric_name` — человекочитаемое имя;
- `group_name` — выгрузка/участок/СЦ, если показатель групповой;
- `value_num` — числовое значение;
- `value_text` — текстовое значение;
- `unit` — единица: `shk`, `rub`, `percent`, `bool`;
- `severity` — `ok`, `warning`, `critical`, если показатель можно оценить.
