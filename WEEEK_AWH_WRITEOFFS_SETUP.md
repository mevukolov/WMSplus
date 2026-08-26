# WEEEK AWH Writeoffs Setup

Модуль `Списания AWH` состоит из трех частей:

1. `google_apps_script_awh_writeoffs_api.gs` - отдельный Apps Script, который читает чужую Google-таблицу и отдает JSON.
2. `weeek-awh-writeoffs-refresh` - Supabase Edge Function, которая складывает строки в `public.weeek_tasks`.
3. `weeek-task-master` - общий мастер WEEEK, который создает, переносит, откладывает и переоткрывает задачи.

Источник: `https://docs.google.com/spreadsheets/d/1dLD7T-Nw3AlIwjaPCj9ukDc6NJvWEtPVht91Jm15Duk`

Фильтр строк:

```text
лист начинается с: Списание
B / ЛО = СЦ Нижний Новгород Ларина
```

Автозакрытие:

```text
если A / Статус = Аннулирован
или A / Статус = Списано на виновного
или A / Статус = Найден
```

Такие задачи мастер закрывает сам:

```text
Вердикт ОПП = Найден/Релиз/Списан
task_status = Завершено
тег = Закрыто системой
доска = ❌ Неактивные задачи
колонка = Разбор завершен
```

Уникальность:

```text
source_module = awh_writeoffs
source_id = D / Короб
task_type = Списания AWH
```

## 1. Apps Script

1. Открой `https://script.google.com`.
2. Нажми `Новый проект`.
3. Назови проект, например `AWH writeoffs API`.
4. В файл `Code.gs` вставь содержимое файла:
   `/Users/WBwork/Downloads/WMSplus-main/google_apps_script_awh_writeoffs_api.gs`
5. Нажми `Сохранить`.

### Необязательная защита секретом

Если хочешь защитить Web App URL:

1. В Apps Script слева нажми `Project Settings` / `Настройки проекта`.
2. Найди `Script properties` / `Свойства скрипта`.
3. Добавь свойство:

```text
AWH_WRITEOFFS_API_SECRET = любой_длинный_секрет
```

Если свойство не добавлять, endpoint будет работать без этого секрета.

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
https://script.google.com/macros/s/AKfycbwL1qAfcnekg1usRL1YIFWNwgrJiXbEr2x6Rb1BY_02xVww7OXoBQFTQS7TYUT4k4jF/exec
```

Важно: аккаунт, от которого выполняется Apps Script, должен иметь доступ к исходной Google-таблице.

### Быстрая проверка Apps Script в браузере

Открой URL, подставив свой Web App URL:

```text
https://script.google.com/macros/s/AKfycbwL1qAfcnekg1usRL1YIFWNwgrJiXbEr2x6Rb1BY_02xVww7OXoBQFTQS7TYUT4k4jF/exec?action=list_sheets&spreadsheet_id=1dLD7T-Nw3AlIwjaPCj9ukDc6NJvWEtPVht91Jm15Duk&sheet_prefix=Списание
```

Если задавал `AWH_WRITEOFFS_API_SECRET`, добавь в конец:

```text
&secret=твой_секрет
```

Должен прийти JSON с `ok: true` и `matched_sheets`.

Проверка строк:

```text
https://script.google.com/macros/s/AKfycbwL1qAfcnekg1usRL1YIFWNwgrJiXbEr2x6Rb1BY_02xVww7OXoBQFTQS7TYUT4k4jF/exec?spreadsheet_id=1dLD7T-Nw3AlIwjaPCj9ukDc6NJvWEtPVht91Jm15Duk&sheet_prefix=Списание&lo=СЦ%20Нижний%20Новгород%20Ларина&start_row=2
```

Ожидаемо: `rows` со строками, где ЛО = `СЦ Нижний Новгород Ларина`.

## 2. Миграция маршрута Supabase

Открой Supabase:

1. Project `bgphllmzmlwurfnbagho`.
2. `SQL Editor`.
3. `New query`.
4. Вставь содержимое файла:
   `/Users/WBwork/Downloads/WMSplus-main/supabase/migrations/202607300001_weeek_awh_writeoffs_route.sql`
5. Нажми `Run`.

Проверка маршрута:

```sql
select
  route_key,
  task_type,
  active_board_id,
  active_default_column_id,
  active_default_column_name,
  inactive_board_id,
  inactive_wait_column_id,
  inactive_wait_column_name,
  inactive_done_column_name
