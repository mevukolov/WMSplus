# WEEEK Incoming Flow Requests Setup

Модуль `Запросы входящего потока` состоит из трех частей:

1. `google_apps_script_incoming_flow_requests_api.gs` - отдельный Apps Script для чтения и безопасной обратной записи в Google Sheets.
2. `weeek-incoming-flow-requests-refresh` - Supabase Edge Function, которая кладет строки без вердикта в `public.weeek_tasks`.
3. `weeek-task-master` - общий мастер WEEEK, который создает задачи, проверяет заполнение, переносит завершенные и пишет результат назад в Google Sheets.

Источник:

```text
https://docs.google.com/spreadsheets/d/1SvVyOHCaceVs0KQznXPvSMtcynMAL165_F0I_6adJB0
```

Лист:

```text
Проверка корректности вложения в тару
```

Главные правила:

```text
D / Искомый ШК = уникальный source_id
H / Вердикт заполнен = строку не трогаем и не выгружаем
D повторился при пустом H = в H пишем Дубль, в Supabase не выгружаем
```

## 1. Apps Script

1. Открой `https://script.google.com`.
2. Нажми `Новый проект`.
3. Назови проект, например `Incoming flow requests API`.
4. В файл `Code.gs` вставь содержимое файла:

```text
/Users/WBwork/Downloads/WMSplus-main/google_apps_script_incoming_flow_requests_api.gs
```

5. Нажми `Сохранить`.

### Необязательная защита секретом

Если хочешь защитить Apps Script URL:

1. Слева нажми `Project Settings` / `Настройки проекта`.
2. Найди `Script properties` / `Свойства скрипта`.
3. Добавь свойство:

```text
INCOMING_FLOW_REQUESTS_API_SECRET = любой_длинный_секрет
```

Если свойство не добавлять, Apps Script будет работать без этого секрета.

### Деплой Web App

1. Нажми `Deploy`.
2. Нажми `New deployment`.
3. В типе выбери `Web app`.
4. `Execute as` = `Me`.
5. `Who has access` = `Anyone`.
6. Нажми `Deploy`.
7. Разреши доступы.
8. Сохрани Web App URL вида:

```text
https://script.google.com/macros/s/AKfycbzEvl12GS3jCjJRY_UjJWso3XwN1cbUNGH1EhL3sjp8anD2WlfiUK5of690yEPtrnXw/exec
```

Важно: аккаунт Apps Script должен иметь доступ к исходной Google-таблице.

### Проверка Apps Script в браузере

Открой URL, заменив `WEB_APP_URL`:

```text
https://script.google.com/macros/s/AKfycbzEvl12GS3jCjJRY_UjJWso3XwN1cbUNGH1EhL3sjp8anD2WlfiUK5of690yEPtrnXw/exec?action=list_sheets&spreadsheet_id=1SvVyOHCaceVs0KQznXPvSMtcynMAL165_F0I_6adJB0
```

Если задавал секрет, добавь:

```text
&secret=твой_секрет
```

Проверка строк:

```text
https://script.google.com/macros/s/AKfycbzEvl12GS3jCjJRY_UjJWso3XwN1cbUNGH1EhL3sjp8anD2WlfiUK5of690yEPtrnXw/exec?spreadsheet_id=1SvVyOHCaceVs0KQznXPvSMtcynMAL165_F0I_6adJB0&sheet_name=Проверка%20корректности%20вложения%20в%20тару&start_row=2
```

Ожидаемо: `ok: true`, `rows` содержит только строки, где H пустой. Дубли с пустым H будут отмечены в исходной таблице как `Дубль`.

## 2. Миграция маршрута Supabase

В Supabase:

1. Открой проект `bgphllmzmlwurfnbagho`.
2. Открой `SQL Editor`.
3. Нажми `New query`.
4. Вставь содержимое файла:

```text
/Users/WBwork/Downloads/WMSplus-main/supabase/migrations/202608030001_weeek_incoming_flow_requests_route.sql
```

5. Нажми `Run`.

Проверка:

```sql
select
  route_key,
  task_type,
  active_board_name,
  active_default_column_name,
  inactive_board_name,
  inactive_done_column_name
from public.weeek_task_routes
where route_key = 'incoming_flow_requests';
```

Ожидаемо:

```text
route_key = incoming_flow_requests
task_type = Запросы входящего потока
active_board_name = Запросы входящего потока
active_default_column_name = К разбору
inactive_done_column_name = Разбор завершен
```

## 3. Задеплоить Edge Functions

