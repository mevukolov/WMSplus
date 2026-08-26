# Открытие смены: установка

Модуль добавляет отдельный iframe с формой открытия смены.

Поток работы:

1. iframe в Apps Script показывает кнопку `Открыть смену дд.мм.гг`.
2. Пользователь выбирает ответственных за `Исходящий поток` и `Входящий поток` из `weeek_employees`.
3. Пользователь выбирает файл в блоке `Добавить данные по чистым списаниям`.
4. Apps Script вызывает Edge Function `weeek-shift-opening`.
5. Edge Function пишет смену в `weeek_shifts`.
6. Если смена за текущую дату уже есть, iframe только показывает ответственных и не открывает дубль.

## 1. Создать таблицы

В Supabase SQL Editor выполни миграцию:

```sql
-- файл: supabase/migrations/202608050001_weeek_shift_opening.sql
```

Можно открыть файл и вставить его полностью в SQL Editor.

## 2. Заполнить сотрудников

Пример. `employee_id` должен быть уникальным. `telegram` и `weeek_user_id` можно временно оставить пустыми.

```sql
insert into public.weeek_employees (employee_id, full_name, telegram, weeek_user_id, is_active)
values
  ('205912', 'Воронова Алена', null, null, true),
  ('250626', 'Пахомова Виктория', null, null, true),
  ('360763', 'Ткачева Ксения', null, null, true),
  ('877894', 'Мусаев Роман', null, null, true),
  ('1034305', 'Вуколов Максим', null, null, true)
on conflict (employee_id) do update set
  full_name = excluded.full_name,
  telegram = excluded.telegram,
  weeek_user_id = excluded.weeek_user_id,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());
```

Проверка:

```sql
select id, employee_id, full_name, telegram, weeek_user_id, is_active
from public.weeek_employees
order by full_name;
```

## 3. Деплой Edge Function

Файл функции:

```text
supabase/functions/weeek-shift-opening/index.ts
```

Если деплоишь через Supabase CLI:

```bash
supabase functions deploy weeek-shift-opening --no-verify-jwt
```

Секреты Edge Function:

```bash
supabase secrets set WEEEK_SHIFT_OPENING_SECRET='50144199'
```

Если делаешь без CLI, то в Supabase Dashboard:

1. Edge Functions.
2. New Function или открыть существующую `weeek-shift-opening`.
3. Вставить код из `supabase/functions/weeek-shift-opening/index.ts`.
4. Deploy.
5. В Project Settings -> Edge Functions -> Secrets добавить `WEEEK_SHIFT_OPENING_SECRET`.

## 4. Проверить Edge Function через SQL

Получить состояние смены:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-shift-opening',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '50144199',
    'action', 'get_state',
    'wh_id', '50144199'
  ),
  timeout_milliseconds := 120000
);
```

Посмотреть ответ последнего запроса:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by id desc
limit 10;
```

## 5. Создать Apps Script Web App

Создай отдельный Google Apps Script проект.

Файлы:

1. `Code.gs` -> вставить содержимое `google_apps_script_weeek_shift_opening.gs`.
2. `WeeekShiftOpening.html` -> вставить содержимое `WeeekShiftOpening.html`.

Script Properties:

```text
WEEEK_SHIFT_OPENING_FUNCTION_URL = https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-shift-opening
WEEEK_SHIFT_OPENING_SECRET = 50144199
SHIFT_OPENING_IFRAME_TOKEN = любой_секрет_для_iframe
```

`SHIFT_OPENING_IFRAME_TOKEN` можно не задавать, тогда iframe будет доступен без токена. Лучше задать.

## 6. Развернуть Web App

В Apps Script:

1. Deploy.
2. New deployment.
3. Type: Web app.
4. Execute as: Me.
5. Who has access: Anyone with the link или подходящий внутренний доступ.
6. Deploy.

URL iframe:

```html
<iframe
  src="https://script.google.com/macros/s/AKfycbyT_u3F87m-2unDN0m8GJr_XLs-wMwh-C9RLvYmEnj34rJfBOIH95eJxsrfKG75YxgF/exec?token=любой_секрет_для_iframe&wh_id=50144199"
  style="width:100%;height:520px;border:0;border-radius:20px;"
></iframe>
```

## 7. Проверить открытые смены

```sql
select
  s.shift_date,
  s.shift_label,
  i.full_name as incoming_employee,
  o.full_name as outgoing_employee,
  s.file_uploaded,
  s.file_name,
  s.opened_at,
  s.status
from public.weeek_shifts s
join public.weeek_employees i on i.id = s.incoming_employee_id
join public.weeek_employees o on o.id = s.outgoing_employee_id
order by s.shift_date desc, s.opened_at desc
limit 20;
```

## 8. Автоназначение исполнителей задач

Дополнительная миграция:

```sql
-- файл: supabase/migrations/202608050002_weeek_shift_task_assignees.sql
-- актуальный фикс поверх нее: supabase/migrations/202608060001_weeek_reassign_unapplied_assignees.sql
```

Она добавляет:

- `assign_weeek_shift_task_assignees(...)` - назначает исполнителей задачам по открытой смене.
- защитный trigger, чтобы refresh-модули не очищали уже назначенных исполнителей.

Логика:

- `incoming_boxes`, `incoming_flow_requests`, `koledino_27lr` -> ответственный за `Входящий поток`.
- `awh_writeoffs` -> ответственный за `Исходящий поток`.
- Берутся только незавершенные задачи без фактического исполнителя в WEEEK (`weeek_assignee_ids` пустой).
- Если в Supabase остался старый `target_assignee_ids`, но в WEEEK исполнитель не применился, задача переназначается на ответственного текущей смены.
- `Запросы входящего потока` берутся сразу, даже если `due_date` еще впереди.
- Остальные типы берутся с `due_date <= дата смены`, чтобы новая смена могла забрать старые незавершенные хвосты без исполнителя.
- Если дата смены сегодня и московское время уже `20:00` или позже, назначение не происходит.

Проверь, что у сотрудников заполнен `weeek_user_id`:

```sql
select full_name, employee_id, weeek_user_id, is_active
from public.weeek_employees
where is_active = true
order by full_name;
```

Ручной запуск назначения по сегодняшней смене:

```sql
select public.assign_weeek_shift_task_assignees(
  p_wh_id := '50144199',
  p_shift_date := (timezone('Europe/Moscow', now()))::date
);
```

Посмотреть задачи, которым назначение уже поставлено в очередь:

```sql
select
  source_module,
  task_type,
  source_id,
  due_date,
  target_assignee_ids,
  master_action,
  master_status,
  weeek_task_id
from public.weeek_tasks
where target_assignee_ids <> '{}'::text[]
order by updated_at desc
limit 30;
```

После этого нужно применить очередь в WEEEK:

```sql
select net.http_post(
  url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object(
    'secret', '50144199',
    'action', 'process_queue',
    'limit', 20
  ),
  timeout_milliseconds := 120000
);
```

Если `process_queue` уже стоит кроном, отдельный cron добавлять не нужно. Если такого крона нет, можно поставить:

```sql
select cron.schedule(
  'weeek-task-master-process-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'secret', '50144199',
      'action', 'process_queue',
      'limit', 20
    ),
    timeout_milliseconds := 120000
  );
  $$
);
```

Важно: для уже созданных задач `weeek-task-master` с `master_action = assign_members` отправляет в WEEEK только список исполнителей (`members`). Остальные данные задачи не перезаписываются.

## Важное ограничение текущей версии

Файл в форме пока не загружается в Supabase и не парсится. Сейчас модуль только требует выбрать файл и сохраняет `file_uploaded=true` + `file_name` в `weeek_shifts`. Саму обработку файла можно добавить следующим экраном/шагом.