from public.weeek_task_routes
where route_key = 'awh_writeoffs';
```

Ожидаемо:

```text
route_key = awh_writeoffs
task_type = Списания AWH
active_default_column_name = Списания AWH
```

## 3. Задеплоить Edge Functions

Нужно обновить общий мастер и добавить новую функцию:

```text
/Users/WBwork/Downloads/WMSplus-main/supabase/functions/weeek-task-master/index.ts
/Users/WBwork/Downloads/WMSplus-main/supabase/functions/weeek-awh-writeoffs-refresh/index.ts
```

### Через Supabase Dashboard

1. Supabase Dashboard.
2. `Edge Functions`.
3. Открой `weeek-task-master`.
4. Замени код на содержимое файла `supabase/functions/weeek-task-master/index.ts`.
5. Нажми `Deploy`.
6. Нажми `Create a new function` или открой существующую `weeek-awh-writeoffs-refresh`.
7. Имя функции: `weeek-awh-writeoffs-refresh`.
8. Код: содержимое файла `supabase/functions/weeek-awh-writeoffs-refresh/index.ts`.
9. Нажми `Deploy`.
10. JWT verification должен быть выключен, если вызываешь функцию из `pg_net` без Authorization header.

### Через Supabase CLI

```bash
supabase functions deploy weeek-task-master --no-verify-jwt
supabase functions deploy weeek-awh-writeoffs-refresh --no-verify-jwt
```

## 4. Получить WEEEK ID поля `Стоимость` и option `Списания AWH`

Сначала запроси список custom fields:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'list_custom_fields',
    'project_id', '2',
    'board_id', '3'
  ),
  timeout_milliseconds := 120000
);
```

Ответ смотреть так:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 5;
```

Найди в ответе:

```text
поле: Стоимость
поле: Тип задачи
option внутри Тип задачи: Списания AWH
```

Нужны два значения:

```text
cost_field_id = a2624094-7335-45be-bcfd-9a2be15b368a
task_type_option_id = a26239ab-441c-4bdc-9001-8d1caeaf7397
```

Если option `Списания AWH` еще нет, сначала добавь его в WEEEK в поле `Тип задачи`, потом повтори `list_custom_fields`.

## 5. Тестовая подгрузка без записи в Supabase

В SQL ниже замени:

```text
WEB_APP_URL = https://script.google.com/macros/s/AKfycbwL1qAfcnekg1usRL1YIFWNwgrJiXbEr2x6Rb1BY_02xVww7OXoBQFTQS7TYUT4k4jF/exec
COST_FIELD_ID = a2624094-7335-45be-bcfd-9a2be15b368a
AWH_TASK_TYPE_OPTION_ID = a26239ab-441c-4bdc-9001-8d1caeaf7397
```

Если в Apps Script задавал секрет, добавь строку:

```sql
'apps_script_secret', 'твой_секрет',
```

Если сама Edge Function вернет `Invalid refresh secret`, добавь еще строку:

```sql
'secret', 'секрет_edge_function',
```

SQL:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-awh-writeoffs-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'api_url', 'https://script.google.com/macros/s/AKfycbwL1qAfcnekg1usRL1YIFWNwgrJiXbEr2x6Rb1BY_02xVww7OXoBQFTQS7TYUT4k4jF/exec',
    'spreadsheet_id', '1dLD7T-Nw3AlIwjaPCj9ukDc6NJvWEtPVht91Jm15Duk',
    'sheet_prefix', 'Списание',
    'lo', 'СЦ Нижний Новгород Ларина',
    'start_row', 2,
    'cost_field_id', 'a2624094-7335-45be-bcfd-9a2be15b368a',
    'task_type_option_id', 'a26239ab-441c-4bdc-9001-8d1caeaf7397',
    'dry_run', true
  ),
  timeout_milliseconds := 120000
);
```