Нужно обновить общий мастер и добавить новую refresh-функцию:

```text
/Users/WBwork/Downloads/WMSplus-main/supabase/functions/weeek-task-master/index.ts
/Users/WBwork/Downloads/WMSplus-main/supabase/functions/weeek-incoming-flow-requests-refresh/index.ts
```

### Через Supabase Dashboard

1. Supabase Dashboard.
2. `Edge Functions`.
3. Открой `weeek-task-master`.
4. Замени код на содержимое файла `supabase/functions/weeek-task-master/index.ts`.
5. Нажми `Deploy`.
6. Создай или открой функцию `weeek-incoming-flow-requests-refresh`.
7. Код: содержимое файла `supabase/functions/weeek-incoming-flow-requests-refresh/index.ts`.
8. Нажми `Deploy`.
9. JWT verification выключи, если вызываешь из SQL через `pg_net` без Authorization header.

### Через Supabase CLI

```bash
supabase functions deploy weeek-task-master --no-verify-jwt
supabase functions deploy weeek-incoming-flow-requests-refresh --no-verify-jwt
```

## 4. Настройки / Secrets

Минимально нужно:

```text
WEEEK_API_KEY = твой WEEEK API token
WEEEK_TASK_MASTER_SECRET = любой_секрет_для_мастера
WEEEK_INCOMING_FLOW_REQUESTS_REFRESH_SECRET = любой_секрет_для_refresh
INCOMING_FLOW_REQUESTS_APPS_SCRIPT_URL = WEB_APP_URL
WEEEK_INCOMING_FLOW_PROJECT_ID = project id проекта "Запросы от других ЛО"
```

Если в Apps Script задан `INCOMING_FLOW_REQUESTS_API_SECRET`, добавь такой же секрет в Supabase:

```text
INCOMING_FLOW_REQUESTS_APPS_SCRIPT_SECRET = тот_же_секрет
```

Желательно добавить ID полей WEEEK:

```text
WEEEK_INCOMING_FLOW_TASK_TYPE_OPTION_ID = option id значения "Запросы входящего потока" в поле "Тип задачи"
WEEEK_INCOMING_FLOW_REQUEST_TIME_FIELD_ID = field id поля "Время запроса"
```

Опционально для стабильности можно задать ID полей, которые заполняет сотрудник:

```text
WEEEK_INCOMING_FLOW_ATTACHMENT_FIELD_ID = field id поля "Вложение"
WEEEK_INCOMING_FLOW_GUILTY_ID_FIELD_ID = field id поля "ID виновного"
WEEEK_INCOMING_FLOW_COMMENT_FIELD_ID = field id поля "Комментарий ОПП"

Тип задачи = a25e22e9-f7fb-4640-963b-5ba1ad75cfe9 -> option "Запросы входящего потока" = a26204a6-cbe6-43cb-92ea-58760e5fb8d4 
Время запроса = a26a135b-66af-4aa8-9e52-4e7b9d90d2eb
Вложение = a26a129f-71cf-41c8-baa1-6885a7fed0fe
ID виновного = a26a13d0-ff7e-4065-bc2b-ea041da1da82
Комментарий ОПП = a26a47ac-e6b3-4fce-b828-d59f9ac31f54

Если их не указать, мастер будет искать поля по названиям.

Тег можно не задавать: по умолчанию мастер попробует найти или создать тег `Запрос входящего потока`. Если хочешь жестко указать ID:

```text
WEEEK_INCOMING_FLOW_TAG_ID = tag id
```

## 5. Найти project/board/field IDs

Project ID и board ID проще всего взять из URL WEEEK:

```text
https://app.weeek.net/ws/1021782/project/PROJECT_ID/board/BOARD_ID
```

Проверить доски проекта:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '<WEEEK_TASK_MASTER_SECRET>',
    'action', 'list_boards',
    'project_id', '<PROJECT_ID>'
  ),
  timeout_milliseconds := 120000
);
```

Проверить колонки доски:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '50144199',
    'action', 'list_columns',
    'project_id', '5',
    'board_id', '10'
  ),
  timeout_milliseconds := 120000
);
```

Проверить custom fields:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '50144199',
    'action', 'list_custom_fields',
    'project_id', '5',
    'board_id', '10'
  ),
  timeout_milliseconds := 120000
);
```

