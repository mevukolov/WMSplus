# Яндекс Форма -> существующая таблица Supabase

В этом репозитории уже есть webhook-функция:

- `supabase/functions/yandex-form-webhook/index.ts`

Функция берёт JSON из Яндекс Формы и вставляет его в вашу уже существующую таблицу.
Лишние поля игнорируются.

## Что должно совпадать

Поддерживаемые поля (и алиасы), которые функция маппит в БД:

- `shk1`: `shk1`, `shk_1`, `barcode_1`, `code1`
- `shk2`: `shk2`, `shk_2`, `barcode_2`, `code2`
- `eventtype`: `eventtype`, `event_type`, `event`
- `media`: `media`, `source`, `channel`
- `wh_id`: `wh_id`, `warehouse_id`, `wh`

Пример body для вашей таблицы:

```json
{
  "shk1": 123456789,
  "shk2": 987654321,
  "eventtype": "yandex_form",
  "media": "yandex",
  "wh_id": "WH-01"
}
```

## Пошагово

1) Привяжите локальный проект к Supabase (один раз):

```bash
supabase init
supabase link --project-ref <PROJECT_REF>
```

2) Задайте переменные функции:

```bash
supabase secrets set YANDEX_TARGET_TABLE='2shk_rep'
```

Секрет опционален. Если хотите с защитой, добавьте:

```bash
supabase secrets set YANDEX_WEBHOOK_SECRET='your-strong-secret'
```

Если хотите сохранять `x-delivery-id` из Яндекс в отдельный столбец, задайте (опционально):

```bash
supabase secrets set YANDEX_DELIVERY_ID_COLUMN='delivery_id'
```

3) Деплой функции:

```bash
supabase functions deploy yandex-form-webhook --no-verify-jwt
```

4) В Яндекс Форме настройте действие "Отправить HTTP-запрос":

- Method: `POST`
- URL: `https://<PROJECT_REF>.functions.supabase.co/yandex-form-webhook`
- Headers:
  - `Content-Type: application/json`
  - `x-yandex-webhook-secret: your-strong-secret` (только если включили секрет)
- Body: JSON, где ключи = имена столбцов вашей таблицы

Если коннектор формы не отправляет кастомные headers, используйте URL так:

`https://<PROJECT_REF>.functions.supabase.co/yandex-form-webhook?secret=your-strong-secret`

5) Быстрый тест:

```bash
curl -i \
  -X POST "https://<PROJECT_REF>.functions.supabase.co/yandex-form-webhook" \
  -H "Content-Type: application/json" \
  -H "x-yandex-webhook-secret: your-strong-secret" \
  -d '{"shk1":123456,"shk2":654321,"eventtype":"yandex_form","media":"yandex","wh_id":"WH-01"}'
```
