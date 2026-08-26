# Universal WEEEK Tasks

Новая архитектура:

```text
Google Sheets / другие источники
  -> module Edge Functions
  -> public.weeek_tasks
  -> weeek-task-master
  -> WEEEK
  <- weeek-task-master syncs actual WEEEK state
```

`public.weeek_tasks` - общая таблица задач для всех будущих автоматизаций WEEEK.

`box_tracker_rep` больше не используется и удаляется миграцией `202607290002_weeek_tasks_full_cutover.sql`.

## 1. Главная идея

Любой модуль пишет в `public.weeek_tasks` только желательное состояние задачи:

- источник задачи;
- тип задачи;
- на какой доске задача должна быть;
- в какой колонке задача должна быть;
- заголовок, описание, дедлайн, приоритет;
- кого назначить;
- какие данные источника сохранить в `source_payload`.

Модуль подгрузки не выставляет `Вердикт ОПП`.

`Вердикт ОПП` выставляет пользователь в WEEEK. Потом `weeek-task-master` синхронизирует его обратно в Supabase.

По умолчанию мастер ищет `Вердикт ОПП` как custom field с названием `Вердикт ОПП`.

Если в WEEEK это не custom field, а настоящий статус/колонка, можно задать переменную:

```text
WEEEK_OPP_VERDICT_SOURCE=status
```

Если нужно сначала искать custom field, а потом пробовать статус/колонку:

```text
WEEEK_OPP_VERDICT_SOURCE=auto
```

## 2. Новые поля

Ключевые поля:

```text
source_module - модуль-источник, например incoming_boxes
source_id - уникальный id внутри модуля, например номер коробки
task_type - тип задачи, например Коробки на входе
board_key - внутренняя метка доски, например incoming_boxes
column_key - внутренняя метка колонки
opp_verdict - Вердикт ОПП из WEEEK, не из Google Sheets
task_status - системный статус задания: Не начато / Отложено / Завершено
reopen_after - когда отложенную задачу нужно вернуть в работу
```

Уникальность:

```text
source_module + source_id + task_type
```

Списки вердиктов для системного `task_status` можно расширять переменными:

```text
WEEEK_COMPLETED_VERDICTS=Завершено,Готово,Выполнено
WEEEK_DEFERRED_VERDICTS=Отложено,Пауза
WEEEK_NOT_STARTED_VERDICTS=Не выбран,Новая,Не начато
```

## 3. Новые Edge Functions

### weeek-incoming-boxes-refresh

Назначение: читает Google Sheets через Apps Script API и сразу пишет строки в `public.weeek_tasks`.

Она не пишет в `box_tracker_rep`, потому что этой таблицы больше нет.

Пример теста:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-incoming-boxes-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'api_url', 'https://script.google.com/macros/s/AKfycbzv1mj4Ocy_kpEWxZUq9z34sei89sbdh2CzvyLQg9SgxqoqnC12swvHTMWa_YCAIfxZ/exec',
    'spreadsheet_id', '1ROHRk93V-Jy8LmS_77ivmdWvd65YsXR7aad1DDhPB6I',
    'sheet_name', 'Разбор',
    'start_row', 3,
    'dry_run', true
  ),
  timeout_milliseconds := 120000
);
```

Боевой запуск:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-incoming-boxes-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'api_url', 'https://script.google.com/macros/s/AKfycbzv1mj4Ocy_kpEWxZUq9z34sei89sbdh2CzvyLQg9SgxqoqnC12swvHTMWa_YCAIfxZ/exec',
    'spreadsheet_id', '1ROHRk93V-Jy8LmS_77ivmdWvd65YsXR7aad1DDhPB6I',
    'sheet_name', 'Разбор',
    'start_row', 3
  ),
  timeout_milliseconds := 120000
);
```

### weeek-task-master

Назначение: единая функция управления WEEEK.

Действия:

```text
action=list_queue
action=process_queue
action=sync_statuses
action=reopen_due
action=list_columns
```

Тест очереди:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'list_queue',
    'source_module', 'incoming_boxes',
    'limit', 10
  ),
  timeout_milliseconds := 120000
);
```

Тест создания/обновления задач без записи в WEEEK:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'action', 'process_queue',
    'source_module', 'incoming_boxes',
    'limit', 3,
    'dry_run', true
  ),
  timeout_milliseconds := 120000
);
```

Боевой запуск создания/обновления:

```sql
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
```

Синхронизация Вердикта ОПП из WEEEK:

```sql
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
```

## 4. Cron для новой системы

Сначала отключить старые crons уже умеет миграция `202607290002_weeek_tasks_full_cutover.sql`.

Новые crons:

```sql
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weeek-incoming-boxes-refresh-10m') then
    perform cron.unschedule('weeek-incoming-boxes-refresh-10m');
  end if;

  if exists (select 1 from cron.job where jobname = 'weeek-task-master-process-5m') then
    perform cron.unschedule('weeek-task-master-process-5m');
  end if;

  if exists (select 1 from cron.job where jobname = 'weeek-task-master-sync-10m') then
    perform cron.unschedule('weeek-task-master-sync-10m');
  end if;

  if exists (select 1 from cron.job where jobname = 'weeek-task-master-reopen-10m') then
    perform cron.unschedule('weeek-task-master-reopen-10m');
  end if;
end $$;

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
      'start_row', 3
    ),
    timeout_milliseconds := 120000
  );
  $$
);

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
      'limit', 30
    ),
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'weeek-task-master-reopen-10m',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'reopen_due',
      'limit', 50
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

## 5. Проверки

Очередь по статусам:

```sql
select
  source_module,
  task_type,
  board_key,
  master_status,
  task_status,
  count(*) as qty
from public.weeek_tasks
group by source_module, task_type, board_key, master_status, task_status
order by source_module, task_type, board_key, master_status, task_status;
```

Вердикты ОПП:

```sql
select
  opp_verdict,
  task_status,
  count(*) as qty
from public.weeek_tasks
group by opp_verdict, task_status
order by qty desc;
```

Отложенные задачи:

```sql
select
  source_module,
  source_id,
  title,
  opp_verdict,
  task_status,
  reopen_after,
  weeek_task_url
from public.weeek_tasks
where task_status = 'Отложено'
order by reopen_after nulls last, updated_at desc
limit 100;
```

## 6. Что удаляем из старого

Старые Edge Functions больше не нужны:

```text
box-tracker-refresh
box-tracker-queue
box-tracker-upload
box-plane-upload
box-weeek-upload
```

Старая таблица больше не нужна:

```text
public.box_tracker_rep
```

Старые исходники этих Edge Functions удалены из проекта. В Supabase их ещё нужно удалить/не деплоить вручную, если они уже были задеплоены ранее.