Ответ смотреть:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 5;
```

Нужно найти:

```text
Тип задачи = a25e22e9-f7fb-4640-963b-5ba1ad75cfe9 -> option "Запросы входящего потока" = a26204a6-cbe6-43cb-92ea-58760e5fb8d4 
Время запроса = a26a135b-66af-4aa8-9e52-4e7b9d90d2eb
Вложение = a26a129f-71cf-41c8-baa1-6885a7fed0fe
ID виновного = a26a13d0-ff7e-4065-bc2b-ea041da1da82
Комментарий ОПП = a26a47ac-e6b3-4fce-b828-d59f9ac31f54
```

## 6. Тест 1: refresh без записи в Supabase

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-incoming-flow-requests-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '<WEEEK_INCOMING_FLOW_REQUESTS_REFRESH_SECRET>',
    'dry_run', true,
    'api_url', '<WEB_APP_URL>',
    'project_id', '<PROJECT_ID>',
    'task_type_option_id', '<TASK_TYPE_OPTION_ID>',
    'request_time_field_id', '<REQUEST_TIME_FIELD_ID>'
  ),
  timeout_milliseconds := 120000
);
```

Проверка ответа:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 5;
```

Ожидаемо:

```text
ok = true
dry_run = true
sample содержит задачи
```

## 7. Тест 2: реальная очередь в Supabase

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-incoming-flow-requests-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '<WEEEK_INCOMING_FLOW_REQUESTS_REFRESH_SECRET>',
    'dry_run', false,
    'api_url', '<WEB_APP_URL>',
    'project_id', '<PROJECT_ID>',
    'task_type_option_id', '<TASK_TYPE_OPTION_ID>',
    'request_time_field_id', '<REQUEST_TIME_FIELD_ID>'
  ),
  timeout_milliseconds := 120000
);
```

Проверка очереди:

```sql
select
  source_id,
  title,
  master_status,
  task_status,
  target_project_id,
  target_board_name,
  target_column_name,
  due_date,
  target_custom_fields,
  target_tags,
  source_payload
from public.weeek_tasks
where source_module = 'incoming_flow_requests'
order by updated_at desc
limit 10;
```

## 8. Тест 3: создать задачи в WEEEK

Сначала безопасно:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '<WEEEK_TASK_MASTER_SECRET>',
    'action', 'process_queue',
    'source_module', 'incoming_flow_requests',
    'dry_run', true,
    'limit', 3
  ),
  timeout_milliseconds := 120000
);
```

Если payload выглядит нормально, реально:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '<WEEEK_TASK_MASTER_SECRET>',
    'action', 'process_queue',
    'source_module', 'incoming_flow_requests',
    'limit', 3
  ),
  timeout_milliseconds := 120000
);
```

## 9. Тест 4: завершение и обратная запись

1. Открой одну созданную задачу в WEEEK.
2. Заполни поля:

```text
Вложение
ID виновного
Комментарий ОПП
```

3. Отметь задачу выполненной.
4. Запусти синхронизацию по конкретному ШК:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '<WEEEK_TASK_MASTER_SECRET>',
    'action', 'sync_statuses',
    'source_module', 'incoming_flow_requests',
    'source_id', '<ИСКОМЫЙ_ШК>',
    'limit', 1
  ),
  timeout_milliseconds := 120000
);
```

Ожидаемо:

```text
action = incoming_flow_finalized
written_back = true
```

В исходной Google-таблице у этой строки должны заполниться H:K.

Если задача была отмечена выполненной, но поля заполнены не все, ожидаемо:

```text
action = incoming_flow_incomplete
```

Мастер снимет выполнение и не запишет ничего в Google Sheet.

## 10. Cron

Если общий `weeek-task-master` уже крутится на `process_queue` и `sync_statuses`, добавь только refresh для нового источника.

Refresh каждые 5 минут:

```sql
select cron.schedule(
  'weeek-incoming-flow-refresh-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-incoming-flow-requests-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'secret', '<WEEEK_INCOMING_FLOW_REQUESTS_REFRESH_SECRET>'
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

Если общего мастера нет, добавь обработку очереди:

```sql
select cron.schedule(
  'weeek-task-master-process-2m',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'secret', '<WEEEK_TASK_MASTER_SECRET>',
      'action', 'process_queue',
      'limit', 10
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

И синхронизацию статусов:

```sql
select cron.schedule(
  'weeek-task-master-status-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'secret', '<WEEEK_TASK_MASTER_SECRET>',
      'action', 'sync_statuses',
      'limit', 20
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

Проверить cron:

```sql
select jobid, jobname, schedule, active, command
from cron.job
where jobname ilike '%weeek%'
order by jobid;
```
