# WEEEK Tasks Final Spec

Цель: перейти от старой схемы `box_tracker_rep` и прямых интеграций к универсальной системе задач WEEEK.

## 1. Общая архитектура

```text
Google Sheets / другие источники
  -> модуль подгрузки
  -> public.weeek_tasks
  -> weeek-task-master
  -> WEEEK
  <- weeek-task-master синхронизирует фактическое состояние обратно в Supabase
```

`weeek_tasks` - единая таблица контроля задач.

Каждый модуль только создает или обновляет желательное состояние задачи в Supabase.

Только `weeek-task-master` общается с WEEEK и решает:

- создать задачу;
- обновить задачу;
- перенести задачу между досками;
- синхронизировать `Вердикт ОПП`;
- вычислить системный `task_status`;
- отложить задачу;
- переоткрыть задачу;
- окончательно закрыть задачу.

## 2. Старое отключаем

Старые сущности уходят полностью:

```text
public.box_tracker_rep
box-tracker-refresh
box-tracker-queue
box-tracker-upload
box-plane-upload
box-weeek-upload
```

Tracker и Plane не поддерживаем.

Старая прямая заливка в WEEEK тоже не используется. В WEEEK ходит только `weeek-task-master`.

## 3. Доски WEEEK

Есть две доски:

```text
❗️ Активные задачи
❌ Неактивные задачи
```

Новые задачи мастер создает в `❗️ Активные задачи`.

В Supabase нужно хранить не только человекочитаемые названия, но и ID:

```text
active_board_id
active_board_name
inactive_board_id
inactive_board_name
```

Названия с emoji нельзя использовать как единственный ключ логики.

## 4. Базовые поля задачи

В `weeek_tasks` нужны:

```text
source_module
source_table
source_id
source_row_id
source_payload
source_generated_at

task_type
board_key
column_key

title
description
priority
due_date

opp_verdict
opp_verdict_raw
opp_verdict_synced_at

task_status
reopen_after

return_board_id
return_board_name
return_column_id
return_column_name

reopen_count
deferred_at
reopened_at
finalized_at

weeek_task_id
weeek_task_url
weeek_workspace_id
weeek_project_id
weeek_board_id
weeek_board_name
weeek_column_id
weeek_column_name
weeek_completed
weeek_deleted
weeek_updated_at
synced_at

master_status
master_action
last_transition
last_error
last_request
last_response
```

## 4.1. Формат описания в WEEК

Модули подгрузки пишут в `description` только содержательную часть задания.

Финальное форматированное описание для WEEК собирает `weeek-task-master`.

Шаблон:

```text
_тип задания_
Дата создания задания: ДД.ММ.ГГГГ ЧЧ:ММ

-------------------------
Инфо по заданию:
...
```

Пример:

```text
_коробки на входе_
Дата создания задания: 30.07.2026 14:35

-------------------------
Инфо по заданию:
Старший входящего потока: Иван
Комментарий входящего потока: Коробка без движения
Кол-во ШК: 12
```

Дата создания берется из `weeek_tasks.created_at`, чтобы она не менялась при повторной синхронизации Google Sheets.

## 5. Вердикт ОПП

`Вердикт ОПП` выставляется пользователем в WEEEK.

Модули подгрузки не имеют права задавать или перетирать `opp_verdict`.

`weeek-task-master` читает `Вердикт ОПП` из WEEEK и записывает его в Supabase.

Источник вердикта может быть:

```text
custom_field
status
auto
```

По умолчанию лучше считать, что это custom field `Вердикт ОПП`.

Если окажется, что в WEEEK это настоящий статус или колонка, используем режим `status` или `auto`.

## 6. Системный task_status

В Supabase есть системный статус:

```text
Не начато
Отложено
Завершено
```

Новая задача:

```text
task_status = Не начато
opp_verdict = Не выбран
reopen_after = null
```

## 7. Отложенные вердикты

Если сотрудник в WEEEK:

```text
ставит Вердикт ОПП:
- Отправлен на релиз
- Отправлен на списание ревизией
- Отправлен запрос

и отмечает задачу как завершенную в интерфейсе
```

То `weeek-task-master` должен:

