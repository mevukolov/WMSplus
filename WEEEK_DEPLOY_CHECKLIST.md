# Деплой WEEEK-задач: универсальная система

Этот чек-лист переводит старый поток `box_tracker` на новую универсальную систему:

- `weeek_tasks` — единая таблица задач для всех будущих модулей.
- `weeek_task_routes` — настройки маршрутов: активная доска, неактивная доска, колонки, вердикты, переоткрытие.
- `weeek-incoming-boxes-refresh` — подгрузка коробок из Google Sheets в `weeek_tasks`.
- `weeek-task-master` — общий мастер: создает задачи в WEEEK, синхронизирует вердикты, переносит, откладывает, переоткрывает.

## 0. Что важно до старта

Миграция `202607290002_weeek_tasks_full_cutover.sql` удаляет старую таблицу `box_tracker_rep` и отключает старые cron-задачи box/tracker/plane/weeek upload.

Если старые данные из `box_tracker_rep` нужны как архив, выгрузи их до запуска миграции.

## 1. Применить миграцию Supabase

Открой Supabase:

1. Project `bgphllmzmlwurfnbagho`.
2. `SQL Editor`.
3. `New query`.
4. Вставь полный текст файла:
   `supabase/migrations/202607290002_weeek_tasks_full_cutover.sql`
5. Нажми `Run`.

Проверка после миграции:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'weeek_tasks'
  and column_name in (
    'task_status',
    'reopen_after',
    'opp_verdict_synced_at',
    'opp_verdict_raw',
    'source_generated_at',
    'return_board_id',
    'return_column_id',
    'reopen_count',
    'last_transition'
  )
order by column_name;
```

Должны вернуться эти колонки.

Проверка маршрута:

```sql
select
  route_key,
  task_type,
  active_board_name,
  active_default_column_name,
  inactive_board_name,
  inactive_wait_column_name,
  inactive_done_column_name,
  reopen_after_days,
  reopen_date_field_name,
  reopened_tag_name,
  deferred_verdicts,
  final_verdicts
from public.weeek_task_routes
order by route_key;
```

Проверка, что старая таблица удалена:

```sql
select to_regclass('public.box_tracker_rep') as old_box_tracker_table;
```

Ожидаемо: `null`.

## 2. Задеплоить Edge Functions

Нужно задеплоить две функции:

- `weeek-incoming-boxes-refresh`
- `weeek-task-master`

### Вариант A: через Supabase CLI

Если на компьютере есть Supabase CLI:

```bash
supabase functions deploy weeek-incoming-boxes-refresh --no-verify-jwt
supabase functions deploy weeek-task-master --no-verify-jwt
```

### Вариант B: через Dashboard

1. Supabase Dashboard.
2. `Edge Functions`.
3. Открой функцию `weeek-incoming-boxes-refresh`.
4. Замени код на файл:
   `supabase/functions/weeek-incoming-boxes-refresh/index.ts`
5. Нажми `Deploy`.
6. Открой функцию `weeek-task-master`.
7. Замени код на файл:
   `supabase/functions/weeek-task-master/index.ts`
8. Нажми `Deploy`.
9. У обеих функций JWT verification должен быть выключен, если вызываешь их через `pg_net` без Authorization header.

## 3. Проверить Secrets / переменные функций

Минимально нужны:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEEEK_API_KEY`
- `WEEEK_WORKSPACE_ID=1021782`
- `WEEEK_PROJECT_ID=2`

Опционально:

- `WEEEK_TASK_MASTER_SECRET`
- `WEEEK_INCOMING_BOXES_REFRESH_SECRET`
- `WEEEK_OPP_VERDICT_FIELD_NAME=Вердикт ОПП`
- `WEEEK_REOPEN_AFTER_FIELD_NAME=Дата переоткрытия`

Если задаешь custom secret, то во всех SQL-вызовах функций добавляй поле `secret` в body.

## 4. Получить ID досок WEEEK