Смотреть ответ:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 5;
```

В ответе должно быть:

```text
ok = true
dry_run = true
fetched_rows > 0
sample содержит title вида Коробка D | DD.MM.YYYY
priority = 1
due_date = сегодня + 7 дней, но для дорогих AWH срок короче: цена > 5000 минус 2 дня, цена > 10000 минус 4 дня
для закрытых исходных статусов sample.source_payload.system_auto_finalize = true
для закрытых исходных статусов sample.master_action = system_finalize
```

## 6. Боевая подгрузка в `weeek_tasks`

Убери `dry_run` или поставь `false`:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-awh-writeoffs-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'api_url', 'WEB_APP_URL',
    'spreadsheet_id', '1dLD7T-Nw3AlIwjaPCj9ukDc6NJvWEtPVht91Jm15Duk',
    'sheet_prefix', 'Списание',
    'lo', 'СЦ Нижний Новгород Ларина',
    'start_row', 2,
    'cost_field_id', 'COST_FIELD_ID',
    'task_type_option_id', 'AWH_TASK_TYPE_OPTION_ID'
  ),
  timeout_milliseconds := 120000
);
```

Проверка очереди в Supabase:

```sql
select
  source_id,
  task_type,
  title,
  priority,
  due_date,
  target_board_name,
  target_column_name,
  target_custom_fields,
  master_status,
  task_status,
  created_at,
  updated_at
from public.weeek_tasks
where source_module = 'awh_writeoffs'
order by updated_at desc
limit 20;
```

Проверка строк, которые должны закрыться системой:

```sql
select
  source_id,
  source_payload->>'status' as source_status,
  source_payload->>'system_auto_finalize' as system_auto_finalize,
  source_payload->>'system_opp_verdict' as system_opp_verdict,
  source_payload->>'system_tag_name' as system_tag_name,
  master_action,
  master_status,
  task_status
from public.weeek_tasks
where source_module = 'awh_writeoffs'
  and source_payload->>'system_auto_finalize' = 'true'
order by updated_at desc
limit 20;
```

## 7. Создать одну задачу в WEEEK для проверки

Сначала dry run мастера:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'process_queue',
    'source_module', 'awh_writeoffs',
    'limit', 1,
    'dry_run', true
  ),
  timeout_milliseconds := 120000
);
```

Если payload выглядит нормально, боевой запуск одной задачи:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'process_queue',
    'source_module', 'awh_writeoffs',
    'limit', 1
  ),
  timeout_milliseconds := 120000
);
```

Проверка:

```sql
select
  source_id,
  title,
  weeek_task_id,
  weeek_task_url,
  weeek_board_name,
  weeek_column_name,
  master_status,
  last_error
from public.weeek_tasks
where source_module = 'awh_writeoffs'
order by synced_at desc nulls last, updated_at desc
limit 10;
```

Открой `weeek_task_url`. Должно быть:

```text
Название: Коробка D | DD.MM.YYYY
Тип задачи: Списания AWH
Колонка: Списания AWH
Приоритет: средний
Дата: сегодня + 7 дней
Описание:
Тип задания: Списания на администрацию ЛО
Дата создания задания: ...

-------------------------
Инфо по заданию:
Путевой лист: ...
Кол-во ШК: ...
Время выгрузки на ЛО: ...
```

Если исходный статус был `Аннулирован`, `Списано на виновного` или `Найден`, после `process_queue` задача должна быть не в активной колонке, а сразу здесь:

```text
Доска: ❌ Неактивные задачи
Колонка: Разбор завершен
Вердикт ОПП: Найден/Релиз/Списан
Тег: Закрыто системой
```

## 8. Если задача попала не в ту колонку

Получить колонки активной доски:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'list_columns',
    'project_id', '2',
    'board_id', '3'
  ),
  timeout_milliseconds := 120000
);
```

Смотри ответ через `net._http_response`, найди ID колонки `Списания AWH` и зафиксируй его в маршруте:

```sql
update public.weeek_task_routes
set active_default_column_id = 'ID_КОЛОНКИ_СПИСАНИЯ_AWH'
where route_key = 'awh_writeoffs';
```

После этого можно переочередить ошибочные строки:

```sql
update public.weeek_tasks
set master_status = 'queued', last_error = null
where source_module = 'awh_writeoffs'
  and task_status = 'Не начато';
