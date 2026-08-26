# WMS+ Task Writeback

Обратная запись результатов из WMS+ включена только для модуля:

- `Запросы входящего потока`

`Списания AWH` и `Коробки на входе` в WMS+ только считываются. Их исходные Google Sheets через этот контур не изменяются.

## 1. Apps Script

Для обратной записи нужен только опубликованный Web App из файла:

```text
google_apps_script_incoming_flow_requests_api.gs
```

Файлы ниже остаются read-only и должны использоваться только для чтения данных:

```text
google_apps_script_awh_writeoffs_api.gs
google_apps_script_box_tracker_api.gs
```

## 2. Edge Function

Создай или обнови Supabase Edge Function:

```text
supabase/functions/wms-task-writeback/index.ts
```

CLI:

```bash
supabase functions deploy wms-task-writeback
```

Если вызываешь без пользовательской Supabase-сессии, можно деплоить без JWT verification:

```bash
supabase functions deploy wms-task-writeback --no-verify-jwt
```

## 3. Secrets

Минимально нужен URL Apps Script для входящих запросов:

```text
INCOMING_FLOW_REQUESTS_APPS_SCRIPT_URL = https://script.google.com/macros/s/.../exec
```

Если в Apps Script задан секрет, добавь такой же в Supabase:

```text
INCOMING_FLOW_REQUESTS_APPS_SCRIPT_SECRET = ...
```

Опционально можно защитить саму Edge Function:

```text
WMS_TASK_WRITEBACK_SECRET = ...
```

Тогда в браузере один раз сохрани этот же секрет:

```js
localStorage.setItem("wms_task_writeback_secret", "...");
```

## 4. Что куда пишется

`Запросы входящего потока`:

- `H` = Вложение
- `I` = Комментарий ОПП
- `J` = сотрудник ОПП
- `K` = ID виновного