Запусти в Supabase `SQL Editor`:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'list_boards',
    'project_id', '2'
  ),
  timeout_milliseconds := 120000
);
```

Посмотреть ответ:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 5;
```

В ответе найди ID досок:

- `❗️ Активные задачи`
- `❌ Неактивные задачи`

## 5. Получить ID колонок досок

Для активной доски:

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

Для неактивной доски:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'list_columns',
    'project_id', '2',
    'board_id', '7'
  ),
  timeout_milliseconds := 120000
);
```

Ответы смотреть так же:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 5;
```

Нужны колонки:

- В активной доске: `Коробки на входе`.
- В неактивной доске: `Ожидание`.
- В неактивной доске: `Разбор завершен`.

## 6. Получить ID поля `Дата переоткрытия`

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'list_custom_fields',
    'project_id', '2',
    'board_id', '7'
  ),
  timeout_milliseconds := 120000
);
```

Смотри ответ:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 5;
```

Найди поле `Дата переоткрытия` и возьми его `id`.

## 7. Заполнить маршрут `incoming_boxes`

```sql
update public.weeek_task_routes
set
  active_board_id = '3',
  active_default_column_id = '7',
  inactive_board_id = '7',
  inactive_wait_column_id = '22',
  inactive_done_column_id = '23',
  reopen_date_field_id = 'a25fe442-940f-4bd9-86c0-eeb25de06655'
where route_key = 'incoming_boxes';
```

Проверить:

```sql
select *
from public.weeek_task_routes
where route_key = 'incoming_boxes';
```

## 8. Тест подгрузки коробок из Google Sheets

Тест без записи:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-incoming-boxes-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'dry_run', true,
    'api_url', 'https://script.google.com/macros/s/AKfycbzv1mj4Ocy_kpEWxZUq9z34sei89sbdh2CzvyLQg9SgxqoqnC12swvHTMWa_YCAIfxZ/exec',
    'spreadsheet_id', '1ROHRk93V-Jy8LmS_77ivmdWvd65YsXR7aad1DDhPB6I',
    'sheet_name', 'Разбор',
    'start_row', 3,
    'request_timeout_ms', 120000
  ),
  timeout_milliseconds := 120000
);
```

Если в ответе `ok=true`, запускай запись:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-incoming-boxes-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'api_url', 'https://script.google.com/macros/s/AKfycbzv1mj4Ocy_kpEWxZUq9z34sei89sbdh2CzvyLQg9SgxqoqnC12swvHTMWa_YCAIfxZ/exec',
    'spreadsheet_id', '1ROHRk93V-Jy8LmS_77ivmdWvd65YsXR7aad1DDhPB6I',
    'sheet_name', 'Разбор',
    'start_row', 3,
    'request_timeout_ms', 120000
  ),
  timeout_milliseconds := 120000
);
```

Проверка очереди в Supabase:

```sql
select
  source_module,
  task_type,
  board_key,
  master_status,
  task_status,
  count(*)
from public.weeek_tasks
group by 1, 2, 3, 4, 5
order by 1, 2, 3, 4, 5;
```

## 9. Тест мастера WEEEK

Посмотреть очередь:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'list_queue',
    'source_module', 'incoming_boxes',
    'limit', 5
  ),
  timeout_milliseconds := 120000
);
```

Тест без создания задачи:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'process_queue',
    'dry_run', true,
    'source_module', 'incoming_boxes',
    'limit', 1
  ),
  timeout_milliseconds := 120000
);
```

Создать/обновить одну задачу в WEEEK:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'process_queue',
    'source_module', 'incoming_boxes',
    'limit', 1
  ),
  timeout_milliseconds := 120000
);
```

Проверить созданную задачу:

```sql
select
  source_id,
  title,
  master_status,
  task_status,
  weeek_task_id,
  weeek_task_url,
  last_error
from public.weeek_tasks
where source_module = 'incoming_boxes'
order by updated_at desc
limit 10;
```

## 10. Тест отложенного сценария

1. Открой созданную задачу в WEEEK.
2. В поле `Вердикт ОПП` выбери `Отправлен запрос`.
3. Отметь задачу выполненной галочкой.
4. Запусти синхронизацию:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'sync_statuses',
    'source_module', 'incoming_boxes',
    'limit', 5
  ),
  timeout_milliseconds := 120000
);
```

