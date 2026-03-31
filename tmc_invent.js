(function () {
    "use strict";

    const FORBIDDEN_WH_MESSAGE = "ТМЦ находится на другом складе. Инвентаризация запрещена";

    const loggedRaw = localStorage.getItem("user");
    if (!loggedRaw) {
        window.location.href = "login.html";
        return;
    }

    let user = null;
    try {
        user = JSON.parse(loggedRaw);
    } catch (_) {
        window.location.href = "login.html";
        return;
    }

    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
        console.error("supabaseClient missing — ui.js must be loaded first");
        window.MiniUI?.toast?.("Supabase не инициализирован", { type: "error" });
        return;
    }

    const inventModal = document.getElementById("invent-modal");
    const inventModalContent = document.getElementById("invent-modal-content");
    const btnOpenInventModal = document.getElementById("btn-open-invent-modal");
    const btnCloseInventModal = document.getElementById("btn-close-invent-modal");
    const scanInputEl = document.getElementById("invent-scan-input");
    const resultEl = document.getElementById("invent-result");
    const resultIconEl = document.getElementById("invent-result-icon");
    const resultMessageEl = document.getElementById("invent-result-message");
    const itemNameEl = document.getElementById("invent-item-name");
    const itemPlaceEl = document.getElementById("invent-item-place");

    const modalStack = [];
    let isProcessing = false;

    const currentWhId = normalizeWhId(user?.user_wh_id);
    const currentEmpId = String(user?.id || "").trim();

    if (currentWhId === null) {
        window.MiniUI?.toast?.("Не удалось определить user_wh_id пользователя", { type: "error" });
        return;
    }

    function normalizeWhId(value) {
        const raw = String(value ?? "").trim();
        if (!raw) return null;
        if (/^-?\d+$/.test(raw)) return Number(raw);
        return raw;
    }

    function toast(message, opts = {}) {
        if (window.MiniUI?.toast) {
            window.MiniUI.toast(message, opts);
            return;
        }
        console.log(message);
    }

    function showModal(modal, closeHandler) {
        if (!modal || !modal.classList.contains("hidden")) return;
        modal.classList.remove("hidden");
        modalStack.push({ id: modal.id, close: closeHandler });
    }

    function hideModal(modal) {
        if (!modal || modal.classList.contains("hidden")) return;
        modal.classList.add("hidden");
        for (let i = modalStack.length - 1; i >= 0; i--) {
            if (modalStack[i].id === modal.id) {
                modalStack.splice(i, 1);
                break;
            }
        }
    }

    function bindModalOverlayClose(modal, closeHandler) {
        if (!modal) return;
        modal.addEventListener("click", (event) => {
            if (event.target === modal || event.target.classList.contains("modal-backdrop")) {
                closeHandler();
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        const top = modalStack[modalStack.length - 1];
        if (!top?.close) return;
        event.preventDefault();
        top.close();
    });

    function resetResult() {
        resultEl.classList.remove("success", "error");
        resultEl.classList.add("neutral");
        inventModalContent.classList.remove("scan-state-success", "scan-state-error");

        resultIconEl.textContent = "•";
        resultMessageEl.textContent = "Ожидание сканирования";
        itemNameEl.textContent = "Название: —";
        itemPlaceEl.textContent = "Место: —";
    }

    function setResultState(state, params = {}) {
        const { message = "", itemName = "—", itemPlace = "—" } = params;

        resultEl.classList.remove("neutral", "success", "error");
        resultEl.classList.add(state);

        inventModalContent.classList.remove("scan-state-success", "scan-state-error");
        if (state === "success") {
            inventModalContent.classList.add("scan-state-success");
            resultIconEl.textContent = "✔";
        } else if (state === "error") {
            inventModalContent.classList.add("scan-state-error");
            resultIconEl.textContent = "✖";
        } else {
            resultIconEl.textContent = "•";
        }

        resultMessageEl.textContent = String(message || "");
        itemNameEl.textContent = `Название: ${String(itemName || "—")}`;
        itemPlaceEl.textContent = `Место: ${String(itemPlace || "—")}`;
    }

    function openInventModal() {
        showModal(inventModal, closeInventModal);
        resetResult();
        scanInputEl.value = "";
        setTimeout(() => scanInputEl.focus(), 0);
    }

    function closeInventModal() {
        hideModal(inventModal);
    }

    function normalizeScannedItemCode(rawValue) {
        return String(rawValue || "")
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function buildItemCodeCandidates(rawValue) {
        const raw = String(rawValue || "");
        const trimmed = raw.trim();
        const normalized = normalizeScannedItemCode(raw);
        const compact = normalized.replace(/\s+/g, " ").trim();

        const out = [];
        [trimmed, normalized, compact].forEach((value) => {
            const v = String(value || "").trim();
            if (!v) return;
            if (out.includes(v)) return;
            out.push(v);
        });
        return out;
    }

    async function findTmcByItemCode(rawItemCode) {
        const candidates = buildItemCodeCandidates(rawItemCode);
        if (!candidates.length) {
            return { rows: [], error: null };
        }

        for (const candidate of candidates) {
            const { data, error } = await supabaseClient
                .from("tmc_rep")
                .select("item_code, item_name, item_place, wh_id")
                .eq("item_code", candidate)
                .limit(20);

            if (error) {
                return { rows: [], error: error };
            }

            const rows = Array.isArray(data) ? data : [];
            if (rows.length) {
                return { rows: rows, error: null };
            }
        }

        const normalized = candidates[candidates.length - 1];
        const relaxedPattern = normalized.replace(/\s+/g, "%");
        if (relaxedPattern && relaxedPattern !== normalized) {
            const { data, error } = await supabaseClient
                .from("tmc_rep")
                .select("item_code, item_name, item_place, wh_id")
                .ilike("item_code", relaxedPattern)
                .limit(20);

            if (error) {
                return { rows: [], error: error };
            }

            const rows = Array.isArray(data) ? data : [];
            if (rows.length) {
                return { rows: rows, error: null };
            }
        }

        return { rows: [], error: null };
    }

    function pickBestRow(rows) {
        if (!Array.isArray(rows) || !rows.length) return null;

        const normalizedWh = String(currentWhId);
        const sameWhRow = rows.find((row) => String(row?.wh_id ?? "").trim() === normalizedWh);
        if (sameWhRow) return sameWhRow;

        return rows[0];
    }

    async function updateInventData(row) {
        const now = window.MiniUI?.nowIsoPlus3 ? window.MiniUI.nowIsoPlus3() : new Date().toISOString();
        const payload = {
            date_invent: now,
            emp_invent: currentEmpId || null
        };

        const { error } = await supabaseClient
            .from("tmc_rep")
            .update(payload)
            .eq("item_code", String(row?.item_code || "").trim())
            .eq("wh_id", normalizeWhId(row?.wh_id));

        return error || null;
    }

    async function processScan(rawValue) {
        const normalizedInput = normalizeScannedItemCode(rawValue);
        if (!normalizedInput) {
            setResultState("error", {
                message: "Сканируйте item_code",
                itemName: "—",
                itemPlace: "—"
            });
            return;
        }

        if (isProcessing) return;
        isProcessing = true;
        scanInputEl.disabled = true;
        btnCloseInventModal.disabled = true;
        btnOpenInventModal.disabled = true;

        try {
            const { rows, error } = await findTmcByItemCode(rawValue);
            if (error) {
                console.error("Ошибка чтения tmc_rep:", error);
                setResultState("error", {
                    message: "Ошибка связи с базой данных",
                    itemName: "—",
                    itemPlace: "—"
                });
                return;
            }

            if (!rows.length) {
                setResultState("error", {
                    message: "ТМЦ с таким item_code не найден",
                    itemName: "—",
                    itemPlace: "—"
                });
                return;
            }

            const row = pickBestRow(rows);
            if (!row) {
                setResultState("error", {
                    message: "ТМЦ с таким item_code не найден",
                    itemName: "—",
                    itemPlace: "—"
                });
                return;
            }

            const itemName = String(row?.item_name || "").trim() || "—";
            const itemPlace = String(row?.item_place || "").trim() || "Не заполнен";

            if (String(row?.wh_id ?? "").trim() !== String(currentWhId)) {
                setResultState("error", {
                    message: FORBIDDEN_WH_MESSAGE,
                    itemName: itemName,
                    itemPlace: itemPlace
                });
                return;
            }

            const updateError = await updateInventData(row);
            if (updateError) {
                console.error("Ошибка обновления date_invent/emp_invent:", updateError);
                setResultState("error", {
                    message: "Не удалось записать результат инвентаризации",
                    itemName: itemName,
                    itemPlace: itemPlace
                });
                return;
            }

            setResultState("success", {
                message: "Инвентаризация выполнена",
                itemName: itemName,
                itemPlace: itemPlace
            });
        } catch (error) {
            console.error("processScan failed:", error);
            setResultState("error", {
                message: "Ошибка выполнения операции",
                itemName: "—",
                itemPlace: "—"
            });
        } finally {
            isProcessing = false;
            scanInputEl.disabled = false;
            btnCloseInventModal.disabled = false;
            btnOpenInventModal.disabled = false;

            scanInputEl.value = "";
            setTimeout(() => {
                if (!inventModal.classList.contains("hidden")) {
                    scanInputEl.focus();
                }
            }, 0);
        }
    }

    scanInputEl.addEventListener("keydown", async (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            const value = String(scanInputEl.value || "");
            await processScan(value);
        }
    });

    btnOpenInventModal?.addEventListener("click", openInventModal);
    btnCloseInventModal?.addEventListener("click", closeInventModal);
    bindModalOverlayClose(inventModal, closeInventModal);

    try {
        const nameEl = document.getElementById("user-name-small");
        if (nameEl && user?.name) nameEl.textContent = user.name;
    } catch (_) {}

    document.addEventListener("DOMContentLoaded", () => {
        openInventModal();
        toast("Сканер инвентаризации готов", { type: "info" });
    });
})();
