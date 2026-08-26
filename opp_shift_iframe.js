(function () {
    "use strict";

    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const DEFAULT_WH_ID = "50144199";
    const DEFAULT_SHIFT_SCOPE = "opp_telegram_shift";
    const DEFAULT_SHIFT_FALLBACK_SCOPE = "opp_dashboard_shift";
    const DEFAULT_LAG_SCOPE = "opp_telegram_rolling30";
    const DEFAULT_LAG_FALLBACK_SCOPE = "opp_dashboard_rolling30";
    const CACHE_TABLE = "opp_reports_cache";
    const SETTINGS_TABLE = "opp_alert_settings";
    const MSK_TIME_ZONE = "Europe/Moscow";

    const DEFAULT_OPTIONS = {
        min_total_percent: 70,
        warn_total_percent: 85,
        min_sum_percent: 70,
        warn_sum_percent: 85,
        min_expensive_percent: 70,
        warn_expensive_percent: 95,
        low_quality_threshold_percent: 70,
        include_warnings: true,
        lag_missing_upload_penalty_percent: 10
    };

    const STATUS_LABELS = {
        SPS_WMI: "SPS + WMI",
        SMC: "SMC",
        SMS: "SMS",
        WMI_BZ: "WMI Без заказа",
        RWP: "RWP",
        "24": "24",
        ORS: "ORS",
        REPACK: "Упаковка"
    };

    const STATUS_ORDER = ["24", "REPACK", "RWP", "SMC", "SMS", "SPS_WMI", "WMI_BZ", "ORS"];
    const MAIN_EMPLOYEE_KEYS = new Set(["REPACK", "SPS_WMI", "WMI_BZ", "SMC", "SMS", "RWP"]);

    const root = document.getElementById("opp-frame");
    const params = new URLSearchParams(window.location.search);
    const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    let refreshTimer = null;

    function text(value) {
        return String(value ?? "").trim();
    }

    function escapeHtml(value) {
        return text(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function parseMaybeJson(value) {
        if (typeof value !== "string") return value;
        const raw = value.trim();
        if (!raw || (!raw.startsWith("{") && !raw.startsWith("["))) return value;
        try {
            return JSON.parse(raw);
        } catch {
            return value;
        }
    }

    function num(value) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const raw = text(value).replace(/\s+/g, "").replace(",", ".");
        if (!raw) return 0;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function get(obj, keys) {
        if (!obj || typeof obj !== "object") return undefined;
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
        }
        return undefined;
    }

    function getText(obj, keys) {
        return text(get(obj, keys));
    }

    function getNum(obj, keys) {
        return num(get(obj, keys));
    }

    function pct(part, total) {
        const totalNum = num(total);
        if (totalNum <= 0) return null;
        return Math.max(0, (num(part) / totalNum) * 100);
    }

    function formatInt(value) {
        return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(num(value));
    }

    function formatCurrency(value) {
        return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(num(value))} ₽`;
    }

    function formatPercent(value) {
        if (value === null || !Number.isFinite(value)) return "-";
        return `${Math.round(value)}%`;
    }

    function clampPercent(value) {
        if (value === null || !Number.isFinite(value)) return null;
        return Math.max(0, Math.min(100, value));
    }

    function normalizeDeadlineKey(value) {
        const raw = text(value).toUpperCase().replace(/\s+/g, "");
        if (!raw) return "";
        if (raw === "SPS+WMI" || raw === "SPS_WMI") return "SPS_WMI";
        if (raw === "WMIБЕЗЗАКАЗА" || raw === "WMI_BZ") return "WMI_BZ";
        if (raw === "УПАКОВКА") return "REPACK";
        return raw;
    }

    function parseIsoDate(value) {
        const raw = text(value);
        const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        const ru = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
        if (!ru) return "";
        const year = ru[3].length === 2 ? `20${ru[3]}` : ru[3];
        return `${year}-${String(ru[2]).padStart(2, "0")}-${String(ru[1]).padStart(2, "0")}`;
    }

    function shiftIsoDate(isoDate, daysDelta) {
        const safe = parseIsoDate(isoDate);
        if (!safe) return "";
        const dt = new Date(`${safe}T00:00:00Z`);
        if (!Number.isFinite(dt.getTime())) return "";
        dt.setUTCDate(dt.getUTCDate() + Number(daysDelta || 0));
        return dt.toISOString().slice(0, 10);
    }

    function formatDateRu(value) {
        const iso = parseIsoDate(value);
        if (!iso) return text(value);
        const [year, month, day] = iso.split("-");
        return `${day}.${month}.${year}`;
    }

    function formatDateTimeRu(value) {
        const raw = text(value);
        if (!raw) return "";

        const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (isoMatch) {
            const dt = new Date(raw);
            if (Number.isFinite(dt.getTime())) {
                return new Intl.DateTimeFormat("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: MSK_TIME_ZONE
                }).format(dt);
            }
            return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]} ${isoMatch[4]}:${isoMatch[5]}`;
        }

        const ruMatch = raw.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
        if (ruMatch) {
            const date = `${ruMatch[1].padStart(2, "0")}.${ruMatch[2].padStart(2, "0")}.${ruMatch[3]}`;
            return ruMatch[4] ? `${date} ${ruMatch[4].padStart(2, "0")}:${ruMatch[5]}` : date;
        }

        return raw;
    }

    function moscowNowParts() {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: MSK_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            hourCycle: "h23"
        }).formatToParts(new Date());
        const out = {};
        parts.forEach((part) => {
            if (part.type !== "literal") out[part.type] = part.value;
        });
        return out;
    }

    function currentOperationalDate() {
        const parts = moscowNowParts();
        const today = `${parts.year}-${parts.month}-${parts.day}`;
        return Number(parts.hour || 0) < 8 ? shiftIsoDate(today, -1) : today;
    }

    function normalizeArray(value) {
        return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
    }

    function normalizeStatusCounts(value) {
        return (Array.isArray(value) ? value : [])
            .map((item) => ({
                status: getText(item, ["status", "name", "label"]),
                count: getNum(item, ["count", "value"])
            }))
            .filter((item) => item.status && item.count > 0);
    }

    function normalizeDetail(raw) {
        const key = normalizeDeadlineKey(getText(raw, ["key", "display_key", "displayKey"]));
        const displayKey = STATUS_LABELS[key] || getText(raw, ["display_key", "displayKey", "key"]) || key || "Выгрузка";
        const dueTotal = getNum(raw, ["due_total_unique_shk", "dueTotal", "due_total", "totalDue"]);
        const analyzed = getNum(raw, ["analyzed_due_unique_shk", "analyzed", "analyzed_due", "analyzedDue"]);
        const dueSum = getNum(raw, ["due_total_sum_price", "dueSumPrice", "due_sum_price"]);
        const analyzedSum = getNum(raw, ["analyzed_due_sum_price", "analyzedSumPrice", "analyzed_sum_price"]);
        const expensiveDue = getNum(raw, ["expensive_due_total_unique_shk", "expensiveDueTotal", "expensive_due_total"]);
        const expensiveAnalyzed = getNum(raw, ["expensive_analyzed_due_unique_shk", "expensiveAnalyzed", "expensive_analyzed"]);
        const uploadStatus = getText(raw, ["upload_status", "uploadStatus"]);
        const analyzerValues = normalizeArray(get(raw, ["analyzer_values", "analyzerValues", "employeeNames"]));
        const dueLabel = getText(raw, ["due_for_date_label", "dueForDateLabel", "due_until_label", "dueUntilLabel"]);
        const lowQualityCount = getNum(raw, ["low_quality_without_comment_unique_shk", "lowQualityWithoutComment", "low_quality_without_comment"]);
        const lowQualityPercentRaw = get(raw, ["low_quality_without_comment_percent", "lowQualityWithoutCommentPercent"]);
        const lowQualityPercent = lowQualityPercentRaw === undefined || lowQualityPercentRaw === null || text(lowQualityPercentRaw) === ""
            ? pct(lowQualityCount, dueTotal)
            : num(lowQualityPercentRaw);

        return {
            key,
            displayKey,
            dueTotal,
            analyzed,
            dueSum,
            analyzedSum,
            expensiveDue,
            expensiveAnalyzed,
            uploadStatus: uploadStatus || (dueTotal > 0 ? "Есть" : "Нет выгрузки"),
            analyzerValues,
            dueLabel,
            breakdownStatusCounts: normalizeStatusCounts(get(raw, ["breakdown_status_counts", "breakdownStatusCounts"])),
            lowQualityStatus: getText(raw, ["low_quality_status", "lowQualityStatus"]) || "Ожидает обработки",
            lowQualityCount,
            lowQualityPercent
        };
    }

    function normalizeShift(raw) {
        const operationalDate = parseIsoDate(getText(raw, ["operational_date_key", "operationalDateKey", "date"]));
        const shiftId = getText(raw, ["shift_id", "shiftId"]);
        const idDate = shiftId.match(/(?:day|night|shift):(\d{4}-\d{2}-\d{2})/)?.[1] || "";
        const date = operationalDate || idDate;
        const shiftName = getText(raw, ["shift_name", "shiftName"]) || "Смена";
        const shiftLabel = getText(raw, ["shift_label", "displayDate", "dateLabel", "operational_date_label"]) || formatDateRu(date);
        const details = (Array.isArray(raw?.details) ? raw.details : []).map(normalizeDetail).filter(Boolean);

        return {
            shiftId: shiftId || (date ? `shift:${date}` : ""),
            shiftName,
            shiftLabel,
            date,
            totalDue: getNum(raw, ["total_due_unique_shk", "totalDue", "dueTotal"]),
            analyzed: getNum(raw, ["analyzed_due_unique_shk", "analyzed", "analyzedDue"]),
            dueSum: getNum(raw, ["total_due_sum_price", "dueSumPrice"]),
            analyzedSum: getNum(raw, ["analyzed_due_sum_price", "analyzedSumPrice"]),
            expensiveDue: getNum(raw, ["expensive_due_total_unique_shk", "expensiveDueTotal"]),
            expensiveAnalyzed: getNum(raw, ["expensive_analyzed_due_unique_shk", "expensiveAnalyzed"]),
            analyzerValues: normalizeArray(get(raw, ["analyzer_values", "analyzerValues", "employeeNames"])),
            details
        };
    }

    function mergeStatusCounts(existing, incoming) {
        const map = new Map();
        [...(existing || []), ...(incoming || [])].forEach((item) => {
            const key = text(item.status);
            if (!key) return;
            map.set(key, (map.get(key) || 0) + num(item.count));
        });
        return Array.from(map, ([status, count]) => ({ status, count }))
            .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status, "ru"));
    }

    function mergeDetails(details) {
        const map = new Map();
        details.forEach((item) => {
            const key = item.key || normalizeDeadlineKey(item.displayKey) || item.displayKey;
            const existing = map.get(key);
            if (!existing) {
                map.set(key, { ...item, analyzerValues: [...item.analyzerValues] });
                return;
            }
            existing.dueTotal += item.dueTotal;
            existing.analyzed += item.analyzed;
            existing.dueSum += item.dueSum;
            existing.analyzedSum += item.analyzedSum;
            existing.expensiveDue += item.expensiveDue;
            existing.expensiveAnalyzed += item.expensiveAnalyzed;
            existing.lowQualityCount += item.lowQualityCount;
            existing.lowQualityPercent = pct(existing.lowQualityCount, existing.dueTotal);
            existing.uploadStatus = /есть/i.test(existing.uploadStatus) || /есть/i.test(item.uploadStatus) || item.dueTotal > 0 ? "Есть" : "Нет выгрузки";
            existing.analyzerValues = Array.from(new Set([...existing.analyzerValues, ...item.analyzerValues])).sort((a, b) => a.localeCompare(b, "ru"));
            existing.breakdownStatusCounts = mergeStatusCounts(existing.breakdownStatusCounts, item.breakdownStatusCounts);
        });
        return Array.from(map.values()).sort((a, b) => {
            const left = STATUS_ORDER.indexOf(a.key);
            const right = STATUS_ORDER.indexOf(b.key);
            if (left !== -1 || right !== -1) return (left === -1 ? 999 : left) - (right === -1 ? 999 : right);
            return a.displayKey.localeCompare(b.displayKey, "ru");
        });
    }

    function mergeShiftsByDate(shifts, dateKey) {
        const exact = shifts.find((shift) => shift.shiftId === `shift:${dateKey}`);
        if (exact) return exact;

        const sameDate = shifts.filter((shift) => shift.date === dateKey);
        if (!sameDate.length) return null;

        const details = mergeDetails(sameDate.flatMap((shift) => shift.details));
        const employees = new Set();
        sameDate.forEach((shift) => shift.analyzerValues.forEach((name) => employees.add(name)));
        details.forEach((detail) => detail.analyzerValues.forEach((name) => employees.add(name)));

        return {
            shiftId: `shift:${dateKey}`,
            shiftName: "Смена",
            shiftLabel: formatDateRu(dateKey),
            date: dateKey,
            totalDue: sameDate.reduce((sum, shift) => sum + shift.totalDue, 0),
            analyzed: sameDate.reduce((sum, shift) => sum + shift.analyzed, 0),
            dueSum: sameDate.reduce((sum, shift) => sum + shift.dueSum, 0),
            analyzedSum: sameDate.reduce((sum, shift) => sum + shift.analyzedSum, 0),
            expensiveDue: sameDate.reduce((sum, shift) => sum + shift.expensiveDue, 0),
            expensiveAnalyzed: sameDate.reduce((sum, shift) => sum + shift.expensiveAnalyzed, 0),
            analyzerValues: Array.from(employees).sort((a, b) => a.localeCompare(b, "ru")),
            details
        };
    }

    function findTargetShift(payload) {
        const shifts = (Array.isArray(payload?.shift_dynamics) ? payload.shift_dynamics : [])
            .map(normalizeShift)
            .filter((shift) => shift.date || shift.shiftId);
        if (!shifts.length) return null;

        const requestedShiftId = text(params.get("shift_id"));
        if (requestedShiftId) {
            const exact = shifts.find((shift) => shift.shiftId === requestedShiftId);
            if (exact) return exact;
        }

        const requestedDate = parseIsoDate(params.get("date")) || currentOperationalDate();
        const merged = mergeShiftsByDate(shifts, requestedDate);
        if (merged) return merged;

        return shifts.sort((a, b) => text(b.date).localeCompare(text(a.date)))[0] || null;
    }

    function detailHasUpload(detail) {
        return detail.dueTotal > 0 || /есть/i.test(detail.uploadStatus);
    }

    function assessDetail(detail, options) {
        const totalPct = pct(detail.analyzed, detail.dueTotal);
        const sumPct = pct(detail.analyzedSum, detail.dueSum);
        const expensivePct = pct(detail.expensiveAnalyzed, detail.expensiveDue);
        const hasUpload = detailHasUpload(detail);

        if (!hasUpload || detail.dueTotal <= 0) {
            return {
                level: "bad",
                hasProblem: true,
                mark: "!",
                problemText: `${detail.displayKey}: нет выгрузки`,
                totalPct,
                sumPct,
                expensivePct
            };
        }

        const valueProtected = expensivePct !== null && expensivePct >= 100 && sumPct !== null && sumPct > 80;
        let level = "good";
        const problems = [];

        if (!valueProtected) {
            if (totalPct !== null && totalPct < num(options.min_total_percent)) {
                level = "bad";
                problems.push(`разбор ${formatPercent(totalPct)}`);
            } else if (options.include_warnings !== false && totalPct !== null && totalPct < num(options.warn_total_percent) && level !== "bad") {
                level = "warn";
                problems.push(`разбор ${formatPercent(totalPct)}`);
            }
        }

        if (!valueProtected) {
            if (sumPct !== null && sumPct < num(options.min_sum_percent)) {
                level = "bad";
                problems.push(`сумма ${formatPercent(sumPct)}`);
            } else if (options.include_warnings !== false && sumPct !== null && sumPct < num(options.warn_sum_percent) && level !== "bad") {
                level = "warn";
                problems.push(`сумма ${formatPercent(sumPct)}`);
            }
        }

        if (expensivePct !== null && expensivePct < num(options.min_expensive_percent)) {
            level = "bad";
            problems.push(`дорогостой ${formatPercent(expensivePct)}`);
        } else if (options.include_warnings !== false && expensivePct !== null && expensivePct < num(options.warn_expensive_percent) && level !== "bad") {
            level = "warn";
            problems.push(`дорогостой ${formatPercent(expensivePct)}`);
        }

        return {
            level,
            hasProblem: problems.length > 0,
            mark: level === "good" ? "✓" : "!",
            problemText: problems.length ? `${detail.displayKey}: ${problems.join(", ")}` : "",
            totalPct,
            sumPct,
            expensivePct
        };
    }

    function assessSummary(shift, options) {
        const totalPct = pct(shift.analyzed, shift.totalDue);
        const sumPct = pct(shift.analyzedSum, shift.dueSum);
        const expensivePct = pct(shift.expensiveAnalyzed, shift.expensiveDue);
        return {
            totalPct,
            sumPct,
            expensivePct,
            totalLevel: totalPct !== null && totalPct < num(options.min_total_percent) ? "bad" : totalPct !== null && totalPct < num(options.warn_total_percent) ? "warn" : "good",
            sumLevel: sumPct !== null && sumPct < num(options.min_sum_percent) ? "bad" : sumPct !== null && sumPct < num(options.warn_sum_percent) ? "warn" : "good",
            expensiveLevel: expensivePct !== null && expensivePct < 100 ? "bad" : "good"
        };
    }

    function buildQualityAssessments(shift, options) {
        const threshold = num(options.low_quality_threshold_percent);
        return shift.details
            .map((detail) => {
                if (detail.lowQualityCount <= 0 || detail.lowQualityPercent === null || detail.lowQualityPercent <= threshold) return null;
                return `${detail.displayKey}: ${detail.lowQualityStatus} без комментария ${formatPercent(detail.lowQualityPercent)}`;
            })
            .filter(Boolean);
    }

    function lagEmojiClass(value) {
        if (value === null || !Number.isFinite(value)) return "";
        if (value > 60) return "bad";
        if (value > 30) return "warn";
        return "good";
    }

    function buildCurrentUploadPenaltyMap(currentShift, options) {
        const penaltyStep = Math.max(0, num(options.lag_missing_upload_penalty_percent));
        const out = new Map();
        if (!penaltyStep || !currentShift?.details?.length) return out;

        currentShift.details.forEach((detail) => {
            if (detailHasUpload(detail)) return;
            out.set(detail.key || normalizeDeadlineKey(detail.displayKey), {
                penalty: penaltyStep,
                dates: detail.dueLabel ? [detail.dueLabel] : []
            });
        });
        return out;
    }

    function buildLagItems(lagPayload, currentShift, options) {
        const shifts = (Array.isArray(lagPayload?.shift_dynamics) ? lagPayload.shift_dynamics : [])
            .map(normalizeShift)
            .filter((shift) => shift.details.length);
        const details = shifts.flatMap((shift) => shift.details);
        if (!details.length) return [];

        const grouped = new Map();
        details.forEach((detail) => {
            const key = detail.key || normalizeDeadlineKey(detail.displayKey) || detail.displayKey;
            const bucket = grouped.get(key) || {
                key,
                title: detail.displayKey,
                due: 0,
                analyzed: 0,
                dueSum: 0,
                analyzedSum: 0
            };
            bucket.due += detail.dueTotal;
            bucket.analyzed += detail.analyzed;
            bucket.dueSum += detail.dueSum;
            bucket.analyzedSum += detail.analyzedSum;
            grouped.set(key, bucket);
        });

        const penaltyMap = buildCurrentUploadPenaltyMap(currentShift, options);
        const buckets = Array.from(grouped.values());
        const totalDueSum = buckets.reduce((sum, item) => sum + item.dueSum, 0);
        const totalAnalyzedSum = buckets.reduce((sum, item) => sum + item.analyzedSum, 0);
        const totalDue = buckets.reduce((sum, item) => sum + item.due, 0);
        const totalAnalyzed = buckets.reduce((sum, item) => sum + item.analyzed, 0);
        const overallBasePct = totalDueSum > 0 ? pct(totalAnalyzedSum, totalDueSum) : pct(totalAnalyzed, totalDue);
        const overallPenalty = buckets.reduce((sum, item) => sum + num(penaltyMap.get(item.key)?.penalty), 0);
        const overallLag = overallBasePct === null ? (overallPenalty ? overallPenalty : null) : clampPercent(100 - overallBasePct + overallPenalty);

        const out = [{ title: "Общее", lag: overallLag, isOverall: true }];
        buckets
            .sort((a, b) => a.title.localeCompare(b.title, "ru"))
            .forEach((item) => {
                const basePct = item.dueSum > 0 ? pct(item.analyzedSum, item.dueSum) : pct(item.analyzed, item.due);
                const penalty = num(penaltyMap.get(item.key)?.penalty);
                const lag = basePct === null ? (penalty ? penalty : null) : clampPercent(100 - basePct + penalty);
                out.push({ title: item.title, lag, isOverall: false });
            });
        return out;
    }

    async function fetchLatestCache(scopes, whId) {
        const scopeList = Array.from(new Set(scopes.map(text).filter(Boolean)));
        if (!client || !scopeList.length) return null;

        for (const scope of scopeList) {
            const { data, error } = await client
                .from(CACHE_TABLE)
                .select("wh_id,cache_scope,date_from,date_to,payload,refreshed_at,source_generated_at,stale_after")
                .eq("wh_id", whId)
                .eq("cache_scope", scope)
                .order("refreshed_at", { ascending: false })
                .limit(1);

            if (error) throw new Error(error.message || "Не удалось прочитать кэш Supabase");
            if (Array.isArray(data) && data.length) return data[0];
        }

        return null;
    }

    async function fetchOptions(whId) {
        if (!client) return { ...DEFAULT_OPTIONS };
        try {
            const { data, error } = await client
                .from(SETTINGS_TABLE)
                .select("alert_type,setting_key,setting_value,value_type")
                .eq("wh_id", whId)
                .in("alert_type", ["summary", "lag_attention"]);
            if (error) throw error;
            const options = { ...DEFAULT_OPTIONS };
            (Array.isArray(data) ? data : []).forEach((row) => {
                const key = text(row.setting_key);
                if (!key) return;
                let value = parseMaybeJson(row.setting_value);
                if (row.value_type === "number") value = num(value);
                if (row.value_type === "boolean") value = value === true || text(value).toLowerCase() === "true";
                options[key] = value;
            });
            return options;
        } catch (error) {
            console.warn("Не удалось прочитать настройки алертов, использую дефолты:", error?.message || error);
            return { ...DEFAULT_OPTIONS };
        }
    }

    function freshnessText(cacheRow, payload) {
        const generated = getText(payload, ["generated_at", "generatedAt"]) || getText(payload?.today_deadline, ["as_of_label", "asOfText"]);
        return formatDateTimeRu(generated || cacheRow?.source_generated_at || cacheRow?.refreshed_at) || "—";
    }

    function renderState(message, isError) {
        root.innerHTML = `<div class="state ${isError ? "error-state" : ""}">${escapeHtml(message)}</div>`;
    }

    function renderSummaryCards(shift, summary) {
        const problemCount = shift.details.map((detail) => assessDetail(detail, window.__oppIframeOptions || DEFAULT_OPTIONS)).filter((item) => item.hasProblem).length;
        return `
            <div class="summary-grid">
                <div class="summary-card ${summary.totalLevel}">
                    <div class="summary-label">Разобрано ШК</div>
                    <div class="summary-value">${escapeHtml(formatPercent(summary.totalPct))}</div>
                </div>
                <div class="summary-card ${summary.sumLevel}">
                    <div class="summary-label">Сумма</div>
                    <div class="summary-value">${escapeHtml(formatPercent(summary.sumPct))}</div>
                </div>
                <div class="summary-card ${summary.expensiveLevel}">
                    <div class="summary-label">Дорогостой</div>
                    <div class="summary-value">${escapeHtml(formatPercent(summary.expensivePct))}</div>
                </div>
                <div class="summary-card ${problemCount ? "warn" : "good"}">
                    <div class="summary-label">Требуют внимания</div>
                    <div class="summary-value">${formatInt(problemCount)}</div>
                </div>
            </div>
        `;
    }

    function renderLagPanel(lagItems) {
        if (!lagItems.length) {
            return `
                <aside class="side-card">
                    <div class="side-title">Отставание</div>
                    <div class="lag-main">—</div>
                    <div class="lag-list"><div class="lag-item"><span class="lag-name">Нет данных</span></div></div>
                </aside>
            `;
        }

        const overall = lagItems.find((item) => item.isOverall) || lagItems[0];
        const itemsHtml = lagItems
            .filter((item) => !item.isOverall)
            .map((item) => `
                <div class="lag-item">
                    <span class="lag-name" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
                    <span class="lag-value ${lagEmojiClass(item.lag)}">${escapeHtml(formatPercent(item.lag))}</span>
                </div>
            `).join("");

        return `
            <aside class="side-card">
                <div class="side-title">Отставание</div>
                <div class="lag-main ${lagEmojiClass(overall.lag)}">${escapeHtml(formatPercent(overall.lag))}</div>
                <div class="lag-list">${itemsHtml || ""}</div>
            </aside>
        `;
    }

    function renderStatusCard(detail, assessment) {
        const employeeValues = detail.analyzerValues.filter(Boolean);
        const employeeText = employeeValues.length ? employeeValues.join(", ") : "—";
        const sumText = detail.dueSum > 0 ? formatPercent(assessment.sumPct) : "—";
        const expensiveText = detail.expensiveDue > 0
            ? `${formatInt(detail.expensiveAnalyzed)}/${formatInt(detail.expensiveDue)} (${formatPercent(assessment.expensivePct)})`
            : "—";
        const uploadTitle = detailHasUpload(detail) ? "Выгрузка есть" : "Нет выгрузки";

        return `
            <article class="status-card ${assessment.level}" title="${escapeHtml(uploadTitle)}">
                <div class="status-top">
                    <span class="status-mark ${assessment.level}">${escapeHtml(assessment.mark)}</span>
                    <div class="status-name" title="${escapeHtml(detail.displayKey)}">${escapeHtml(detail.displayKey)}</div>
                </div>
                <div class="metric-row">
                    <span>Разбор</span>
                    <span class="metric-value">${formatInt(detail.analyzed)}/${formatInt(detail.dueTotal)} (${escapeHtml(formatPercent(assessment.totalPct))})</span>
                </div>
                <div class="metric-row">
                    <span>Сумма</span>
                    <span class="metric-value">${escapeHtml(sumText)}</span>
                </div>
                <div class="metric-row">
                    <span>Дорогостой</span>
                    <span class="metric-value">${escapeHtml(expensiveText)}</span>
                </div>
                <div class="employee-line" title="${escapeHtml(employeeText)}">${escapeHtml(employeeText)}</div>
            </article>
        `;
    }

    function render(payload, cacheRow, lagPayload, options) {
        const shift = findTargetShift(payload);
        if (!shift) {
            renderState("В кэше не найдена смена для отображения. Проверьте, что opp_telegram_shift содержит shift_dynamics.", true);
            return;
        }

        window.__oppIframeOptions = options;
        const details = mergeDetails(shift.details);
        shift.details = details;

        const mainEmployees = new Set(shift.analyzerValues);
        details.forEach((detail) => {
            if (!MAIN_EMPLOYEE_KEYS.has(detail.key)) return;
            detail.analyzerValues.forEach((name) => mainEmployees.add(name));
        });
        const employeeLine = Array.from(mainEmployees).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")).join(", ") || "—";
        const summary = assessSummary(shift, options);
        const statusAssessments = details.map((detail) => ({ detail, assessment: assessDetail(detail, options) }));
        const quality = buildQualityAssessments(shift, options);
        const lagItems = buildLagItems(lagPayload, shift, options);
        const actualText = freshnessText(cacheRow, payload);
        const scope = getText(cacheRow, ["cache_scope", "cacheScope"]);

        const statusCards = statusAssessments
            .map(({ detail, assessment }) => renderStatusCard(detail, assessment))
            .join("");
        const qualityHtml = quality.length
            ? `<div class="quality-list">${quality.map((item) => `<div class="quality-item">Низкокачественный разбор: ${escapeHtml(item)}</div>`).join("")}</div>`
            : "";

        root.innerHTML = `
            <section class="hero">
                <div class="hero-main">
                    <div class="eyebrow">Прогресс ОПП</div>
                    <div class="title-row">
                        <h1>${escapeHtml(shift.shiftName)} ${escapeHtml(shift.shiftLabel)}</h1>
                        <div class="freshness" title="Кэш: ${escapeHtml(scope)}">
                            <span class="freshness-dot"></span>
                            <span>Актуально: ${escapeHtml(actualText)}</span>
                        </div>
                    </div>
                    <div class="meta-row">
                        <span class="meta-pill">Сотрудники: ${escapeHtml(employeeLine)}</span>
                        <span class="meta-pill">WH: ${escapeHtml(params.get("wh_id") || DEFAULT_WH_ID)}</span>
                    </div>
                    ${renderSummaryCards(shift, summary)}
                </div>
                ${renderLagPanel(lagItems)}
            </section>

            <section class="section-title">
                <h2>Статусы за смену</h2>
                <div class="section-note">Обновляется из Supabase-кэша</div>
            </section>
            <section class="status-grid">
                ${statusCards || `<div class="state">По смене нет детализации.</div>`}
            </section>
            ${qualityHtml}
        `;
    }

    async function load() {
        if (!client) {
            renderState("Supabase SDK не загрузился. Проверьте доступ к CDN или разместите библиотеку локально.", true);
            return;
        }

        const whId = text(params.get("wh_id")) || DEFAULT_WH_ID;
        const shiftScope = text(params.get("scope")) || DEFAULT_SHIFT_SCOPE;
        const shiftFallbackScope = text(params.get("fallback_scope")) || DEFAULT_SHIFT_FALLBACK_SCOPE;
        const lagScope = text(params.get("lag_scope")) || DEFAULT_LAG_SCOPE;
        const lagFallbackScope = text(params.get("lag_fallback_scope")) || DEFAULT_LAG_FALLBACK_SCOPE;

        try {
            const [options, shiftCacheRow, lagCacheRow] = await Promise.all([
                fetchOptions(whId),
                fetchLatestCache([shiftScope, shiftFallbackScope], whId),
                fetchLatestCache([lagScope, lagFallbackScope], whId).catch(() => null)
            ]);

            if (!shiftCacheRow) {
                renderState(`Нет кэша для wh_id=${whId}. Ожидаю строку ${shiftScope}.`, true);
                return;
            }

            const payload = parseMaybeJson(shiftCacheRow.payload);
            const lagPayload = parseMaybeJson(lagCacheRow?.payload) || null;
            if (!payload || typeof payload !== "object") {
                renderState("Кэш найден, но payload не похож на JSON-отчет.", true);
                return;
            }

            render(payload, shiftCacheRow, lagPayload, options);
        } catch (error) {
            renderState(error?.message || "Не удалось загрузить прогресс ОПП.", true);
        }
    }

    function scheduleRefresh() {
        const refreshSec = Math.max(30, num(params.get("refresh")) || 60);
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(load, refreshSec * 1000);
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) load();
    });

    load();
    scheduleRefresh();
})();
