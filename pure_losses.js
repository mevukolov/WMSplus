(function () {
    const TABLE_PURE = "pure_losses_rep";
    const TABLE_LOSSES = "losses_rep";
    const URL_FILTER_CHUNK_SIZE = 80;
    const INSERT_CHUNK_SIZE = 400;
    const unsupportedInsertColumns = new Set();

    const COLUMN_VARIANTS = {
        shk: ["ШК", "shk", "Шк", "Штрихкод"],
        nm: ["ID номенклатуры", "ID Номенклатуры", "ID НМ", "nm"],
        decription: ["Наименования товара", "Наименование товара", "Товар"],
        brand: ["Наименования бренда", "Наименование бренда", "Бренд"],
        shk_state_before_lost: ["Статус перед списанием", "Статус ШК перед списанием"],
        wh_id: ["ID офиса статуса перед списанием", "ID офиса статуса перед списания", "wh_id"],
        date_lost: ["Дата последнего списания", "date_lost"],
        lr: ["Лостризон последнего списания", "ЛР последнего списания", "ID списания"],
        price: ["Сумма списания", "Сумма"],
        posted_flag: ["Флаг оприходования", "Оприходовано", "Флаг оприходован"]
    };

    const NORMALIZED_COLUMN_VARIANTS = Object.fromEntries(
        Object.entries(COLUMN_VARIANTS).map(([key, variants]) => [
            key,
            variants.map(normalizeHeaderKey)
        ])
    );

    const refreshBtn = document.getElementById("refresh-btn");
    const fileInput = document.getElementById("file-input");
    const statusLineEl = document.getElementById("status-line");

    if (!refreshBtn || !fileInput) return;

    const user = getCurrentUser();
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    const userWhId = normalizeToken(user.user_wh_id);

    if (!userWhId) {
        setStatus("Не удалось определить user_wh_id текущего пользователя.", "error");
    }

    refreshBtn.addEventListener("click", () => {
        fileInput.value = "";
        fileInput.click();
    });

    fileInput.addEventListener("change", async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        await processImport(file, userWhId);
        fileInput.value = "";
    });

    async function processImport(file, currentUserWhId) {
        if (!currentUserWhId) {
            window.MiniUI?.toast?.("Не определён wh_id пользователя", { type: "error" });
            return;
        }
        if (typeof window.XLSX === "undefined") {
            window.MiniUI?.toast?.("Не загрузилась библиотека XLSX", { type: "error" });
            return;
        }
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            window.MiniUI?.toast?.("Supabase не инициализирован", { type: "error" });
            return;
        }

        setBusy(true);
        setStatus("Обработка данных", "info");

        try {
            const excelRows = await readExcelRows(file);
            if (!excelRows.length) {
                setStatus("Файл пустой", "error");
                window.MiniUI?.toast?.("Файл пустой", { type: "error" });
                return;
            }

            const autoLrSet = await loadAutoLossReasonIds();
            const prepared = prepareIncomingRows(excelRows, currentUserWhId, autoLrSet);

            if (!prepared.rowsByShk.size) {
                renderSummary({
                    insertedNew: 0
                });
                window.MiniUI?.toast?.("Подходящих строк для выгрузки не найдено", { type: "info" });
                return;
            }

            const incomingShks = Array.from(prepared.rowsByShk.keys());
            const existingByShk = await loadExistingRowsByShk(incomingShks);
            const syncPlan = buildSyncPlan(prepared.rowsByShk, existingByShk);

            await applySyncPlan(syncPlan);

            renderSummary(syncPlan.stats);

            const updated = syncPlan.stats.insertedNew + syncPlan.stats.replacedByNewer;
            window.MiniUI?.toast?.(`Обновление завершено. Изменено строк: ${updated}`, { type: "success" });
        } catch (error) {
            const message = String(error?.message || error || "Неизвестная ошибка");
            console.error("pure_losses import failed:", error);
            setStatus(message, "error");
            window.MiniUI?.toast?.("Ошибка обновления данных", { type: "error" });
        } finally {
            setBusy(false);
        }
    }

    async function readExcelRows(file) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames && workbook.SheetNames[0];
        if (!firstSheetName) return [];

        const firstSheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
        return Array.isArray(rows) ? rows : [];
    }

    async function loadAutoLossReasonIds() {
        const { data, error } = await supabaseClient
            .from(TABLE_LOSSES)
            .select("writeoff_id, is_auto");

        if (error) {
            throw new Error("Не удалось загрузить справочник losses_rep (writeoff_id/is_auto).");
        }

        const autoIds = new Set();
        (data || []).forEach((row) => {
            if (!isTrueLike(row?.is_auto)) return;
            const normalized = normalizeLossReason(row?.writeoff_id);
            if (normalized) autoIds.add(normalized);
        });
        return autoIds;
    }

    function prepareIncomingRows(rows, currentUserWhId, autoLrSet) {
        const rowsByShk = new Map();
        const stats = {
            skippedByWh: 0,
            skippedPostedFlag: 0,
            skippedByIsAuto: 0,
            skippedInvalid: 0,
            duplicateInFileIgnored: 0,
            duplicateInFileReplaced: 0
        };

        for (const row of rows) {
            const normalizedRow = buildNormalizedRow(row);

            const whId = normalizeToken(getCellValue(row, normalizedRow, "wh_id"));
            if (!whId || whId !== currentUserWhId) {
                stats.skippedByWh += 1;
                continue;
            }

            const postedFlag = getCellValue(row, normalizedRow, "posted_flag");
            if (isTrueLike(postedFlag)) {
                stats.skippedPostedFlag += 1;
                continue;
            }

            const lrRaw = getCellValue(row, normalizedRow, "lr");
            const lr = normalizeLossReason(lrRaw);
            if (!lr || !autoLrSet.has(lr)) {
                stats.skippedByIsAuto += 1;
                continue;
            }

            const shk = normalizeShk(getCellValue(row, normalizedRow, "shk"));
            const dateObj = parseDateValue(getCellValue(row, normalizedRow, "date_lost"));

            if (!shk || !dateObj) {
                stats.skippedInvalid += 1;
                continue;
            }

            const incoming = {
                shk,
                nm: toIntegerOrNull(getCellValue(row, normalizedRow, "nm")),
                decription: toText(getCellValue(row, normalizedRow, "decription")),
                brand: toText(getCellValue(row, normalizedRow, "brand")),
                shk_state_before_lost: toText(getCellValue(row, normalizedRow, "shk_state_before_lost")),
                wh_id: whId,
                date_lost: formatIsoDate(dateObj),
                lr: toIntegerOrNull(lrRaw) ?? toIntegerOrNull(lr) ?? lr,
                price: toNumberOrNull(getCellValue(row, normalizedRow, "price")) ?? 0,
                __dateTs: dateObj.getTime()
            };

            const prev = rowsByShk.get(shk);
            if (!prev) {
                rowsByShk.set(shk, incoming);
                continue;
            }

            const compare = compareDateTs(incoming.__dateTs, prev.__dateTs);
            if (compare > 0) {
                rowsByShk.set(shk, incoming);
                stats.duplicateInFileReplaced += 1;
            } else {
                stats.duplicateInFileIgnored += 1;
            }
        }

        return { rowsByShk, stats };
    }

    async function loadExistingRowsByShk(shks) {
        const result = new Map();
        const chunks = chunkArray(shks, URL_FILTER_CHUNK_SIZE);

        for (const idsChunk of chunks) {
            const data = await fetchPureRowsByShkChunk(idsChunk);

            (data || []).forEach((row) => {
                const shk = normalizeShk(row?.shk);
                if (!shk) return;
                if (!result.has(shk)) result.set(shk, []);
                result.get(shk).push(row);
            });
        }

        return result;
    }

    async function fetchPureRowsByShkChunk(shksChunk) {
        if (!Array.isArray(shksChunk) || !shksChunk.length) return [];

        const { data, error } = await supabaseClient
            .from(TABLE_PURE)
            .select("*")
            .in("shk", shksChunk);

        if (!error) return Array.isArray(data) ? data : [];

        if (shksChunk.length > 1) {
            const mid = Math.ceil(shksChunk.length / 2);
            const left = await fetchPureRowsByShkChunk(shksChunk.slice(0, mid));
            const right = await fetchPureRowsByShkChunk(shksChunk.slice(mid));
            return left.concat(right);
        }

        const oneShk = shksChunk[0];
        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось проверить ШК ${oneShk} в pure_losses_rep: ${errorText}`);
    }

    function buildSyncPlan(rowsByShk, existingByShk) {
        const rowsToInsert = [];
        const deleteShks = new Set();
        const stats = {
            insertedNew: 0,
            replacedByNewer: 0,
            skippedSameDate: 0,
            skippedOlderDate: 0,
            dedupedExistingRows: 0
        };

        for (const [shk, incoming] of rowsByShk.entries()) {
            const existingRows = existingByShk.get(shk) || [];

            if (!existingRows.length) {
                rowsToInsert.push(toInsertPayload(incoming));
                stats.insertedNew += 1;
                continue;
            }

            const existingNewest = getNewestExistingRow(existingRows);
            const compare = compareDateTs(incoming.__dateTs, existingNewest.ts);

            if (compare > 0) {
                deleteShks.add(shk);
                rowsToInsert.push(toInsertPayload(incoming));
                stats.replacedByNewer += 1;
            } else {
                if (existingRows.length > 1) {
                    deleteShks.add(shk);
                    rowsToInsert.push(toInsertPayloadFromExisting(existingNewest.row, shk));
                    stats.dedupedExistingRows += (existingRows.length - 1);
                }

                if (compare === 0) {
                    stats.skippedSameDate += 1;
                } else {
                    stats.skippedOlderDate += 1;
                }
            }
        }

        return {
            deleteShks: Array.from(deleteShks),
            rowsToInsert,
            stats
        };
    }

    async function applySyncPlan(syncPlan) {
        const deleteChunks = chunkArray(syncPlan.deleteShks, URL_FILTER_CHUNK_SIZE);
        for (const idsChunk of deleteChunks) {
            const { error } = await supabaseClient
                .from(TABLE_PURE)
                .delete()
                .in("shk", idsChunk);

            if (error) {
                throw new Error("Не удалось удалить старые строки по ШК перед обновлением.");
            }
        }

        const insertChunks = chunkArray(syncPlan.rowsToInsert, INSERT_CHUNK_SIZE);
        for (const rowsChunk of insertChunks) {
            await insertRowsAdaptive(rowsChunk);
        }
    }

    async function insertRowsAdaptive(rowsChunk) {
        const preparedRows = rowsChunk
            .map((row) => sanitizeInsertRow(row))
            .filter((row) => Object.keys(row).length > 0);

        if (!preparedRows.length) return;

        const { error } = await supabaseClient
            .from(TABLE_PURE)
            .insert(preparedRows);

        if (!error) return;

        const missingColumn = extractMissingColumnName(error);
        if (
            missingColumn
            && preparedRows.some((row) => Object.prototype.hasOwnProperty.call(row, missingColumn))
        ) {
            unsupportedInsertColumns.add(missingColumn);
            await insertRowsAdaptive(rowsChunk);
            return;
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось вставить новые строки в pure_losses_rep: ${errorText}`);
    }

    function sanitizeInsertRow(row) {
        const out = {};
        Object.entries(row || {}).forEach(([key, value]) => {
            if (unsupportedInsertColumns.has(key)) return;
            if (value === undefined) return;
            out[key] = value;
        });
        return out;
    }

    function extractMissingColumnName(error) {
        const text = String(error?.message || error?.details || "");
        if (!text) return "";

        const match = text.match(/column\s+([^\s]+)\s+does not exist/i);
        if (!match || !match[1]) return "";

        const token = String(match[1]).replace(/"/g, "");
        const parts = token.split(".");
        return parts[parts.length - 1] || "";

    }

    function toInsertPayload(row) {
        return {
            shk: row.shk,
            nm: row.nm,
            decription: row.decription,
            brand: row.brand,
            shk_state_before_lost: row.shk_state_before_lost,
            wh_id: row.wh_id,
            date_lost: row.date_lost,
            lr: row.lr,
            price: row.price
        };
    }

    function toInsertPayloadFromExisting(row, fallbackShk) {
        const date = parseDateValue(row?.date_lost);
        return {
            shk: normalizeShk(row?.shk) || fallbackShk,
            nm: toIntegerOrNull(row?.nm),
            decription: toText(row?.decription),
            brand: toText(row?.brand),
            shk_state_before_lost: toText(row?.shk_state_before_lost || row?.shk_state),
            wh_id: normalizeToken(row?.wh_id),
            date_lost: date ? formatIsoDate(date) : (toText(row?.date_lost) || null),
            lr: toIntegerOrNull(row?.lr) ?? normalizeLossReason(row?.lr),
            price: toNumberOrNull(row?.price) ?? 0
        };
    }

    function renderSummary(syncStats) {
        setStatus(`Добавлено строк: ${formatInt(syncStats?.insertedNew)}`, "success");
    }

    function setBusy(busy) {
        refreshBtn.disabled = busy;
        refreshBtn.textContent = "Загрузить .xlsx";
        window.MiniUI?.setLoaderVisible?.(busy);
    }

    function setStatus(message, type) {
        if (!statusLineEl) return;
        const text = String(message || "").trim();
        statusLineEl.textContent = text;
        statusLineEl.style.display = text ? "block" : "none";
        statusLineEl.style.color = type === "error"
            ? "#dc2626"
            : type === "success"
                ? "#15803d"
                : "#334155";
    }

    function getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }

    function getCellValue(rawRow, normalizedRow, columnKey) {
        const variants = COLUMN_VARIANTS[columnKey] || [];
        for (const name of variants) {
            if (Object.prototype.hasOwnProperty.call(rawRow, name)) {
                return rawRow[name];
            }
        }

        const normalizedVariants = NORMALIZED_COLUMN_VARIANTS[columnKey] || [];
        for (const normalized of normalizedVariants) {
            if (Object.prototype.hasOwnProperty.call(normalizedRow, normalized)) {
                return normalizedRow[normalized];
            }
        }
        return "";
    }

    function buildNormalizedRow(row) {
        const output = {};
        Object.keys(row || {}).forEach((key) => {
            output[normalizeHeaderKey(key)] = row[key];
        });
        return output;
    }

    function normalizeHeaderKey(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/\u00a0/g, " ")
            .replace(/ё/g, "е")
            .replace(/['"`]/g, "")
            .replace(/[()\[\]]/g, "")
            .replace(/[\s_-]+/g, "");
    }

    function normalizeToken(value) {
        if (value === null || value === undefined) return "";

        if (typeof value === "number" && Number.isFinite(value)) {
            if (Number.isInteger(value)) return String(value);
            return String(value).replace(/\.0+$/, "");
        }

        const raw = String(value).trim();
        if (!raw) return "";

        const compact = raw.replace(/\s+/g, "");
        if (/^-?\d+\.0+$/.test(compact)) {
            return compact.replace(/\.0+$/, "");
        }
        return compact;
    }

    function normalizeShk(value) {
        return normalizeToken(value);
    }

    function normalizeLossReason(value) {
        const token = normalizeToken(value);
        if (!token) return "";

        if (/^-?\d+$/.test(token)) {
            return String(parseInt(token, 10));
        }

        const intValue = toIntegerOrNull(token);
        if (intValue !== null) return String(intValue);

        return token;
    }

    function toText(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim();
    }

    function toIntegerOrNull(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);

        const raw = String(value)
            .trim()
            .replace(/\u00a0/g, "")
            .replace(/\s+/g, "")
            .replace(",", ".");

        if (!raw) return null;
        if (/^-?\d+$/.test(raw)) return Number(raw);

        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }

    function toNumberOrNull(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number" && Number.isFinite(value)) return value;

        const raw = String(value)
            .trim()
            .replace(/\u00a0/g, "")
            .replace(/\s+/g, "");

        if (!raw) return null;

        let normalized = raw;
        const hasComma = raw.includes(",");
        const hasDot = raw.includes(".");

        if (hasComma && hasDot) {
            const lastComma = raw.lastIndexOf(",");
            const lastDot = raw.lastIndexOf(".");
            if (lastComma > lastDot) {
                normalized = raw.replace(/\./g, "").replace(",", ".");
            } else {
                normalized = raw.replace(/,/g, "");
            }
        } else if (hasComma) {
            normalized = raw.replace(",", ".");
        }

        normalized = normalized.replace(/[^\d.-]/g, "");
        if (!normalized) return null;

        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function isTrueLike(value) {
        if (value === true) return true;
        if (value === false || value === 0 || value === null || value === undefined) return false;

        const normalized = String(value).trim().toLowerCase();
        return normalized === "true"
            || normalized === "1"
            || normalized === "yes"
            || normalized === "да";
    }

    function parseDateValue(value) {
        if (value === null || value === undefined || value === "") return null;

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return new Date(value.getFullYear(), value.getMonth(), value.getDate());
        }

        if (typeof value === "number" && Number.isFinite(value)) {
            const excelEpochOffset = 25569;
            const dayMs = 86400 * 1000;
            const ts = (Math.floor(value) - excelEpochOffset) * dayMs;
            const d = new Date(ts);
            if (!Number.isNaN(d.getTime())) {
                return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            }
        }

        const raw = String(value).trim();
        if (!raw) return null;

        const datePart = raw.replace("T", " ").split(" ")[0];

        let match = datePart.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
        if (match) {
            let year = Number(match[3]);
            if (year < 100) year += 2000;

            const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
            if (!Number.isNaN(date.getTime())) return date;
        }

        match = datePart.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
        if (match) {
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            if (!Number.isNaN(date.getTime())) return date;
        }

        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        }

        return null;
    }

    function formatIsoDate(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, "0");
        const d = String(dateObj.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    function compareDateTs(leftTs, rightTs) {
        const left = Number.isFinite(leftTs) ? leftTs : null;
        const right = Number.isFinite(rightTs) ? rightTs : null;

        if (left === null && right === null) return 0;
        if (left !== null && right === null) return 1;
        if (left === null && right !== null) return -1;
        if (left === right) return 0;
        return left > right ? 1 : -1;
    }

    function getNewestExistingRow(rows) {
        let newestRow = rows[0] || null;
        let newestTs = null;

        for (const row of rows) {
            const parsed = parseDateValue(row?.date_lost);
            if (!parsed) continue;

            const ts = parsed.getTime();
            if (newestTs === null || ts > newestTs) {
                newestTs = ts;
                newestRow = row;
            }
        }

        return {
            row: newestRow,
            ts: newestTs
        };
    }

    function chunkArray(items, chunkSize) {
        const out = [];
        const size = Math.max(Number(chunkSize || 1), 1);
        for (let i = 0; i < items.length; i += size) {
            out.push(items.slice(i, i + size));
        }
        return out;
    }

    function formatInt(value) {
        const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
        return Math.trunc(safe).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
})();
