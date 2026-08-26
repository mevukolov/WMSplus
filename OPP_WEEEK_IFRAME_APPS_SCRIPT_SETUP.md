# Деплой iframe ОПП через Google Apps Script

Этот вариант нужен, если нет своего домена/хостинга. Apps Script отдаст публичную ссылку Web App, которую можно вставить в WEEEK как iframe.

## Файлы

В Apps Script должны быть 3 файла:

- `Code.gs` - содержимое файла `google_apps_script_opp_shift_iframe.gs`
- `OppShiftIframe.html` - содержимое файла `OppShiftIframe.html`, большой вид
- `OppShiftStrip.html` - содержимое файла `OppShiftStrip.html`, компактная полоска

## Script Properties

В Apps Script открой:

`Project Settings` -> `Script properties` -> `Add script property`

Добавь:

- `SUPABASE_URL` = `https://bgphllmzmlwurfnbagho.supabase.co`
- `SUPABASE_ANON_KEY` = anon key из `auth.js`
- `OPP_IFRAME_TOKEN` = любой свой пароль-токен, например длинная строка без пробелов

`OPP_IFRAME_TOKEN` необязателен. Если его не добавлять, iframe будет открываться без секрета.

## Deploy

1. Нажми `Deploy`.
2. Нажми `Manage deployments`, если Web App уже создан.
3. Нажми карандаш/редактирование существующего deployment.
4. В поле `Version` выбери `New version`.
5. Description: `OPP iframe strip`.
6. Нажми `Deploy`.
7. Скопируй `Web app URL`.

Если Web App еще не создан:

1. Нажми `Deploy`.
2. Нажми `New deployment`.
3. В шестеренке выбери `Web app`.
4. Description: `OPP WEEEK iframe`.
5. Execute as: `Me`.
6. Who has access: `Anyone`.
7. Нажми `Deploy`.
8. Скопируй `Web app URL`.

## Большой iframe

```html
<iframe
  src="https://script.google.com/macros/s/ТВОЙ_DEPLOYMENT_ID/exec?wh_id=50144199&refresh=60"
  width="100%"
  height="900"
  style="border:0;border-radius:16px;overflow:hidden;"
  loading="lazy">
</iframe>
```

## Узкая полоска

```html
<iframe
  src="https://script.google.com/macros/s/ТВОЙ_DEPLOYMENT_ID/exec?view=strip&wh_id=50144199&refresh=60"
  width="100%"
  height="118"
  style="border:0;border-radius:16px;overflow:hidden;"
  loading="lazy">
</iframe>
```

Если используешь `OPP_IFRAME_TOKEN`, добавь его в URL:

```text
&token=ТВОЙ_TOKEN
```

## Твоя текущая ссылка

Большой вид:

```text
https://script.google.com/macros/s/AKfycbzyVrKuLilL27adkSCjC2gFEYfNEh3CNTZgBDos5fx9gMjMh71WlqNHFxGVuMvc5R3k9w/exec?wh_id=50144199&refresh=60
```

Полоска:

```text
https://script.google.com/macros/s/AKfycbzyVrKuLilL27adkSCjC2gFEYfNEh3CNTZgBDos5fx9gMjMh71WlqNHFxGVuMvc5R3k9w/exec?view=strip&wh_id=50144199&refresh=60
```

## Проверка

Открой URL в браузере. Если видишь карточки смены или полоску, можно вставлять в WEEEK.

Если видишь ошибку `Не задан SUPABASE_ANON_KEY`, значит не добавил Script Property `SUPABASE_ANON_KEY`.

Если видишь `Доступ запрещен`, значит в URL не передан `token` или он не совпадает с `OPP_IFRAME_TOKEN`.