Ожидаемо:

- В Supabase `task_status = 'Отложено'`.
- `reopen_after` заполнен на +2 дня.
- Задача переехала в `❌ Неактивные задачи` -> `Ожидание`.
- Поле `Дата переоткрытия` заполнено.

Проверка:

```sql
select
  source_id,
  opp_verdict,
  task_status,
  reopen_after,
  weeek_board_name,
  weeek_column_name,
  last_error
from public.weeek_tasks
where source_module = 'incoming_boxes'
order by updated_at desc
limit 10;
```

## 11. Тест переоткрытия

Для тестовой задачи можно временно поставить `reopen_after` в прошлое:

```sql
update public.weeek_tasks
set reopen_after = now() - interval '1 minute'
where source_module = 'incoming_boxes'
  and task_status = 'Отложено'
  and source_id = '<BOX_NUMBER>';
```

Запустить переоткрытие:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'reopen_due',
    'limit', 5
  ),
  timeout_milliseconds := 120000
);
```

Ожидаемо:

- `task_status = 'Не начато'`.
- `reopen_after = null`.
- `reopen_count` увеличился.
- Задача вернулась в активную доску.

## 12. Тест финального сценария

1. В WEEEK выбери `Вердикт ОПП = Найден/Релиз/Списан` или `Нет на МХ/Не найден`.
2. Отметь задачу выполненной.
3. Запусти `sync_statuses`.

Ожидаемо:

- `task_status = 'Завершено'`.
- Задача переехала в `❌ Неактивные задачи` -> `Разбор завершен`.
- `reopen_after` пустой.

## 13. Включить cron только после ручных тестов

Подгрузка Google Sheets в Supabase каждые 10 минут:

```sql
select cron.schedule(
  'weeek-incoming-boxes-refresh-10m',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-incoming-boxes-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'api_url', 'https://script.google.com/macros/s/AKfycbzv1mj4Ocy_kpEWxZUq9z34sei89sbdh2CzvyLQg9SgxqoqnC12swvHTMWa_YCAIfxZ/exec',
      'spreadsheet_id', '1ROHRk93V-Jy8LmS_77ivmdWvd65YsXR7aad1DDhPB6I',
      'sheet_name', 'Разбор',
      'start_row', 3,
      'request_timeout_ms', 120000
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

Мастер создания/обновления задач каждые 5 минут:

```sql
select cron.schedule(
  'weeek-task-master-process-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'process_queue',
      'source_module', 'incoming_boxes',
      'limit', 20
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

Синхронизация статусов из WEEEK каждые 10 минут:

```sql
select cron.schedule(
  'weeek-task-master-sync-10m',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'sync_statuses',
      'source_module', 'incoming_boxes',
      'limit', 20
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

Переоткрытие отложенных задач каждые 10 минут:

```sql
select cron.schedule(
  'weeek-task-master-reopen-10m',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'reopen_due',
      'limit', 20
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

## 14. Проверка cron

```sql
select jobid, jobname, schedule, active, command
from cron.job
where jobname like 'weeek-%'
order by jobname;
```

Последние HTTP-ответы:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 20;
```

Очередь и ошибки:

```sql
select
  source_module,
  master_status,
  task_status,
  count(*)
from public.weeek_tasks
group by 1, 2, 3
order by 1, 2, 3;
```

```sql
select source_id, title, master_status, task_status, last_error, updated_at
from public.weeek_tasks
where last_error is not null
order by updated_at desc
limit 30;
```

## 15. Старые функции, которые больше не нужны

После успешного теста можно удалить старые Edge Functions:

- `box-tracker-refresh`
- `box-tracker-queue`
- `box-tracker-upload`
- `box-plane-upload`
- `box-weeek-upload`

Не удаляй функции ОПП/Telegram/cache. Они к этой миграции не относятся.
