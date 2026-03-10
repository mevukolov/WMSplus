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

    const searchInputEl = document.getElementById("search-input");
    const searchBtnEl = document.getElementById("search-btn");
    const identifierLineEl = document.getElementById("identifier-line");
    const tableWrapEl = document.getElementById("table-wrap");
    const resultBodyEl = document.getElementById("result-body");
    const MAX_VISUAL_VARIANTS = 24;

    const VISUAL_SIMILAR_MAP = {
        A: "А", a: "а",
        B: "В", b: "в",
        C: "С", c: "с",
        E: "Е", e: "е",
        H: "Н", h: "н",
        K: "К", k: "к",
        M: "М", m: "м",
        O: "О", o: "о",
        P: "Р", p: "р",
        T: "Т", t: "т",
        X: "Х", x: "х",
        Y: "У", y: "у",
        А: "A", а: "a",
        В: "B", в: "b",
        С: "C", с: "c",
        Е: "E", е: "e",
        Н: "H", н: "h",
        К: "K", к: "k",
        М: "M", м: "m",
        О: "O", о: "o",
        Р: "P", р: "p",
        Т: "T", т: "t",
        Х: "X", х: "x",
        У: "Y", у: "y"
    };

    function fmtDateMsk(value) {
        if (!value) return "";
        try {
            return new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
        } catch {
            return new Date(value).toLocaleString("ru-RU");
        }
    }

    function renderUserNameSmall() {
        try {
            const nameEl = document.getElementById("user-name-small");
            if (nameEl && user?.name) nameEl.textContent = user.name;
        } catch (e) {}
    }

    function setIdentifierLine(text) {
        const value = String(text || "").trim();
        if (!value) {
            identifierLineEl.style.display = "none";
            identifierLineEl.textContent = "";
            return;
        }

        identifierLineEl.style.display = "";
        identifierLineEl.textContent = value;
    }

    function resetTable() {
        resultBodyEl.innerHTML = "";
        tableWrapEl.style.display = "none";
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

    function normalizeNmRow(row) {
        return {
            date: row?.date || "",
            nm: String(row?.nm || "").trim(),
            description: String(row?.description || "").trim(),
            shk: String(row?.shk || row?.sticker || row?.new_sticker || row?.barcode || "").trim(),
            place: String(row?.place || "").trim(),
            place_new: String(row?.place_new || "").trim(),
            emp: String(row?.emp || "").trim()
        };
    }

    function buildVisualVariants(sourceText, maxVariants = MAX_VISUAL_VARIANTS) {
        const text = String(sourceText || "").trim();
        if (!text) return [];

        const chars = Array.from(text);
        const positions = [];
        for (let i = 0; i < chars.length; i++) {
            if (VISUAL_SIMILAR_MAP[chars[i]]) positions.push(i);
        }

        const result = new Set([text]);
        if (!positions.length) return [...result];

        const maxPositionsForCombos = 12;
        const comboPositions = positions.slice(0, maxPositionsForCombos);

        const fullySwapped = chars
            .map(ch => VISUAL_SIMILAR_MAP[ch] || ch)
            .join("");
        result.add(fullySwapped);

        comboPositions.forEach(pos => {
            if (result.size >= maxVariants) return;
            const cloned = chars.slice();
            cloned[pos] = VISUAL_SIMILAR_MAP[cloned[pos]] || cloned[pos];
            result.add(cloned.join(""));
        });

        const maxMask = 1 << comboPositions.length;
        for (let mask = 1; mask < maxMask && result.size < maxVariants; mask++) {
            const cloned = chars.slice();
            for (let bit = 0; bit < comboPositions.length; bit++) {
                if ((mask & (1 << bit)) === 0) continue;
                const pos = comboPositions[bit];
                cloned[pos] = VISUAL_SIMILAR_MAP[cloned[pos]] || cloned[pos];
            }
            result.add(cloned.join(""));
        }

        return Array.from(result).slice(0, maxVariants);
    }

    function uniqueRowsBySignature(rows) {
        const mergedRows = [];
        const seen = new Set();

        (rows || []).forEach(row => {
            const idKey = row && (row.id || row.nm_rep_id);
            const signature = idKey
                ? `id:${idKey}`
                : `sig:${String(row?.date || "")}|${String(row?.nm || "")}|${String(row?.description || "")}|${String(row?.shk || row?.sticker || row?.new_sticker || row?.barcode || "")}|${String(row?.emp || "")}|${String(row?.place || "")}`;
            if (seen.has(signature)) return;
            seen.add(signature);
            mergedRows.push(row);
        });

        return mergedRows;
    }

    async function fetchNmRepRowsByQuery(queryRaw) {
        const query = String(queryRaw || "").trim();
        const isNmSearch = /^\d+$/.test(query);

        if (isNmSearch) {
            const { data, error } = await supabaseClient
                .from("nm_rep")
                .select("*")
                .eq("nm", query)
                .order("date", { ascending: false });

            return {
                rows: Array.isArray(data) ? data : [],
                error: error || null,
                mode: "nm",
                query: query
            };
        }

        const variants = buildVisualVariants(query, MAX_VISUAL_VARIANTS);
        const requests = variants.map(variant =>
            supabaseClient
                .from("nm_rep")
                .select("*")
                .ilike("description", `%${variant}%`)
                .order("date", { ascending: false })
        );

        const responses = await Promise.all(requests);
        const dataParts = [];
        const errors = [];

        responses.forEach(res => {
            if (res.error) {
                errors.push(res.error);
                return;
            }
            dataParts.push(...(res.data || []));
        });

        const mergedRows = uniqueRowsBySignature(dataParts);
        const fatalError = mergedRows.length ? null : (errors[0] || null);

        return {
            rows: mergedRows,
            error: fatalError,
            mode: "description",
            query: query,
            variantsUsed: variants
        };
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

    function renderHistoryRows(rows, placeMap, whMap, empMap) {
        resultBodyEl.innerHTML = "";

        (rows || []).forEach(r => {
            const placeCode = String(r.place || r.place_new || "").trim();
            const placeObj = placeMap.get(placeCode);
            const whName = placeObj ? (whMap.get(String(placeObj.wh_id || "").trim()) || "") : "";
            const placeName = placeObj ? String(placeObj.place_name || "") : "";
            const fio = empMap.get(String(r.emp || "").trim()) || "";

            const rowEl = document.createElement("div");
            rowEl.style.display = "grid";
            rowEl.style.gridTemplateColumns = "170px 130px 360px 150px 200px 220px 110px 240px";
            rowEl.style.gap = "0";
            rowEl.style.padding = "7px 10px";
            rowEl.style.borderBottom = "1px solid rgba(15,23,42,0.08)";
            rowEl.style.background = "#f8fafc";
            rowEl.style.minWidth = "1580px";
            rowEl.style.alignItems = "start";
            rowEl.style.color = "#1f2937";
            rowEl.style.fontSize = "14px";

            const dateEl = document.createElement("div");
            dateEl.textContent = fmtDateMsk(r.date);

            const nmEl = document.createElement("div");
            nmEl.textContent = String(r.nm || "");

            const descriptionEl = document.createElement("div");
            descriptionEl.textContent = String(r.description || "");
            descriptionEl.style.minWidth = "0";
            descriptionEl.style.whiteSpace = "normal";
            descriptionEl.style.overflowWrap = "anywhere";
            descriptionEl.style.wordBreak = "break-word";
            descriptionEl.style.lineHeight = "1.2";

            const shkEl = document.createElement("div");
            shkEl.textContent = String(r.shk || "");

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

            rowEl.append(dateEl, nmEl, descriptionEl, shkEl, blockEl, mhEl, idEl, fioEl);
            resultBodyEl.appendChild(rowEl);
        });

        tableWrapEl.style.display = "";
    }

    async function handleSearch() {
        if (isSearching) return;

        const query = String(searchInputEl.value || "").trim();
        if (!query) {
            MiniUI.toast("Введите номенклатуру или наименование", { type: "error" });
            return;
        }

        isSearching = true;
        searchBtnEl.disabled = true;
        setIdentifierLine("");
        resetTable();

        try {
            const searchResult = await fetchNmRepRowsByQuery(query);
            if (searchResult.error) {
                console.error("Ошибка поиска в nm_rep:", searchResult.error);
                MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
                return;
            }

            const rows = sortRowsByDateAsc((searchResult.rows || []).map(normalizeNmRow));
            if (!rows.length) {
                MiniUI.toast("По запросу ничего не найдено", { type: "info" });
                return;
            }

            if (searchResult.mode === "nm") {
                setIdentifierLine(`Номенклатура ${searchResult.query} · найдено записей: ${rows.length}`);
            } else {
                setIdentifierLine(`Найдено записей: ${rows.length}`);
            }

            const [placeResult, empMap] = await Promise.all([
                fetchPlacesMap(rows),
                fetchEmpMap(rows)
            ]);
            const whMap = await fetchWhMap(placeResult.whIds);

            renderHistoryRows(rows, placeResult.placeMap, whMap, empMap);
        } catch (e) {
            console.error(e);
            MiniUI.toast("Ошибка связи с базой данных", { type: "error" });
        } finally {
            isSearching = false;
            searchBtnEl.disabled = false;
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (!searchInputEl || !searchBtnEl || !identifierLineEl || !tableWrapEl || !resultBodyEl) {
            console.error("Не найдены элементы страницы transfer_to_identification_search");
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

        searchBtnEl.addEventListener("click", handleSearch);
        searchInputEl.addEventListener("keydown", ev => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                handleSearch();
            }
        });

        setTimeout(() => searchInputEl.focus(), 0);
    });
})();