```

И снова запустить `process_queue`.

## 9. Cron на постоянку

Вставь свои значения:

```text```text
WEB_APP_URL = https://script.google.com/macros/s/AKfycbwL1qAfcnekg1usRL1YIFWNwgrJiXbEr2x6Rb1BY_02xVww7OXoBQFTQS7TYUT4k4jF/exec
COST_FIELD_ID = a2624094-7335-45be-bcfd-9a2be15b368a
AWH_TASK_TYPE_OPTION_ID = a26239ab-441c-4bdc-9001-8d1caeaf7397
```

Если Apps Script защищен секретом, добавь в body строку:

```sql
'apps_script_secret', 'твой_секрет',
```

Если сама Edge Function защищена секретом, добавь в body строку:

```sql
'secret', 'секрет_edge_function',
```

SQL:

```sql
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weeek-awh-writeoffs-refresh-10m') then
    perform cron.unschedule('weeek-awh-writeoffs-refresh-10m');
  end if;

  if exists (select 1 from cron.job where jobname = 'weeek-task-master-process-awh-5m') then
    perform cron.unschedule('weeek-task-master-process-awh-5m');
  end if;

  if exists (select 1 from cron.job where jobname = 'weeek-task-master-sync-awh-5m') then
    perform cron.unschedule('weeek-task-master-sync-awh-5m');
  end if;

  if exists (select 1 from cron.job where jobname = 'weeek-task-master-reopen-awh-10m') then
    perform cron.unschedule('weeek-task-master-reopen-awh-10m');
  end if;
end $$;

select cron.schedule(
  'weeek-awh-writeoffs-refresh-10m',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-awh-writeoffs-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'api_url', 'https://script.google.com/macros/s/AKfycbwL1qAfcnekg1usRL1YIFWNwgrJiXbEr2x6Rb1BY_02xVww7OXoBQFTQS7TYUT4k4jF/exec',
      'spreadsheet_id', '1dLD7T-Nw3AlIwjaPCj9ukDc6NJvWEtPVht91Jm15Duk',
      'sheet_prefix', 'Списание',
      'lo', 'СЦ Нижний Новгород Ларина',
      'start_row', 2,
      'cost_field_id', 'a2624094-7335-45be-bcfd-9a2be15b368a',
      'task_type_option_id', 'a26239ab-441c-4bdc-9001-8d1caeaf7397'
    ),
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'weeek-task-master-process-awh-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'process_queue',
      'source_module', 'awh_writeoffs',
      'limit', 10
    ),
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'weeek-task-master-sync-awh-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'sync_statuses',
      'source_module', 'awh_writeoffs',
      'limit', 20
    ),
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'weeek-task-master-reopen-awh-10m',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'reopen_due',
      'source_module', 'awh_writeoffs',
      'limit', 20
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

Проверка cron:

```sql
select jobid, jobname, schedule, active, command
from cron.job
where jobname like 'weeek-%awh%'
order by jobname;
```

## 10. Частые ошибки

`Invalid refresh secret`:

```text
У Edge Function задан WEEEK_AWH_WRITEOFFS_REFRESH_SECRET или WEEEK_INCOMING_BOXES_REFRESH_SECRET.
Добавь 'secret', 'значение_секрета' в body SQL-вызова.
```

`Invalid Apps Script secret`:

```text
В Apps Script задан AWH_WRITEOFFS_API_SECRET.
Добавь 'apps_script_secret', 'значение_секрета' в body SQL-вызова Edge Function.
```

`Apps Script returned 0 rows`:

```text
Проверь sheet_prefix, lo и доступ Apps Script аккаунта к исходной таблице.
```

`WEEEK board column "Списания AWH" not found`:

```text
Проверь, что колонка называется ровно Списания AWH на доске ❗️ Активные задачи.
Либо пропиши active_default_column_id в weeek_task_routes.
```

`custom field не заполнился`:

```text
Проверь cost_field_id и task_type_option_id через action=list_custom_fields.
После исправления запусти refresh еще раз: target_custom_fields обновятся в weeek_tasks.
```
