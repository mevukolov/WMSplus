(function () {
    "use strict";

    const loggedRaw = localStorage.getItem("user");
    if (!loggedRaw) {
        window.location.href = "login.html";
        return;
    }

    let user = null;
    try {
        user = JSON.parse(loggedRaw);
    } catch (e) {
        window.location.href = "login.html";
        return;
    }

    let supabaseClient = null;
    let isSearching = false;

    const shkInputEl = document.getElementById("shk-input");
    const searchBtnEl = document.getElementById("search-btn");
    const identifierLineEl = document.getElementById("identifier-line");
    const tableWrapEl = document.getElementById("table-wrap");
    const resultBodyEl = document.getElementById("result-body");
    const twoShkPanelEl = document.getElementById("twoshk-panel");
    const twoShkBodyEl = document.getElementById("twoshk-body");

    const CHECK_SUM_FIRST_SIZE = 4;
    const CHECK_SUM_SECOND_SIZE = 4;
    const SHK_VALUE_SIZE = 42;
    const PREFIX = "*";
    const CHAR_LIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    const VERHOEFF_D = [
        [0,1,2,3,4,5,6,7,8,9],
        [1,2,3,4,0,6,7,8,9,5],
        [2,3,4,0,1,7,8,9,5,6],
        [3,4,0,1,2,8,9,5,6,7],
        [4,0,1,2,3,9,5,6,7,8],
        [5,9,8,7,6,0,4,3,2,1],
        [6,5,9,8,7,1,0,4,3,2],
        [7,6,5,9,8,2,1,0,4,3],
        [8,7,6,5,9,3,2,1,0,4],
        [9,8,7,6,5,4,3,2,1,0]
    ];

    const VERHOEFF_P = [
        [0,1,2,3,4,5,6,7,8,9],
        [1,5,7,6,2,8,3,0,9,4],
        [5,8,0,3,7,9,6,1,4,2],
        [8,9,1,6,0,4,3,5,2,7],
        [9,4,5,3,1,2,6,8,7,0],
        [4,2,8,6,5,7,3,9,0,1],
        [2,7,9,3,8,0,6,4,1,5],
        [7,0,4,6,9,1,3,2,5,8]
    ];

    const VERHOEFF_INV = [0,4,3,2,1,5,6,7,8,9];

    function buildRuToEnMap() {
        const ruLow = "ё1234567890-=йцукенгшщзхъ\\фывапролджэячсмитьбю.";
        const enLow = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";
        const ruHigh = "Ё!\"№;%:?*()_+ЙЦУКЕНГШЩЗХЪ/ФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";
        const enHigh = "~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:\"ZXCVBNM<>?";

        const map = {};
        for (let i = 0; i < ruLow.length; i++) map[ruLow[i]] = enLow[i];
        for (let i = 0; i < ruHigh.length; i++) map[ruHigh[i]] = enHigh[i];
        return map;
    }

    const RU_TO_EN = buildRuToEnMap();

    function normalizeStickerLayout(str) {
        let out = String(str || "")
            .split("")
            .map(ch => RU_TO_EN[ch] || ch)
            .join("");

        out = out.replace(/\./g, "/");
        return out;
    }

    function commonDecodeV2(barcode) {
        if (!barcode || barcode.charAt(0) !== PREFIX) return null;

        const body = barcode.slice(1);
        const base = BigInt(CHAR_LIST.length);
        let result = 0n;

        for (let i = 0; i < body.length; i++) {
            const ch = body.charAt(body.length - 1 - i);
            const idx = CHAR_LIST.indexOf(ch);
            if (idx < 0) return null;
            result += BigInt(idx) * (base ** BigInt(i));
        }

        return result;
    }

    function getBitsFromEnd(value, countOfBits) {
        const mask = (1n << BigInt(countOfBits)) - 1n;
        return Number(value & mask);
    }

    function validateVerhoeffForTwoChecksum(shkValue, chkSum, chkSum2) {
        const s = String(shkValue);
        const splitCount = Math.floor(s.length / 2) + (s.length % 2 !== 0 ? 1 : 0);
        const digits = Array.from(s).map(ch => Number(ch));

        let b = 0;
        let i = 0;

        for (let idx = 0; idx < digits.length; idx++) {
            const digit = digits[idx];
            if (i === splitCount) {
                if (VERHOEFF_INV[b] !== 0) return false;
                b = 0;
                i = 0;
                b = VERHOEFF_D[b][VERHOEFF_P[i % 8][chkSum2]];
                i += 1;
            }
            b = VERHOEFF_D[b][VERHOEFF_P[i % 8][digit]];
            i += 1;
        }

        if (i === splitCount) {
            if (VERHOEFF_INV[b] !== 0) return false;
            b = 0;
            i = 0;
            b = VERHOEFF_D[b][VERHOEFF_P[i % 8][chkSum2]];
            i += 1;
        }

        b = VERHOEFF_D[b][VERHOEFF_P[i % 8][chkSum]];
        return VERHOEFF_INV[b] === 0;
    }

    function decodeStickerBarcode(barcode) {
        const decoded = commonDecodeV2(barcode);
        if (decoded === null) {
            return { ok: false, message: "Стикер не распознан" };
        }

        const chkSum = getBitsFromEnd(decoded, CHECK_SUM_FIRST_SIZE);
        const chkSum2 = getBitsFromEnd(decoded >> BigInt(CHECK_SUM_FIRST_SIZE), CHECK_SUM_SECOND_SIZE);
        const valueBigInt = (decoded >> BigInt(CHECK_SUM_FIRST_SIZE + CHECK_SUM_SECOND_SIZE)) & ((1n << BigInt(SHK_VALUE_SIZE)) - 1n);
        const remaining = decoded >> BigInt(CHECK_SUM_FIRST_SIZE + CHECK_SUM_SECOND_SIZE + SHK_VALUE_SIZE);

        if (remaining !== 0n) {
            return { ok: false, message: "Некорректная длина стикера" };
        }

        const valueNumber = Number(valueBigInt);
        if (!Number.isSafeInteger(valueNumber) || valueNumber <= 0) {
            return { ok: false, message: "Некорректное значение ШК" };
        }

        const checksumValid = validateVerhoeffForTwoChecksum(valueNumber, chkSum, chkSum2);
        return { ok: true, value: String(valueNumber), checksumValid: checksumValid };
    }

    function parseInputShk(rawInput) {
        const raw = String(rawInput || "").trim();
        if (!raw) return { ok: false, message: "Введите ШК" };

        if (/^\d+$/.test(raw)) {
            return { ok: true, shk: raw };
        }

        let normalized = normalizeStickerLayout(raw).trim();
        if (normalized.startsWith("!")) {
            normalized = `*${normalized.slice(1)}`;
        }

        if (!normalized.startsWith("*")) {
            return { ok: false, message: "Ожидается WB стикер" };
        }

        const decoded = decodeStickerBarcode(normalized);
        if (!decoded.ok) return decoded;

        return { ok: true, shk: decoded.value };
    }

    function fmtDateMsk(value) {
        if (!value) return "";

        const raw = String(value).trim();
        if (!raw) return "";

        // Supabase часто отдает timestamp в UTC (+00). Нормализуем формат и
        // принудительно рендерим в Europe/Moscow, чтобы пользователь всегда видел +03.
        let normalized = raw.replace(" ", "T");
        normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");

        const hasOffset = /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{2})$/.test(normalized);
        const date = hasOffset ? new Date(normalized) : new Date(`${normalized}Z`);
        if (!Number.isFinite(date.getTime())) return raw;

        return new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Europe/Moscow",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(date);
    }

    function renderUserNameSmall() {
        try {
            const nameEl = document.getElementById("user-name-small");
            if (nameEl && user?.name) nameEl.textContent = user.name;
        } catch (e) {}
    }

    function setIdentifierLine(shk, nm) {
        const value = String(shk || "").trim();
        const nmValue = String(nm || "").trim();
        if (!value) {
            identifierLineEl.style.display = "none";
            identifierLineEl.textContent = "";
            return;
        }

        identifierLineEl.style.display = "";
        identifierLineEl.textContent = nmValue
            ? `Идентификатор товара ${value} • НМ ${nmValue}`
            : `Идентификатор товара ${value}`;
    }

    function getMatchedNmFromNmRepRows(rows) {
        const matched = (rows || []).find(row => String(row?.nm || "").trim());
        return String(matched?.nm || "").trim();
    }

    function resetTable() {
        resultBodyEl.innerHTML = "";
        tableWrapEl.style.display = "none";
    }

    function setTwoShkMessage(message) {
        if (!twoShkBodyEl) return;
        twoShkBodyEl.innerHTML = "";

        const msgEl = document.createElement("div");
        msgEl.className = "twoshk-empty";
        msgEl.textContent = String(message || "");
        twoShkBodyEl.appendChild(msgEl);
    }

    function isUnknownColumnError(error) {
        const code = String(error?.code || "");
        const message = String(error?.message || "").toLowerCase();
        return (
            code === "42703" ||
            code === "PGRST204" ||
            (message.includes("column") && (message.includes("does not exist") || message.includes("could not find")))
        );
    }

    async function fetchShkRepRows(shk) {
        const { data, error } = await supabaseClient
            .from("shk_rep")
            .select("*")
            .eq("shk", shk)
            .order("date", { ascending: false });

        return { rows: Array.isArray(data) ? data : [], error: error || null };
    }

    async function fetchNmRepRows(shk) {
        const keys = ["shk", "sticker", "new_sticker", "barcode"];
        const mergedRows = [];
        const seen = new Set();
        let fatalError = null;

        for (const key of keys) {
            const { data, error } = await supabaseClient
                .from("nm_rep")
                .select("*")
                .eq(key, shk)
                .order("date", { ascending: false });

            if (error) {
                if (isUnknownColumnError(error)) {
                    continue;
                }
                fatalError = error;
                break;
            }

            (data || []).forEach(row => {
                const idKey = row && (row.id || row.nm_rep_id);
                const signature = idKey
                    ? `id:${idKey}`
                    : `sig:${String(row?.date || "")}|${String(row?.operation || "")}|${String(row?.emp || "")}|${String(row?.place || "")}|${String(row?.shk || row?.sticker || row?.new_sticker || row?.barcode || "")}`;
                if (seen.has(signature)) return;
                seen.add(signature);
                mergedRows.push(row);
            });
        }

        return { rows: mergedRows, error: fatalError };
    }

    async function fetchTwoShkRepRows(shk) {
        const value = String(shk || "").trim();
        if (!value) return { rows: [], error: null };

        const orExpr = `shk1.eq.${value},shk2.eq.${value}`;

        let { data, error } = await supabaseClient
            .from("2shk_rep")
            .select("*")
            .or(orExpr)
            .order("created_at", { ascending: false });

        if (error && isUnknownColumnError(error)) {
            const fallback = await supabaseClient
                .from("2shk_rep")
                .select("*")
                .or(orExpr);
            data = fallback.data;
            error = fallback.error;
        }

        return { rows: Array.isArray(data) ? data : [], error: error || null };
    }

    function normalizeShkRepRows(rows) {
        return (rows || []).map(row => ({
            source: "shk_rep",
            date: row?.date || "",
            shk: String(row?.shk || "").trim(),
            status: String(row?.status || row?.operation || "").trim(),
            description: String(row?.description || row?.details || "").trim(),
            place: String(row?.place || "").trim(),
            place_new: String(row?.place_new || "").trim(),
            emp: String(row?.emp || "").trim()
        }));
    }

    function normalizeNmRepRows(rows, searchedShk) {
        return (rows || []).map(row => ({
            source: "nm_rep",
            date: row?.date || "",
            shk: String(row?.shk || row?.sticker || row?.new_sticker || searchedShk || row?.barcode || "").trim(),
            status: String(row?.status || row?.operation || "Запись nm_rep").trim(),
            description: String(row?.description || "").trim(),
            place: String(row?.place || "").trim(),
            place_new: String(row?.place_new || "").trim(),
            emp: String(row?.emp || "").trim()
        }));
    }

    function sortRowsByDateAsc(rows) {
        return [...(rows || [])].sort((a, b) => {
            const aTime = Date.parse(a?.date || "");
            const bTime = Date.parse(b?.date || "");
            const aValid = Number.isFinite(aTime);
            const bValid = Number.isFinite(bTime);
            if (aValid && bValid) return aTime - bTime;
            if (aValid) return -1;
            if (bValid) return 1;
            return String(a?.date || "").localeCompare(String(b?.date || ""));
        });
    }

    function sortRowsByDateDesc(rows, keyName) {
        const key = String(keyName || "");
        return [...(rows || [])].sort((a, b) => {
            const aTime = Date.parse(a?.[key] || "");
            const bTime = Date.parse(b?.[key] || "");
            const aValid = Number.isFinite(aTime);
            const bValid = Number.isFinite(bTime);
            if (aValid && bValid) return bTime - aTime;
            if (aValid) return -1;
            if (bValid) return 1;
            return String(b?.[key] || "").localeCompare(String(a?.[key] || ""));
        });
    }

    async function fetchPlacesMap(rows) {
        const placeIds = Array.from(new Set(
            (rows || [])
                .map(r => String(r.place || r.place_new || "").trim())
                .filter(Boolean)
        ));

        if (!placeIds.length) {
            return { placeMap: new Map(), whIds: [] };
        }

        const { data, error } = await supabaseClient
            .from("places")
            .select("place, place_name, wh_id")
            .in("place", placeIds);

        if (error) {
            console.error("Ошибка загрузки МХ:", error);
            return { placeMap: new Map(), whIds: [] };
        }

        const placeMap = new Map();
        const whIds = [];
        (data || []).forEach(item => {
            const placeKey = String(item.place || "").trim();
            if (!placeKey) return;
            placeMap.set(placeKey, item);

            const whId = String(item.wh_id || "").trim();
            if (whId) whIds.push(whId);
        });

        return { placeMap: placeMap, whIds: Array.from(new Set(whIds)) };
    }

    async function fetchWhMap(whIds) {
        const ids = Array.from(new Set((whIds || []).map(v => String(v || "").trim()).filter(Boolean)));
        if (!ids.length) return new Map();

        const { data, error } = await supabaseClient
            .from("wh_rep")
            .select("wh_id, wh_name")
            .in("wh_id", ids);

        if (error) {
            console.error("Ошибка загрузки складов:", error);
            return new Map();
        }

        const map = new Map();
        (data || []).forEach(item => {
            map.set(String(item.wh_id || "").trim(), String(item.wh_name || "").trim());
        });
        return map;
    }

    async function fetchEmpMap(rows) {
        const empIds = Array.from(new Set(
            (rows || [])
                .map(r => String(r.emp || "").trim())
                .filter(Boolean)
        ));

        if (!empIds.length) return new Map();

        const { data, error } = await supabaseClient
            .from("users")
            .select("id, fio")
            .in("id", empIds);

        if (error) {
            console.error("Ошибка загрузки сотрудников:", error);
            return new Map();
        }

        const map = new Map();
        (data || []).forEach(item => {
            map.set(String(item.id || "").trim(), String(item.fio || "").trim());
        });
        return map;
    }

    function parseMediaLinks(mediaValue) {
        return String(mediaValue || "")
            .split(",")
            .map(v => v.trim().replace(/^"+|"+$/g, ""))
            .filter(Boolean);
    }

    function normalizeMediaLink(url) {
        const value = String(url || "").trim();
        if (!value) return "";
        if (/^https?:\/\//i.test(value)) return value;
        if (/^www\./i.test(value)) return `https://${value}`;
        return value;
    }

    function normalizeTwoShkRows(rows, whMap) {
        const normalizedRows = (rows || []).map(row => {
            const whId = String(row?.wh_id || "").trim();
            const whName = whMap.get(whId) || "";
            const createdAt = row?.created_at || row?.date || "";
            return {
                shk1: String(row?.shk1 || "").trim(),
                shk2: String(row?.shk2 || "").trim(),
                eventtype: String(row?.eventtype || "").trim(),
                whId: whId,
                whName: whName,
                createdAt: createdAt,
                mediaLinks: parseMediaLinks(row?.media)
            };
        });

        return sortRowsByDateDesc(normalizedRows, "createdAt");
    }

    function renderTwoShkRows(rows) {
        if (!twoShkBodyEl) return;
        twoShkBodyEl.innerHTML = "";

        if (!rows.length) {
            setTwoShkMessage("Совпадений в 2shk_rep не найдено.");
            return;
        }

        rows.forEach((row) => {
            const card = document.createElement("div");
            card.className = "twoshk-card";

            const lineShk = document.createElement("div");
            lineShk.className = "twoshk-main-line";
            lineShk.textContent = `${row.shk1 || "-"} / ${row.shk2 || "-"}`;

            const lineType = document.createElement("div");
            lineType.textContent = row.eventtype || "-";

            const lineWh = document.createElement("div");
            lineWh.textContent = row.whName || (row.whId ? `Склад ID: ${row.whId}` : "-");

            const lineCreatedAt = document.createElement("div");
            lineCreatedAt.textContent = fmtDateMsk(row.createdAt);

            const mediaRow = document.createElement("div");
            mediaRow.className = "twoshk-media-row";

            if (!row.mediaLinks.length) {
                const emptyMedia = document.createElement("div");
                emptyMedia.className = "twoshk-empty";
                emptyMedia.textContent = "Фото: -";
                mediaRow.appendChild(emptyMedia);
            } else {
                row.mediaLinks.forEach((link, index) => {
                    const href = normalizeMediaLink(link);
                    const btn = document.createElement("a");
                    btn.className = "btn btn-outline twoshk-photo-btn";
                    btn.textContent = `Фото ${index + 1}`;
                    btn.href = href || "#";
                    btn.target = "_blank";
                    btn.rel = "noopener noreferrer";
                    mediaRow.appendChild(btn);
                });
            }

            card.append(lineShk, lineType, lineWh, lineCreatedAt, mediaRow);
            twoShkBodyEl.appendChild(card);
        });
    }

    function renderHistoryRows(rows, placeMap, whMap, empMap) {
        resultBodyEl.innerHTML = "";

        (rows || []).forEach(r => {
            const placeCode = String(r.place || r.place_new || "").trim();
            const placeObj = placeMap.get(placeCode);
            const whName = placeObj ? (whMap.get(String(placeObj.wh_id || "").trim()) || "") : "";
            const placeName = placeObj ? String(placeObj.place_name || "") : "";
            const fio = empMap.get(String(r.emp || "").trim()) || "";
            const description = String(r.description || "").trim();
            const statusText = String(r.status || "").trim();
            const descriptionText = statusText || description;

            const rowEl = document.createElement("div");
            rowEl.style.display = "grid";
            rowEl.style.gridTemplateColumns = "190px 130px 340px 200px 220px 130px 240px";
            rowEl.style.gap = "0";
            rowEl.style.padding = "7px 10px";
            rowEl.style.borderBottom = "1px solid rgba(15,23,42,0.08)";
            rowEl.style.background = "#f8fafc";
            rowEl.style.minWidth = "1450px";
            rowEl.style.alignItems = "start";
            rowEl.style.color = "#1f2937";
            rowEl.style.fontSize = "14px";

            const dateEl = document.createElement("div");
            dateEl.textContent = fmtDateMsk(r.date);

            const shkEl = document.createElement("div");
            shkEl.textContent = String(r.shk || "");

            const descriptionEl = document.createElement("div");
            descriptionEl.textContent = descriptionText;
            descriptionEl.style.minWidth = "0";
            descriptionEl.style.whiteSpace = "normal";
            descriptionEl.style.overflowWrap = "anywhere";
            descriptionEl.style.wordBreak = "break-word";
            descriptionEl.style.lineHeight = "1.2";

            const blockEl = document.createElement("div");
            blockEl.textContent = whName;

            const mhEl = document.createElement("div");
            mhEl.textContent = placeName;

            const idEl = document.createElement("div");
            idEl.textContent = String(r.emp || "");

            const fioEl = document.createElement("div");
            fioEl.textContent = fio;
            fioEl.style.minWidth = "0";
            fioEl.style.whiteSpace = "normal";
            fioEl.style.overflowWrap = "anywhere";
            fioEl.style.wordBreak = "break-word";
            fioEl.style.lineHeight = "1.2";

            rowEl.append(dateEl, shkEl, descriptionEl, blockEl, mhEl, idEl, fioEl);
            resultBodyEl.appendChild(rowEl);
        });

        tableWrapEl.style.display = "";
    }

    async function handleSearch() {
        if (isSearching) return;

        const parsed = parseInputShk(shkInputEl.value);
        if (!parsed.ok) {
            MiniUI.toast(parsed.message || "Ошибка распознавания ШК", { type: "error" });
            return;
        }

        const shk = parsed.shk;
        setIdentifierLine(shk);
        resetTable();
        setTwoShkMessage("Поиск...");
        shkInputEl.value = "";

        isSearching = true;
        searchBtnEl.disabled = true;

        try {
            const [shkRepResult, nmRepResult, twoShkResult] = await Promise.all([
                fetchShkRepRows(shk),
                fetchNmRepRows(shk),
                fetchTwoShkRepRows(shk)
            ]);

            if (shkRepResult.error) {
                console.error("Ошибка поиска по shk_rep:", shkRepResult.error);
            }
            if (nmRepResult.error) {
                console.error("Ошибка поиска по nm_rep:", nmRepResult.error);
            }
            if (twoShkResult.error) {
                console.error("Ошибка поиска по 2shk_rep:", twoShkResult.error);
            }

            const matchedNm = getMatchedNmFromNmRepRows(nmRepResult.rows);
            setIdentifierLine(shk, matchedNm);

            const twoShkWhIds = Array.from(new Set(
                (twoShkResult.rows || [])
                    .map(row => String(row?.wh_id || "").trim())
                    .filter(Boolean)
            ));
            const twoShkWhMap = await fetchWhMap(twoShkWhIds);
            const twoShkRows = normalizeTwoShkRows(twoShkResult.rows, twoShkWhMap);
            renderTwoShkRows(twoShkRows);

            const allRows = sortRowsByDateAsc([
                ...normalizeShkRepRows(shkRepResult.rows),
                ...normalizeNmRepRows(nmRepResult.rows, shk)
            ]);

            if (!allRows.length) {
                if (shkRepResult.error && nmRepResult.error) {
                    MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
                    return;
                }
                if (!twoShkRows.length) {
                    MiniUI.toast("В репозитории ШК нет данных о вещи", { type: "info" });
                }
                return;
            }

            const [placeResult, empMap] = await Promise.all([
                fetchPlacesMap(allRows),
                fetchEmpMap(allRows)
            ]);

            const whMap = await fetchWhMap(placeResult.whIds);
            renderHistoryRows(allRows, placeResult.placeMap, whMap, empMap);
        } catch (e) {
            console.error(e);
            MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
        } finally {
            isSearching = false;
            searchBtnEl.disabled = false;
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (!shkInputEl || !searchBtnEl || !identifierLineEl || !tableWrapEl || !resultBodyEl || !twoShkPanelEl || !twoShkBodyEl) {
            console.error("Не найдены элементы страницы shk_info");
            return;
        }

        supabaseClient = window.supabaseClient;
        if (!supabaseClient) {
            MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
            return;
        }

        renderUserNameSmall();
        setIdentifierLine("");
        resetTable();
        setTwoShkMessage("Введите ШК и нажмите «Найти».");

        searchBtnEl.addEventListener("click", handleSearch);
        shkInputEl.addEventListener("keydown", ev => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                handleSearch();
            }
        });

        setTimeout(() => shkInputEl.focus(), 0);
    });
})();
