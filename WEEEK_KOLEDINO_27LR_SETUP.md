# WEEEK Коледино + 27LR Setup

Модуль `Коледино + 27LR` состоит из трех частей:

1. `google_apps_script_koledino_27lr_api.gs` - Apps Script для чтения и безопасной обратной записи в Google Sheets.
2. `weeek-koledino-27lr-refresh` - Supabase Edge Function, которая кладет строки в `public.weeek_tasks`.
3. `weeek-task-master` - общий мастер WEEEK, который создает задачи, проверяет обязательные поля, переносит завершенные и пишет результат назад в Google Sheets.

Источник:

```text
https://docs.google.com/spreadsheets/d/1R49a_7kcsk8cjBfv6GenN5B3e92iTvjYDpUl5wzpimE
```

Лист:

```text
Нижний Ларина
```

Правила отбора:

```text
A / ШК = уникальный source_id
E / Дата раскладки >= сегодня - 14 дней
G / Вложение пустое или равно "Нет разбора" = строку берем
G / Вложение заполнено и не равно "Нет разбора" = строку не берем
A повторился в актуальном окне = дубль игнорируем, в Google Sheets ничего не пишем
```

## 1. Apps Script

1. Открой `https://script.google.com`.
2. Нажми `Новый проект`.
3. Назови проект, например `Koledino 27LR API`.
4. В `Code.gs` вставь содержимое файла:

```text
/Users/WBwork/Downloads/WMSplus-main/google_apps_script_koledino_27lr_api.gs
```

5. Нажми `Сохранить`.
6. `Deploy` -> `New deployment` -> `Web app`.
7. `Execute as` = `Me`.
8. `Who has access` = `Anyone`.
9. Нажми `Deploy`, разреши доступы и сохрани Web App URL.

Если нужен секрет Apps Script, добавь Script property:
https://script.google.com/macros/s/AKfycbyal3k-kyuBGBDSyBcxp1D6xn3mZap6VVnTWMi5VicKmB1vUmT6kDv17VAH9kDG37mC7A/exec
```text
KOLEDINO_27LR_API_SECRET = любой_длинный_секрет
```

## 2. Миграция route

В Supabase SQL Editor вставь файл:

```text
/Users/WBwork/Downloads/WMSplus-main/supabase/migrations/202608040001_weeek_koledino_27lr_route.sql
```

Проверка:

```sql
select route_key, task_type, active_board_id, active_board_name, active_default_column_name, inactive_done_column_name
from public.weeek_task_routes
where route_key = 'koledino_27lr';
```

## 3. Deploy Edge Functions

Обновить/создать функции:

```text
/Users/WBwork/Downloads/WMSplus-main/supabase/functions/weeek-task-master/index.ts
/Users/WBwork/Downloads/WMSplus-main/supabase/functions/weeek-koledino-27lr-refresh/index.ts
```

Через CLI:

```bash
supabase functions deploy weeek-task-master --no-verify-jwt
supabase functions deploy weeek-koledino-27lr-refresh --no-verify-jwt
```

Или через Supabase Dashboard: `Edge Functions` -> открыть функцию -> заменить код -> `Deploy`.

## 4. Secrets

Минимально:

```text
WEEEK_API_KEY = WEEEK API token
WEEEK_TASK_MASTER_SECRET = 50144199 или твой секрет
WEEEK_KOLEDINO_27LR_REFRESH_SECRET = 50144199 или твой секрет
KOLEDINO_27LR_APPS_SCRIPT_URL = Web App URL из Apps Script
```

Если задал секрет в Apps Script:

```text
KOLEDINO_27LR_APPS_SCRIPT_SECRET = тот_же_секрет
```

Опционально, чтобы поле `Тип задачи` заполнялось в WEEEK:

```text
WEEEK_KOLEDINO_27LR_TASK_TYPE_OPTION_ID = option id значения "Коледино + 27LR" в поле "Тип задачи"
```

Уже заданные дефолты:

```text
project_id = 5
board_id = 10
board_name = Запросы входящего потока
column = К разбору
price field id = a2624094-7335-45be-bcfd-9a2be15b368a
request time field id = a26a135b-66af-4aa8-9e52-4e7b9d90d2eb
```

## 5. Тест refresh

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-koledino-27lr-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '50144199',
    'dry_run', true,
    'limit', 5
  ),
  timeout_milliseconds := 120000
);
```

Боевой refresh:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-koledino-27lr-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '50144199'
  ),
  timeout_milliseconds := 120000
);
```

## 6. Создать задачи в WEEEK

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '50144199',
    'action', 'process_queue',
    'source_module', 'koledino_27lr',
    'project_id', '5',
    'limit', 5
  ),
  timeout_milliseconds := 120000
);
```

## 7. Синхронизация завершений

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '50144199',
    'action', 'sync_statuses',
    'source_module', 'koledino_27lr',
    'project_id', '5',
    'limit', 20
  ),
  timeout_milliseconds := 120000
);
```

## 8. Cron

```sql
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weeek-koledino-27lr-refresh-10m') then
    perform cron.unschedule('weeek-koledino-27lr-refresh-10m');
  end if;

  if exists (select 1 from cron.job where jobname = 'weeek-koledino-27lr-process-5m') then
    perform cron.unschedule('weeek-koledino-27lr-process-5m');
  end if;

  if exists (select 1 from cron.job where jobname = 'weeek-koledino-27lr-sync-5m') then
    perform cron.unschedule('weeek-koledino-27lr-sync-5m');
  end if;
end $$;

select cron.schedule(
  'weeek-koledino-27lr-refresh-10m',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-koledino-27lr-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'secret', '50144199'
    ),
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'weeek-koledino-27lr-process-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'secret', '50144199',
      'action', 'process_queue',
      'source_module', 'koledino_27lr',
      'project_id', '5',
      'limit', 10
    ),
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'weeek-koledino-27lr-sync-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'secret', '50144199',
      'action', 'sync_statuses',
      'source_module', 'koledino_27lr',
      'project_id', '5',
      'limit', 20
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

Проверка cron:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname ilike '%koledino%'
order by jobid;
```
