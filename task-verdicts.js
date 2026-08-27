// task-verdicts.js — единый словарь вердиктов wms_tasks.opp_verdict.
// Загружается до tasks.js обычным <script> тегом (без модулей, как ui.js).

const REVIEW_VERDICTS = [
    "Не выбран",
    "Найден/Релиз/Списан",
    "Отправлен на релиз",
    "Отправлен на списание ревизией",
    "Отправлен запрос",
    "Нет на МХ/Не найден",
];

const INCOMING_FLOW_ATTACHMENT_OPTIONS = [
    "Не выбран",
    "Вложено верно",
    "Вложено неверно",
    "Отправлен под пустым стикером",
    "Дубль",
    "Некорректный запрос",
    "Движение",
];

const DEFERRED_VERDICT_FIELDS = {
    "Отправлен запрос": "Направление запроса",
    "Отправлен на релиз": "Вставьте ссылку на запрос релиза",
    "Отправлен на списание ревизией": "Вставьте ссылку",
};

// Drives the compose bar's radial color + field layout in tasks.js. Only
// covers REVIEW_VERDICTS -- incoming-flow attachment options keep the
// plain (untinted) compose layout.
const VERDICT_TONE = {
    "Найден/Релиз/Списан": "green",
    "Отправлен запрос": "yellow",
    "Отправлен на релиз": "yellow",
    "Отправлен на списание ревизией": "yellow",
    "Нет на МХ/Не найден": "red",
};

// Системные вердикты — выставляются только кодом (актуализация, авто-проверка Без ШК),
// никогда не выбираются пользователем вручную.
const SYSTEM_MOVEMENT_VERDICT = "Система - Движение";
const SYSTEM_NO_SHK_NOT_FOUND_VERDICT = "Система - Не найден Без ШК";
const SYSTEM_NO_SHK_FOUND_VERDICT = "Система - Обнаружен Без ШК";
