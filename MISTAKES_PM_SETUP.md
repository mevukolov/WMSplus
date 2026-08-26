# Mistakes PM sync (Apps Script + Supabase Edge)

Документ описывает загрузку источника "Ошибки ПМ" в `public.mistakes_rep`.

Логика:
- Google Sheets -> Apps Script Web App
- Supabase Edge Function по cron забирает JSON из Apps Script
- Edge Function делает `upsert` в `mistakes_rep`
- фронт читает `mistakes_rep` как кэш

## 1) Применить миграцию

Нужна миграция:
- `supabase/migrations/202604160001_mistakes_rep.sql`

Она:
- создаёт `public.mistakes_rep`, если таблицы ещё нет
- добавляет уникальный индекс для безопасного повторного `upsert`
- включает чтение для `anon` и `authenticated`

## 2) Apps Script

Файл:
- `google_apps_script_mistakes_pm_api.gs`

Что делает скрипт:
- читает 5 колонок листа
- пропускает пустые строки
- пропускает строки без обязательных полей
- сразу приводит запись к формату `mistakes_rep`

Маппинг:
- `A -> date_logged`
- `B -> shk`
- `C -> logger_comment` как `Маршрут: {значение}`
- `D -> date`
- `E -> emp`

Автозаполнение:
- `emp_workplace = ПМ`
- `mistake = Бессистемная отгрузка передачи ПМ`
- `emp_logger = 2405`

Рекомендуемый порядок:
1. Откройте Apps Script для нужной Google-таблицы.
2. Вставьте содержимое `google_apps_script_mistakes_pm_api.gs`.
3. Задеплойте как Web App.
4. Дайте доступ `Anyone with the link`.

Скрипт принимает параметры:
- `spreadsheet_id`
- `sheet_name`
- `start_row`

Для вашей таблицы можно передавать:
- `spreadsheet_id = 18Hx5321cI19kq6EFWraSsnUxqTOiUv-ESOn6bBcBWeo`

## 3) Deploy Edge Function

Функция:
- `supabase/functions/mistakes-pm-refresh/index.ts`

Деплой:

```bash
supabase functions deploy mistakes-pm-refresh --no-verify-jwt
```

Если `Verify JWT` включается через UI, отключите его.

## 4) Конфиг без secrets

Для функции `mistakes-pm-refresh` secrets не нужны.

Конфиг передаётся в `POST`-body:
- `api_url` (обязательно) - URL Apps Script Web App (`/exec`)
- `spreadsheet_id` (опционально, по умолчанию `18Hx5321cI19kq6EFWraSsnUxqTOiUv-ESOn6bBcBWeo`)
- `sheet_name` (опционально, если нужен не первый лист)
- `start_row` (опционально, по умолчанию `2`)
- `request_timeout_ms` (опционально, по умолчанию `120000`)
- `dry_run` (опционально, по умолчанию `false`)
- `prune_stale` (опционально, по умолчанию `true`)
- `allow_empty_sync` (опционально, по умолчанию `false`)

## 5) Ручная проверка

Dry run:

```bash
curl -X POST "https://<PROJECT-REF>.functions.supabase.co/mistakes-pm-refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "api_url": "https://script.google.com/macros/s/<SCRIPT_ID>/exec",
    "spreadsheet_id": "18Hx5321cI19kq6EFWraSsnUxqTOiUv-ESOn6bBcBWeo",
    "sheet_name": "<SHEET_NAME>",
    "start_row": 2,
    "dry_run": true
  }'
```

Боевой запуск:

```bash
curl -X POST "https://<PROJECT-REF>.functions.supabase.co/mistakes-pm-refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "api_url": "https://script.google.com/macros/s/<SCRIPT_ID>/exec",
    "spreadsheet_id": "18Hx5321cI19kq6EFWraSsnUxqTOiUv-ESOn6bBcBWeo",
    "sheet_name": "<SHEET_NAME>",
    "start_row": 2
  }'
```

## 6) Автообновление 4 раза в сутки

Если `pg_cron` у проекта работает в `Europe/Moscow`, используйте:

```sql
select cron.schedule(
  'mistakes-pm-refresh-4x-msk',
  '0 1,9,13,21 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT-REF>.functions.supabase.co/mistakes-pm-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{
      "api_url":"https://script.google.com/macros/s/<SCRIPT_ID>/exec",
      "spreadsheet_id":"18Hx5321cI19kq6EFWraSsnUxqTOiUv-ESOn6bBcBWeo",
      "sheet_name":"<SHEET_NAME>",
      "start_row":2
    }'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

Если `pg_cron` остался в `UTC`, используйте эквивалент московского расписания:

```sql
select cron.schedule(
  'mistakes-pm-refresh-4x-utc',
  '0 22,6,10,18 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT-REF>.functions.supabase.co/mistakes-pm-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{
      "api_url":"https://script.google.com/macros/s/<SCRIPT_ID>/exec",
      "spreadsheet_id":"18Hx5321cI19kq6EFWraSsnUxqTOiUv-ESOn6bBcBWeo",
      "sheet_name":"<SHEET_NAME>",
      "start_row":2
    }'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

Перед созданием новой задачи удобно удалить старую:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname in ('mistakes-pm-refresh-4x-msk', 'mistakes-pm-refresh-4x-utc');
```

## 7) Что делает sync

Функция:
- читает актуальный снимок из Google Sheets через Apps Script
- делает `upsert` в `mistakes_rep`
- удаляет устаревшие записи только в срезе PM-ошибок
- по умолчанию не принимает пустой ответ источника, чтобы случайно не очистить кэш

Фильтр PM-среза для очистки:
- `emp_workplace = ПМ`
- `mistake = Бессистемная отгрузка передачи ПМ`
- `emp_logger = 2405`

## 8) Проверка в базе

```sql
select *
from public.mistakes_rep
where emp_workplace = 'ПМ'
  and mistake = 'Бессистемная отгрузка передачи ПМ'
order by date_logged desc, date desc
limit 100;
```

Проверка ответов `pg_net`:

```sql
select id, status_code, error_msg, created
from net._http_response
order by created desc
limit 20;
```