```text
opp_verdict = актуальный вердикт из WEEК
task_status = Отложено
reopen_after = now + 2 дня
deferred_at = now
last_transition = deferred
```

Перед переносом нужно сохранить, откуда задача ушла:

```text
return_board_id = текущая активная доска
return_board_name = текущая активная доска
return_column_id = текущая колонка активной доски
return_column_name = текущая колонка активной доски
```

После этого в WEEК:

```text
перенести задачу в ❌ Неактивные задачи
колонка: Ожидание
заполнить custom field: Дата переоткрытия = reopen_after
```

## 8. Переоткрытие

Когда наступает `reopen_after`, `weeek-task-master` должен:

```text
task_status = Не начато
reopen_after = null
reopen_count = reopen_count + 1
reopened_at = now
last_transition = reopened
```

В WEEК:

```text
перенести задачу обратно в ❗️ Активные задачи
вернуть в исходный столбец из return_column_id / return_column_name
снять галочку завершения
добавить тег: Переоткрытое задание
```

## 9. Финальные вердикты

Если сотрудник в WEEК:

```text
ставит Вердикт ОПП:
- Найден/Релиз/Списан
- Нет на МХ/Не найден

и отмечает задачу как завершенную в интерфейсе
```

То `weeek-task-master` должен:

```text
opp_verdict = актуальный вердикт из WEEК
task_status = Завершено
reopen_after = null
finalized_at = now
last_transition = finalized
```

В WEEК:

```text
перенести задачу в ❌ Неактивные задачи
колонка: Разбор завершен
```

Такая задача не переоткрывается.

## 10. Нераспознанный завершенный кейс

Если задача отмечена завершенной в WEEК, но:

```text
Вердикт ОПП пустой
или Вердикт ОПП не входит в известные списки
```

Мастер не должен переносить задачу.

Нужно поставить:

```text
master_status = needs_attention
last_error = Задача завершена, но Вердикт ОПП не распознан
```

Так задача не потеряется.

## 11. Настройки маршрутов

Нужна отдельная таблица настроек маршрутов:

```text
weeek_task_routes
```

Поля:

```text
route_key
task_type

active_board_id
active_board_name
active_default_column_id
active_default_column_name

inactive_board_id
inactive_board_name
inactive_wait_column_id
inactive_wait_column_name
inactive_done_column_id
inactive_done_column_name

reopen_after_days
reopen_date_field_id
reopen_date_field_name

reopened_tag_id
reopened_tag_name

deferred_verdicts
final_verdicts
not_started_verdicts
```

Это нужно, чтобы не зашивать конкретные доски, колонки и вердикты в код.

Для коробок первый маршрут:

```text
route_key = incoming_boxes
task_type = Коробки на входе
active_board_name = ❗️ Активные задачи
inactive_board_name = ❌ Неактивные задачи
inactive_wait_column_name = Ожидание
inactive_done_column_name = Разбор завершен
reopen_after_days = 2
reopen_date_field_name = Дата переоткрытия
reopened_tag_name = Переоткрытое задание
```

## 12. Подгрузка коробок

Модуль подгрузки коробок:

```text
weeek-incoming-boxes-refresh
```

Он читает Google Sheets через Apps Script API и пишет сразу в `weeek_tasks`.

Он не пишет в `box_tracker_rep`.

Он не задает `opp_verdict`.

Он не задает `task_status`, кроме дефолта `Не начато` при создании новой задачи.

Идентификатор задачи:

```text
source_module = incoming_boxes
source_id = номер коробки
task_type = Коробки на входе
```

## 13. Дальнейшая реализация

Правильный порядок:

```text
1. Финальная миграция:
   - дорасширить weeek_tasks
   - создать weeek_task_routes
   - создать event log при необходимости
   - отключить старые crons
   - удалить box_tracker_rep

2. Новая weeek-incoming-boxes-refresh:
   - читать Google Sheets
   - писать сразу в weeek_tasks
   - не трогать Вердикт ОПП

3. Новый weeek-task-master:
   - create/update задач
   - sync WEEК -> Supabase
   - deferred transition
   - finalized transition
   - reopen transition
   - needs_attention

4. Только после этого:
   - деплой
   - настройка cron
   - удаление старых remote Edge Functions
```
