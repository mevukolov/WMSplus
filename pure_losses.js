(function () {
    const TABLE_PURE = "pure_losses_rep";
    const TABLE_LOSSES = "losses_rep";
    const TABLE_2SHK = "2shk_rep";
    const TABLE_NM = "nm_rep";
    const TABLE_WH_DATA = "wh_data_rep";
    const URL_FILTER_CHUNK_SIZE = 80;
    const INSERT_CHUNK_SIZE = 400;
    const WMS_FILTER_CHUNK_SIZE = 60;
    const ROW_FILL_ANIMATION_TOTAL_MS = 1000;
    const EXPENSIVE_PRICE_THRESHOLD = 1000;
    const VERDICT_REQUEST_REQUIRED = "отправлен запрос";
    const AUTO_FOUND_DECISION = "Найден";
    const AUTO_FOUND_EMP_ID = "2405";
    const AUTO_FOUND_COMMENT = "У товара есть движение";
    const EVENT_TWO_SHK = "Два ШК";
    const EVENT_EMPTY_PACK = "Пустая упаковка";
    const DATA_TYPE_OPP_PURE_OPTIONS = "opp_pure_options";
    const DATA_TYPE_OPP_PURE_DEADLINES = "opp_pure_deadlines";
    const DATA_TYPE_OPP_TABLE_EMPLOYEES = "opp_table_employees";
    const EXTRA_FILTER_VALUES = ["2 ШК", "Пустая упаковка", "Оприход", "Пусто"];
    const DYNAMICS_LR_COLORS = [
        "#2563eb",
        "#f59e0b",
        "#10b981",
        "#ef4444",
        "#8b5cf6",
        "#06b6d4",
        "#f97316",
        "#84cc16",
        "#ec4899",
        "#64748b"
    ];
    const unsupportedInsertColumns = new Set();
    const rowFillRafMap = new WeakMap();
    const pureDynamicsCharts = {
        overall: null,
        month: null,
        previousMonth: null
    };

    const COLUMN_VARIANTS = {
        shk: ["ШК", "shk", "Шк", "Штрихкод"],
        nm: ["ID номенклатуры", "ID Номенклатуры", "ID НМ", "nm"],
        decription: ["Наименования товара", "Наименование товара", "Товар"],
        brand: ["Наименования бренда", "Наименование бренда", "Бренд"],
        shk_state_before_lost: ["Статус перед списанием", "Статус ШК перед списанием"],
        wh_id: ["ID офиса", "ID офиса статуса перед списанием", "ID офиса статуса перед списания", "wh_id"],
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
    const lastUploadDateEl = document.getElementById("last-upload-date");
    const uploadCalendarGridEl = document.getElementById("upload-calendar-grid");
    const statTotalShkEl = document.getElementById("stat-total-shk");
    const statResolvedShkEl = document.getElementById("stat-resolved-shk");
    const statExpensiveTotalEl = document.getElementById("stat-expensive-total");
    const statExpensiveResolvedEl = document.getElementById("stat-expensive-resolved");
    const statPureBacklogEl = document.getElementById("stat-pure-backlog");
    const statBalanceEl = document.getElementById("stat-balance");
    const statMonthTitleEl = document.getElementById("stat-month-title");
    const statMonthTotalShkEl = document.getElementById("stat-month-total-shk");
    const statMonthResolvedShkEl = document.getElementById("stat-month-resolved-shk");
    const statMonthExpensiveTotalEl = document.getElementById("stat-month-expensive-total");
    const statMonthExpensiveResolvedEl = document.getElementById("stat-month-expensive-resolved");
    const statMonthPureBacklogEl = document.getElementById("stat-month-pure-backlog");
    const statMonthBalanceEl = document.getElementById("stat-month-balance");
    const statMonthDynamicsTitleEl = document.getElementById("stat-month-dynamics-title");
    const statPrevMonthTitleEl = document.getElementById("stat-prev-month-title");
    const statPrevMonthTotalShkEl = document.getElementById("stat-prev-month-total-shk");
    const statPrevMonthResolvedShkEl = document.getElementById("stat-prev-month-resolved-shk");
    const statPrevMonthExpensiveTotalEl = document.getElementById("stat-prev-month-expensive-total");
    const statPrevMonthExpensiveResolvedEl = document.getElementById("stat-prev-month-expensive-resolved");
    const statPrevMonthPureBacklogEl = document.getElementById("stat-prev-month-pure-backlog");
    const statPrevMonthBalanceEl = document.getElementById("stat-prev-month-balance");
    const statPrevMonthDynamicsTitleEl = document.getElementById("stat-prev-month-dynamics-title");
    const pureDynamicsChartCanvasEl = document.getElementById("pure-dynamics-chart");
    const pureDynamicsChartEmptyEl = document.getElementById("pure-dynamics-empty");
    const pureMonthDynamicsChartCanvasEl = document.getElementById("pure-month-dynamics-chart");
    const pureMonthDynamicsChartEmptyEl = document.getElementById("pure-month-dynamics-empty");
    const purePrevMonthDynamicsChartCanvasEl = document.getElementById("pure-prev-month-dynamics-chart");
    const purePrevMonthDynamicsChartEmptyEl = document.getElementById("pure-prev-month-dynamics-empty");
    const pureLeadersPeriodEl = document.getElementById("pure-leaders-period");
    const pureLeadersBodyEl = document.getElementById("pure-leaders-body");
    const pureLeadersEmptyEl = document.getElementById("pure-leaders-empty");
    const openPureTableBtn = document.getElementById("open-pure-table-btn");
    const pureTableModalEl = document.getElementById("pure-table-modal");
    const pureTableCloseBtn = document.getElementById("pure-table-close-btn");
    const pureMonthPickerBtn = document.getElementById("pure-month-picker-btn");
    const pureMonthPickerModalEl = document.getElementById("pure-month-picker-modal");
    const pureMonthPickerCloseBtn = document.getElementById("pure-month-picker-close-btn");
    const pureMonthPickerListEl = document.getElementById("pure-month-picker-list");
    const pureMonthPickerFooterEl = document.getElementById("pure-month-picker-footer");
    const pureFilterLrBtn = document.getElementById("pure-filter-lr-btn");
    const pureFilterLrPanel = document.getElementById("pure-filter-lr-panel");
    const pureFilterLrList = document.getElementById("pure-filter-lr-list");
    const pureFilterStatusBtn = document.getElementById("pure-filter-status-btn");
    const pureFilterStatusPanel = document.getElementById("pure-filter-status-panel");
    const pureFilterStatusList = document.getElementById("pure-filter-status-list");
    const pureFilterExtraBtn = document.getElementById("pure-filter-extra-btn");
    const pureFilterExtraPanel = document.getElementById("pure-filter-extra-panel");
    const pureFilterExtraList = document.getElementById("pure-filter-extra-list");
    const pureUnresolvedOnlyCheckbox = document.getElementById("pure-unresolved-only");
    const pureTableRefreshBtn = document.getElementById("pure-table-refresh-btn");
    const pureTableInlineStatusEl = document.getElementById("pure-table-inline-status");
    const pureTableBody = document.getElementById("pure-table-body");
    const pureTableHead = document.getElementById("pure-table-head");
    const pureRequestLinkModalEl = document.getElementById("pure-request-link-modal");
    const pureRequestLinkInputEl = document.getElementById("pure-request-link-input");
    const pureRequestLinkHintEl = document.getElementById("pure-request-link-hint");
    const pureRequestLinkSaveBtn = document.getElementById("pure-request-link-save-btn");
    const pureRequestLinkCancelBtn = document.getElementById("pure-request-link-cancel-btn");
    const pureUpdateHelpModalEl = document.getElementById("pure-update-help-modal");
    const pureUpdateHelpCloseBtn = document.getElementById("pure-update-help-close-btn");
    const pureUpdateFileBtn = document.getElementById("pure-update-file-btn");
    const transferBtn = document.getElementById("transfer-btn");
    const pureTransferModalEl = document.getElementById("pure-transfer-modal");
    const pureTransferCloseBtn = document.getElementById("pure-transfer-close-btn");
    const pureTransferStatusEl = document.getElementById("pure-transfer-status");
    const transferStep1El = document.getElementById("transfer-step-1");
    const transferStep2El = document.getElementById("transfer-step-2");
    const transferStep3El = document.getElementById("transfer-step-3");
    const transferStep4El = document.getElementById("transfer-step-4");
    const transferStep5El = document.getElementById("transfer-step-5");
    const transferUploadFileBtn = document.getElementById("transfer-upload-file-btn");
    const transferFileInputEl = document.getElementById("transfer-file-input");
    const transferFileNameEl = document.getElementById("transfer-file-name");
    const transferBarcodeAutoEl = document.getElementById("transfer-barcode-auto");
    const transferBarcodeManualWrapEl = document.getElementById("transfer-barcode-manual-wrap");
    const transferBarcodeSelectEl = document.getElementById("transfer-barcode-select");
    const transferFieldEmpEl = document.getElementById("transfer-field-emp");
    const transferFieldVerdictEl = document.getElementById("transfer-field-verdict");
    const transferFieldCommentEl = document.getElementById("transfer-field-comment");
    const transferSettingsEmpEl = document.getElementById("transfer-settings-emp");
    const transferSettingsVerdictEl = document.getElementById("transfer-settings-verdict");
    const transferSettingsCommentEl = document.getElementById("transfer-settings-comment");
    const transferTargetEmpEl = document.getElementById("transfer-target-emp");
    const transferTargetVerdictEl = document.getElementById("transfer-target-verdict");
    const transferTargetCommentEl = document.getElementById("transfer-target-comment");
    const transferVerdictRemapEnabledEl = document.getElementById("transfer-verdict-remap-enabled");
    const transferVerdictRemapWrapEl = document.getElementById("transfer-verdict-remap-wrap");
    const transferVerdictRemapListEl = document.getElementById("transfer-verdict-remap-list");
    const transferStartBtn = document.getElementById("transfer-start-btn");
    const transferDownloadBtn = document.getElementById("transfer-download-btn");

    const tableState = {
        rows: [],
        filteredRows: [],
        activeLrs: new Set(),
        activeStatuses: new Set(),
        activeExtraStatuses: new Set(),
        activeMonthKey: "",
        monthSummaries: [],
        decisionOptions: [],
        decisionOptionMap: new Map(),
        onlyUnresolved: false,
        sortKey: "price",
        sortDir: -1,
        wmsLoadSeq: 0,
        activeWmsPopover: null,
        activeVerdictPanel: null,
        verdictSaveSeq: 0,
        pendingVerdictSaveByShk: new Map(),
        requestLinkSaveSeq: 0,
        pendingRequestLinkSaveByShk: new Map(),
        unsupportedUpdateColumns: new Set(),
        requestModalState: {
            shk: "",
            dateLost: "",
            decision: "",
            rowColor: ""
        },
        updateColumnMap: {
            decision: "opp_deecision",
            comment: "opp_comment",
            emp: "opp_emp",
            solved: "date_solved",
            requestLink: "opp_request_link"
        }
    };

    const transferState = {
        workbook: null,
        worksheet: null,
        sheetName: "",
        fileName: "",
        headers: [],
        targetHeaders: [],
        emptyColumnIndexes: [],
        preferredTargetIndexes: [],
        barcodeHeaderIndex: null,
        sourceRowsLoaded: false,
        sourceByShk: new Map(),
        verdictValues: [],
        verdictReplaceMap: new Map(),
        completed: false,
        matchedRows: 0,
        writtenCells: 0
    };

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

    refreshLastUploadedDate(userWhId);
    initPureTableModal();
    initUpdateHelpModal();
    initTransferModal(userWhId);
    void refreshMainDashboard(userWhId);

    refreshBtn.addEventListener("click", () => {
        openUpdateHelpModal();
    });

    fileInput.addEventListener("change", async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        closeUpdateHelpModal();
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

            const pureDeadlineConfig = await loadPureDeadlineConfig(currentUserWhId);
            const autoLrSet = await loadAutoLossReasonIds();
            const prepared = prepareIncomingRows(excelRows, currentUserWhId, autoLrSet, pureDeadlineConfig);

            if (!prepared.rowsByKey.size && !prepared.postedRowsByKey.size) {
                renderSummary({
                    insertedNew: 0
                });
                window.MiniUI?.toast?.("Подходящих строк для выгрузки не найдено", { type: "info" });
                return;
            }

            const incomingShks = collectIncomingShks(prepared);
            const existingByShk = await loadExistingRowsByShk(incomingShks);
            resolvePureTableUpdateColumns(flattenRowsFromMap(existingByShk));
            const syncPlan = buildSyncPlan(prepared.rowsByKey, prepared.postedRowsByKey, existingByShk, currentUserWhId);

            await applySyncPlan(syncPlan);

            renderSummary(syncPlan.stats);
            await refreshLastUploadedDate(currentUserWhId);
            await refreshMainDashboard(currentUserWhId);
            if (!pureTableModalEl?.classList.contains("hidden")) {
                await loadPureTableRows(currentUserWhId, { silent: true });
            }

            const updated = syncPlan.stats.insertedNew + syncPlan.stats.autoMarkedFound;
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

    function initUpdateHelpModal() {
        if (!pureUpdateHelpModalEl) return;

        pureUpdateHelpModalEl.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.matches("[data-close-update-help-modal='1']")) {
                closeUpdateHelpModal();
            }
        });

        pureUpdateHelpCloseBtn?.addEventListener("click", () => {
            closeUpdateHelpModal();
        });

        pureUpdateFileBtn?.addEventListener("click", () => {
            fileInput.value = "";
            fileInput.click();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if (!isUpdateHelpModalOpen()) return;
            closeUpdateHelpModal();
        });
    }

    function isUpdateHelpModalOpen() {
        return Boolean(pureUpdateHelpModalEl && !pureUpdateHelpModalEl.classList.contains("hidden"));
    }

    function openUpdateHelpModal() {
        if (!pureUpdateHelpModalEl) {
            fileInput.value = "";
            fileInput.click();
            return;
        }
        pureUpdateHelpModalEl.classList.remove("hidden");
        pureUpdateHelpModalEl.setAttribute("aria-hidden", "false");
    }

    function closeUpdateHelpModal() {
        if (!pureUpdateHelpModalEl) return;
        pureUpdateHelpModalEl.classList.add("hidden");
        pureUpdateHelpModalEl.setAttribute("aria-hidden", "true");
    }

    function initTransferModal(currentUserWhId) {
        if (!transferBtn || !pureTransferModalEl) return;

        transferBtn.addEventListener("click", () => {
            openTransferModal();
        });

        pureTransferModalEl.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.matches("[data-close-transfer-modal='1']")) {
                closeTransferModal();
            }
        });

        pureTransferCloseBtn?.addEventListener("click", () => {
            closeTransferModal();
        });

        transferUploadFileBtn?.addEventListener("click", () => {
            transferFileInputEl.value = "";
            transferFileInputEl.click();
        });

        transferFileInputEl?.addEventListener("change", async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            await loadTransferWorkbookFile(file);
            transferFileInputEl.value = "";
        });

        transferBarcodeSelectEl?.addEventListener("change", () => {
            const value = Number(transferBarcodeSelectEl.value);
            transferState.barcodeHeaderIndex = Number.isFinite(value) ? value : null;
            applyTransferDefaultFieldSelectionAndTargets({ keepCurrentValues: true, forceSelectFields: false });
            refreshTransferStepVisibility();
            refreshTransferStartButtonState();
        });

        transferFieldEmpEl?.addEventListener("change", () => {
            syncTransferFieldSettingsVisibility();
            refreshTransferStartButtonState();
        });

        transferFieldVerdictEl?.addEventListener("change", async () => {
            syncTransferFieldSettingsVisibility();
            if (transferFieldVerdictEl.checked && transferVerdictRemapEnabledEl?.checked) {
                await ensureTransferSourceRowsLoaded(currentUserWhId);
                renderTransferVerdictRemapList();
            }
            refreshTransferStartButtonState();
        });

        transferFieldCommentEl?.addEventListener("change", () => {
            syncTransferFieldSettingsVisibility();
            refreshTransferStartButtonState();
        });

        transferTargetEmpEl?.addEventListener("change", refreshTransferStartButtonState);
        transferTargetVerdictEl?.addEventListener("change", refreshTransferStartButtonState);
        transferTargetCommentEl?.addEventListener("change", refreshTransferStartButtonState);

        transferVerdictRemapEnabledEl?.addEventListener("change", async () => {
            if (transferVerdictRemapEnabledEl.checked) {
                transferVerdictRemapWrapEl?.classList.remove("hidden");
                await ensureTransferSourceRowsLoaded(currentUserWhId);
                renderTransferVerdictRemapList();
            } else {
                transferVerdictRemapWrapEl?.classList.add("hidden");
            }
            syncTransferFieldSettingsVisibility();
            refreshTransferStartButtonState();
        });

        transferStartBtn?.addEventListener("click", async () => {
            await runTransferToExcel(currentUserWhId);
        });

        transferDownloadBtn?.addEventListener("click", () => {
            downloadTransferredWorkbook();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if (!isTransferModalOpen()) return;
            closeTransferModal();
        });
    }

    function isTransferModalOpen() {
        return Boolean(pureTransferModalEl && !pureTransferModalEl.classList.contains("hidden"));
    }

    function openTransferModal() {
        if (!pureTransferModalEl) return;
        resetTransferState();
        pureTransferModalEl.classList.remove("hidden");
        pureTransferModalEl.setAttribute("aria-hidden", "false");
    }

    function closeTransferModal() {
        if (!pureTransferModalEl) return;
        pureTransferModalEl.classList.add("hidden");
        pureTransferModalEl.setAttribute("aria-hidden", "true");
    }

    function resetTransferState() {
        transferState.workbook = null;
        transferState.worksheet = null;
        transferState.sheetName = "";
        transferState.fileName = "";
        transferState.headers = [];
        transferState.targetHeaders = [];
        transferState.emptyColumnIndexes = [];
        transferState.preferredTargetIndexes = [];
        transferState.barcodeHeaderIndex = null;
        transferState.sourceRowsLoaded = false;
        transferState.sourceByShk = new Map();
        transferState.verdictValues = [];
        transferState.verdictReplaceMap = new Map();
        transferState.completed = false;
        transferState.matchedRows = 0;
        transferState.writtenCells = 0;

        if (transferFileNameEl) transferFileNameEl.textContent = "";
        if (transferBarcodeAutoEl) transferBarcodeAutoEl.textContent = "";
        transferBarcodeManualWrapEl?.classList.add("hidden");
        if (transferBarcodeSelectEl) transferBarcodeSelectEl.innerHTML = "";

        if (transferFieldEmpEl) transferFieldEmpEl.checked = true;
        if (transferFieldVerdictEl) transferFieldVerdictEl.checked = true;
        if (transferFieldCommentEl) transferFieldCommentEl.checked = true;
        if (transferVerdictRemapEnabledEl) transferVerdictRemapEnabledEl.checked = false;

        transferSettingsEmpEl?.classList.remove("hidden");
        transferSettingsVerdictEl?.classList.remove("hidden");
        transferSettingsCommentEl?.classList.remove("hidden");
        transferVerdictRemapWrapEl?.classList.add("hidden");
        if (transferVerdictRemapListEl) transferVerdictRemapListEl.innerHTML = "";

        fillTransferTargetSelectOptions([]);
        syncTransferFieldSettingsVisibility();
        setTransferStatus("", "info");
        refreshTransferStepVisibility();
        refreshTransferStartButtonState();
    }

    function syncTransferFieldSettingsVisibility() {
        transferSettingsEmpEl?.classList.toggle("hidden", !transferFieldEmpEl?.checked);
        transferSettingsVerdictEl?.classList.toggle("hidden", !transferFieldVerdictEl?.checked);
        transferSettingsCommentEl?.classList.toggle("hidden", !transferFieldCommentEl?.checked);
        if (!transferFieldVerdictEl?.checked || !transferVerdictRemapEnabledEl?.checked) {
            transferVerdictRemapWrapEl?.classList.add("hidden");
        }
    }

    function setTransferStatus(message, type) {
        if (!pureTransferStatusEl) return;
        const text = toText(message);
        const statusType = String(type || "").toLowerCase();
        pureTransferStatusEl.innerHTML = "";

        if (statusType === "loading") {
            if (text) {
                const textEl = document.createElement("span");
                textEl.className = "pure-inline-status-text";
                textEl.textContent = text;
                pureTransferStatusEl.appendChild(textEl);
            }
            const loader = document.createElement("span");
            loader.className = "pure-inline-loader";
            const bar = document.createElement("span");
            bar.className = "pure-inline-loader-bar";
            loader.appendChild(bar);
            pureTransferStatusEl.appendChild(loader);
            pureTransferStatusEl.style.color = "#64748b";
            return;
        }

        if (text) {
            const textEl = document.createElement("span");
            textEl.className = "pure-inline-status-text";
            textEl.textContent = text;
            pureTransferStatusEl.appendChild(textEl);
        }

        pureTransferStatusEl.style.color = statusType === "error"
            ? "#dc2626"
            : statusType === "success"
                ? "#15803d"
                : "#64748b";
    }

    function refreshTransferStepVisibility() {
        const hasFile = Boolean(transferState.workbook && transferState.headers.length);
        const hasBarcode = Number.isInteger(transferState.barcodeHeaderIndex);

        transferStep2El?.classList.toggle("hidden", !hasFile);
        transferStep3El?.classList.toggle("hidden", !(hasFile && hasBarcode));
        transferStep4El?.classList.toggle("hidden", !(hasFile && hasBarcode));
        transferStep5El?.classList.toggle("hidden", !transferState.completed);
        refreshTransferStepCompletion();
    }

    function refreshTransferStartButtonState() {
        if (!transferStartBtn) return;

        const hasFile = Boolean(transferState.workbook && transferState.headers.length);
        const hasBarcode = Number.isInteger(transferState.barcodeHeaderIndex);
        const selectedFields = getSelectedTransferFields();
        const hasFields = selectedFields.length > 0;

        const hasTargets = selectedFields.every((field) => {
            const selectEl = getTransferTargetSelect(field);
            const idx = toIntegerOrNull(selectEl?.value);
            return idx !== null && idx >= 0;
        });

        transferStartBtn.disabled = !(hasFile && hasBarcode && hasFields && hasTargets);
        refreshTransferStepCompletion();
    }

    function refreshTransferStepCompletion() {
        const hasFile = Boolean(transferState.workbook && transferState.headers.length);
        const hasBarcode = Number.isInteger(transferState.barcodeHeaderIndex);
        const selectedFields = getSelectedTransferFields();
        const hasFields = selectedFields.length > 0;
        const hasTargets = hasFields && selectedFields.every((field) => {
            const selectEl = getTransferTargetSelect(field);
            const idx = toIntegerOrNull(selectEl?.value);
            return idx !== null && idx >= 0;
        });

        setTransferStepDone(transferStep1El, 1, hasFile);
        setTransferStepDone(transferStep2El, 2, hasFile && hasBarcode);
        setTransferStepDone(transferStep3El, 3, hasFile && hasBarcode && hasFields && hasTargets);
        setTransferStepDone(transferStep4El, 4, transferState.completed);
        setTransferStepDone(transferStep5El, 5, transferState.completed);
    }

    function setTransferStepDone(stepEl, number, isDone) {
        if (!(stepEl instanceof HTMLElement)) return;
        stepEl.classList.toggle("is-done", Boolean(isDone));
        const indexEl = stepEl.querySelector(".pure-transfer-step-index");
        if (indexEl instanceof HTMLElement) {
            indexEl.textContent = isDone ? "✓" : String(number);
        }
    }

    function getSelectedTransferFields() {
        const out = [];
        if (transferFieldEmpEl?.checked) out.push("emp");
        if (transferFieldVerdictEl?.checked) out.push("verdict");
        if (transferFieldCommentEl?.checked) out.push("comment");
        return out;
    }

    function getTransferTargetSelect(field) {
        if (field === "emp") return transferTargetEmpEl;
        if (field === "verdict") return transferTargetVerdictEl;
        if (field === "comment") return transferTargetCommentEl;
        return null;
    }

    async function loadTransferWorkbookFile(file) {
        if (typeof window.XLSX === "undefined") {
            setTransferStatus("Не загрузилась библиотека XLSX.", "error");
            return;
        }

        try {
            setTransferStatus("Читаем файл...", "loading");
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: "array" });
            const firstSheetName = workbook.SheetNames && workbook.SheetNames[0];
            if (!firstSheetName) {
                throw new Error("В файле не найдено листов.");
            }

            const worksheet = workbook.Sheets[firstSheetName];
            const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
            const headerRow = Array.isArray(aoa[0]) ? aoa[0] : [];
            const headers = normalizeTransferHeaders(headerRow);
            if (!headers.length) {
                throw new Error("Не удалось прочитать заголовки таблицы.");
            }
            const targetHeaders = headers.concat(buildTransferVirtualHeaders(worksheet, 12));

            transferState.workbook = workbook;
            transferState.worksheet = worksheet;
            transferState.sheetName = firstSheetName;
            transferState.fileName = file.name || "";
            transferState.headers = headers;
            transferState.targetHeaders = targetHeaders;
            transferState.barcodeHeaderIndex = detectTransferBarcodeHeaderIndex(headers);
            transferState.emptyColumnIndexes = detectTransferEmptyColumnIndexes(worksheet, targetHeaders);
            transferState.preferredTargetIndexes = detectPreferredTransferTargetIndexes(
                targetHeaders,
                transferState.emptyColumnIndexes,
                transferState.barcodeHeaderIndex
            );
            transferState.completed = false;

            if (transferFileNameEl) {
                const displayName = transferState.fileName || firstSheetName;
                transferFileNameEl.textContent = `Файл: ${displayName}`;
            }

            fillTransferTargetSelectOptions(targetHeaders);
            fillTransferBarcodeSelectOptions(headers);

            if (Number.isInteger(transferState.barcodeHeaderIndex)) {
                const index = transferState.barcodeHeaderIndex;
                const headerName = headers[index]?.label || `Колонка ${index + 1}`;
                transferBarcodeAutoEl.textContent = `Найден столбец: «${headerName}».`;
                transferBarcodeManualWrapEl?.classList.add("hidden");
                if (transferBarcodeSelectEl) transferBarcodeSelectEl.value = String(index);
            } else {
                transferBarcodeAutoEl.textContent = "Не удалось определить столбец ШК автоматически. Выберите его вручную.";
                transferBarcodeManualWrapEl?.classList.remove("hidden");
            }

            applyTransferDefaultFieldSelectionAndTargets();

            const preferredCount = transferState.preferredTargetIndexes.length;
            if (preferredCount >= 3) {
                setTransferStatus("Файл загружен. Пустые столбцы определены автоматически.", "success");
            } else {
                setTransferStatus(
                    `Файл загружен. Найдено свободных отдельных столбцов: ${formatInt(preferredCount)}. Выберите недостающие вручную.`,
                    "info"
                );
            }
            refreshTransferStepVisibility();
            refreshTransferStartButtonState();
        } catch (error) {
            setTransferStatus(String(error?.message || error || "Не удалось загрузить файл"), "error");
        }
    }

    function normalizeTransferHeaders(headerRow) {
        const out = [];
        (Array.isArray(headerRow) ? headerRow : []).forEach((value, index) => {
            const labelRaw = toText(value);
            const hasHeader = Boolean(labelRaw);
            const label = hasHeader ? labelRaw : `Колонка ${index + 1} (без заголовка)`;
            out.push({
                index,
                label,
                norm: hasHeader ? normalizeTransferHeaderKey(labelRaw) : "",
                hasHeader,
                isVirtual: false
            });
        });
        return out;
    }

    function buildTransferVirtualHeaders(worksheet, count = 12) {
        const safeCount = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 12;
        const range = XLSX.utils.decode_range(worksheet?.["!ref"] || "A1:A1");
        const startIndex = Number.isFinite(range?.e?.c) ? range.e.c + 1 : 1;
        const out = [];

        for (let i = 0; i < safeCount; i += 1) {
            const index = startIndex + i;
            out.push({
                index,
                label: `Новая колонка ${index + 1} (без заголовка)`,
                norm: "",
                hasHeader: false,
                isVirtual: true
            });
        }

        return out;
    }

    function normalizeTransferHeaderKey(value) {
        return toText(value)
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^a-zа-я0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function detectTransferBarcodeHeaderIndex(headers) {
        const candidates = Array.isArray(headers) ? headers : [];
        let best = { index: null, score: -1 };

        candidates.forEach((item) => {
            const norm = toText(item?.norm);
            if (!norm) return;

            let score = -1;
            if (norm === "шк" || norm === "штрихкод") score = 120;
            else if (norm === "идентификатор товара" || norm === "ид товара" || norm === "товар") score = 100;
            else if (norm.includes("шк") || norm.includes("штрихкод")) score = 90;
            else if (norm.includes("идентификатор") && norm.includes("товар")) score = 80;
            else if (norm.includes("ид") && norm.includes("товар")) score = 70;

            if (score > best.score) {
                best = { index: item.index, score };
            }
        });

        return Number.isInteger(best.index) ? best.index : null;
    }

    function fillTransferBarcodeSelectOptions(headers) {
        if (!transferBarcodeSelectEl) return;
        transferBarcodeSelectEl.innerHTML = "";

        (Array.isArray(headers) ? headers : []).forEach((item) => {
            const option = document.createElement("option");
            option.value = String(item.index);
            option.textContent = item.label;
            transferBarcodeSelectEl.appendChild(option);
        });
    }

    function fillTransferTargetSelectOptions(headers) {
        [transferTargetEmpEl, transferTargetVerdictEl, transferTargetCommentEl].forEach((selectEl) => {
            if (!selectEl) return;
            const prev = selectEl.value;
            selectEl.innerHTML = "";

            const empty = document.createElement("option");
            empty.value = "";
            empty.textContent = "Выберите столбец";
            selectEl.appendChild(empty);

            (Array.isArray(headers) ? headers : []).forEach((item) => {
                const option = document.createElement("option");
                option.value = String(item.index);
                option.textContent = item.label;
                selectEl.appendChild(option);
            });

            const hasPrev = Array.from(selectEl.options).some((opt) => opt.value === prev);
            if (prev && hasPrev) {
                selectEl.value = prev;
            } else {
                selectEl.value = "";
            }
        });
    }

    function detectTransferEmptyColumnIndexes(worksheet, headers) {
        if (!worksheet || !Array.isArray(headers) || !headers.length) return [];

        const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
        const out = [];

        headers.forEach((item) => {
            const columnIndex = toIntegerOrNull(item?.index);
            if (columnIndex === null || columnIndex < 0) return;

            let hasData = false;
            for (let r = 1; r <= range.e.r; r += 1) {
                const cellRef = XLSX.utils.encode_cell({ r, c: columnIndex });
                const cell = worksheet[cellRef];
                const raw = cell ? (cell.v ?? cell.w ?? "") : "";
                if (toText(raw) !== "") {
                    hasData = true;
                    break;
                }
            }

            if (!hasData) {
                out.push(columnIndex);
            }
        });

        return out;
    }

    function detectPreferredTransferTargetIndexes(headers, emptyIndexes, barcodeIdx) {
        const headerByIndex = new Map();
        (Array.isArray(headers) ? headers : []).forEach((item) => {
            const idx = toIntegerOrNull(item?.index);
            if (idx === null || idx < 0) return;
            headerByIndex.set(idx, item);
        });

        const preferred = [];
        (Array.isArray(emptyIndexes) ? emptyIndexes : []).forEach((idxRaw) => {
            const idx = toIntegerOrNull(idxRaw);
            if (idx === null || idx < 0 || idx === barcodeIdx) return;
            const info = headerByIndex.get(idx);
            if (!info) return;
            if (info.isVirtual || !info.hasHeader) {
                preferred.push(idx);
            }
        });

        return preferred;
    }

    function applyTransferDefaultFieldSelectionAndTargets(options = {}) {
        const { keepCurrentValues = false, forceSelectFields = true } = options;
        if (!transferState.targetHeaders.length) return;

        if (forceSelectFields) {
            if (transferFieldEmpEl) transferFieldEmpEl.checked = true;
            if (transferFieldVerdictEl) transferFieldVerdictEl.checked = true;
            if (transferFieldCommentEl) transferFieldCommentEl.checked = true;
        }
        syncTransferFieldSettingsVisibility();

        const barcodeIdx = transferState.barcodeHeaderIndex;
        const emptyCandidates = (Array.isArray(transferState.preferredTargetIndexes) ? transferState.preferredTargetIndexes : [])
            .filter((idx) => idx !== barcodeIdx);

        const assigned = new Set();
        const fieldOrder = ["emp", "verdict", "comment"];

        fieldOrder.forEach((field) => {
            const selectEl = getTransferTargetSelect(field);
            if (!selectEl) return;

            let targetIdx = null;
            const currentIdx = toIntegerOrNull(selectEl.value);
            if (keepCurrentValues && currentIdx !== null && currentIdx >= 0 && currentIdx !== barcodeIdx && !assigned.has(currentIdx)) {
                targetIdx = currentIdx;
            }

            if (targetIdx === null) {
                const nextEmpty = emptyCandidates.find((idx) => !assigned.has(idx));
                if (nextEmpty !== undefined) {
                    targetIdx = nextEmpty;
                }
            }

            if (targetIdx !== null && targetIdx >= 0) {
                selectEl.value = String(targetIdx);
                assigned.add(targetIdx);
            } else {
                selectEl.value = "";
            }
        });
    }

    function guessTransferTargetColumnIndex(headers, selectId) {
        const candidates = Array.isArray(headers) ? headers : [];
        const matchers = selectId === "transfer-target-emp"
            ? ["сотрудник опп", "сотрудник", "opp_emp", "опп"]
            : selectId === "transfer-target-verdict"
                ? ["вердикт", "решение", "opp_deecision", "opp_decision"]
                : ["комментарий", "opp_comment", "comment"];

        for (const item of candidates) {
            const norm = toText(item?.norm);
            if (!norm) continue;
            if (matchers.some((part) => norm.includes(part))) {
                return item.index;
            }
        }
        return null;
    }

    async function ensureTransferSourceRowsLoaded(currentUserWhId) {
        if (transferState.sourceRowsLoaded) return;
        setTransferStatus("Загружаем данные чистых списаний...", "loading");

        const [rows, decisionOptions] = await Promise.all([
            fetchAllPureRowsForWh(currentUserWhId),
            loadDecisionOptionsForPureTable(currentUserWhId).catch((error) => {
                console.error("pure_losses transfer decision options load failed:", error);
                return [];
            })
        ]);
        resolvePureTableUpdateColumns(rows);

        const sourceMap = new Map();
        const verdictSet = new Set();

        (Array.isArray(decisionOptions) ? decisionOptions : []).forEach((option) => {
            const verdict = extractDecisionValue(option?.value ?? option);
            if (isTransferVerdictValueUsable(verdict)) verdictSet.add(verdict);
        });

        rows.forEach((row) => {
            const shk = normalizeShk(row?.shk);
            if (shk && !sourceMap.has(shk)) {
                sourceMap.set(shk, row);
            }
            const verdict = extractDecisionValue(readEditableColumnValue(row, tableState.updateColumnMap.decision));
            if (isTransferVerdictValueUsable(verdict)) verdictSet.add(verdict);
        });

        transferState.sourceByShk = sourceMap;
        transferState.verdictValues = Array.from(verdictSet).sort((a, b) => String(a).localeCompare(String(b), "ru"));
        transferState.sourceRowsLoaded = true;
        setTransferStatus("Данные для переноса готовы.", "success");
    }

    function isTransferVerdictValueUsable(value) {
        const normalized = extractDecisionValue(value);
        if (!normalized) return false;
        return normalized.toLowerCase() !== "[object object]";
    }

    function renderTransferVerdictRemapList() {
        if (!transferVerdictRemapListEl) return;
        transferVerdictRemapListEl.innerHTML = "";

        if (!transferState.verdictValues.length) {
            const empty = document.createElement("div");
            empty.className = "pure-transfer-muted";
            empty.textContent = "В базе пока нет вердиктов для подмены.";
            transferVerdictRemapListEl.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        transferState.verdictValues.forEach((value) => {
            const key = decisionOptionKey(value);
            const row = document.createElement("div");
            row.className = "pure-transfer-remap-row";

            const from = document.createElement("div");
            from.className = "pure-transfer-remap-from";
            from.textContent = value;

            const arrow = document.createElement("div");
            arrow.className = "pure-transfer-arrow";
            arrow.textContent = "→";

            const input = document.createElement("input");
            input.type = "text";
            input.className = "input";
            input.placeholder = "Новое значение";
            input.value = transferState.verdictReplaceMap.get(key) || "";
            input.addEventListener("input", () => {
                const next = toText(input.value);
                if (next) transferState.verdictReplaceMap.set(key, next);
                else transferState.verdictReplaceMap.delete(key);
            });

            row.append(from, arrow, input);
            fragment.appendChild(row);
        });

        transferVerdictRemapListEl.appendChild(fragment);
    }

    async function runTransferToExcel(currentUserWhId) {
        if (!transferState.workbook || !transferState.worksheet) {
            setTransferStatus("Сначала загрузите файл таблицы.", "error");
            return;
        }

        const barcodeIdx = toIntegerOrNull(transferBarcodeSelectEl?.value);
        if (barcodeIdx === null || barcodeIdx < 0) {
            setTransferStatus("Выберите столбец ШК.", "error");
            return;
        }

        const selectedFields = getSelectedTransferFields();
        if (!selectedFields.length) {
            setTransferStatus("Выберите хотя бы одно поле для переноса.", "error");
            return;
        }

        const targets = {};
        for (const field of selectedFields) {
            const selectEl = getTransferTargetSelect(field);
            const targetIdx = toIntegerOrNull(selectEl?.value);
            if (targetIdx === null || targetIdx < 0) {
                setTransferStatus("Заполните настройки столбцов для выбранных полей.", "error");
                return;
            }
            targets[field] = targetIdx;
        }

        try {
            transferStartBtn.disabled = true;
            setTransferStatus("Переносим данные...", "loading");
            await ensureTransferSourceRowsLoaded(currentUserWhId);

            const ws = transferState.worksheet;
            const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
            let matchedRows = 0;
            let writtenCells = 0;

            for (let r = 1; r <= range.e.r; r += 1) {
                const sourceRef = XLSX.utils.encode_cell({ r, c: barcodeIdx });
                const sourceCell = ws[sourceRef];
                const sourceValue = sourceCell ? (sourceCell.v ?? sourceCell.w ?? "") : "";
                const shk = normalizeShk(sourceValue);
                if (!shk) continue;

                const pureRow = transferState.sourceByShk.get(shk);
                if (!pureRow) continue;
                matchedRows += 1;

                if (targets.emp !== undefined) {
                    const empValue = toText(readEditableColumnValue(pureRow, tableState.updateColumnMap.emp));
                    setWorksheetCellValue(ws, r, targets.emp, empValue);
                    writtenCells += 1;
                }

                if (targets.verdict !== undefined) {
                    const rawVerdict = extractDecisionValue(readEditableColumnValue(pureRow, tableState.updateColumnMap.decision));
                    const verdictKey = decisionOptionKey(rawVerdict);
                    const replaceEnabled = Boolean(transferVerdictRemapEnabledEl?.checked);
                    const replaced = replaceEnabled
                        ? toText(transferState.verdictReplaceMap.get(verdictKey))
                        : "";
                    const finalVerdict = replaced || rawVerdict;
                    setWorksheetCellValue(ws, r, targets.verdict, finalVerdict);
                    writtenCells += 1;
                }

                if (targets.comment !== undefined) {
                    const commentValue = toText(readEditableColumnValue(pureRow, tableState.updateColumnMap.comment));
                    setWorksheetCellValue(ws, r, targets.comment, commentValue);
                    writtenCells += 1;
                }
            }

            transferState.completed = true;
            transferState.matchedRows = matchedRows;
            transferState.writtenCells = writtenCells;
            refreshTransferStepVisibility();
            refreshTransferStartButtonState();
            setTransferStatus(`Готово. Совпало ШК: ${formatInt(matchedRows)}. Записано ячеек: ${formatInt(writtenCells)}.`, "success");
        } catch (error) {
            setTransferStatus(String(error?.message || error || "Ошибка переноса"), "error");
        } finally {
            if (transferStartBtn) transferStartBtn.disabled = false;
            refreshTransferStartButtonState();
        }
    }

    function setWorksheetCellValue(worksheet, rowIndex, columnIndex, value) {
        if (!worksheet) return;
        const ref = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        const text = value === null || value === undefined ? "" : String(value);
        worksheet[ref] = { t: "s", v: text };

        const existingRange = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
        if (rowIndex > existingRange.e.r) existingRange.e.r = rowIndex;
        if (columnIndex > existingRange.e.c) existingRange.e.c = columnIndex;
        worksheet["!ref"] = XLSX.utils.encode_range(existingRange);
    }

    function downloadTransferredWorkbook() {
        if (!transferState.workbook) {
            setTransferStatus("Нет файла для скачивания.", "error");
            return;
        }
        const base = toText(transferState.fileName).replace(/\.(xlsx|xls)$/i, "") || "transfer";
        const fileName = `${base}_updated.xlsx`;
        XLSX.writeFile(transferState.workbook, fileName);
    }

    function initPureTableModal() {
        if (!openPureTableBtn || !pureTableModalEl || !pureTableBody) return;
        updateMonthPickerButtonCaption();

        openPureTableBtn.addEventListener("click", async () => {
            pureTableModalEl.classList.remove("hidden");
            closePureTableFilterPanels();
            await loadPureTableRows(userWhId);
        });

        pureTableCloseBtn?.addEventListener("click", closePureTableModal);
        pureTableRefreshBtn?.addEventListener("click", async () => {
            await loadPureTableRows(userWhId);
        });

        pureMonthPickerBtn?.addEventListener("click", () => {
            openMonthPickerModal();
        });

        pureMonthPickerModalEl?.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.matches("[data-close-month-picker-modal='1']")) {
                closeMonthPickerModal();
            }
        });

        pureMonthPickerCloseBtn?.addEventListener("click", () => {
            closeMonthPickerModal();
        });

        pureMonthPickerListEl?.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const card = target.closest("[data-month-key]");
            if (!(card instanceof HTMLElement)) return;
            const monthKey = toText(card.dataset.monthKey);
            setActivePureMonthFilter(monthKey);
            closeMonthPickerModal();
        });

        pureUnresolvedOnlyCheckbox?.addEventListener("change", () => {
            tableState.onlyUnresolved = Boolean(pureUnresolvedOnlyCheckbox.checked);
            applyPureTableFiltersAndRender();
        });

        pureFilterLrBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePureFilterPanel(pureFilterLrPanel);
        });

        pureFilterStatusBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePureFilterPanel(pureFilterStatusPanel);
        });

        pureFilterExtraBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePureFilterPanel(pureFilterExtraPanel);
        });

        pureTableModalEl.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.matches("[data-close-pure-table='1']")) {
                closePureTableModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if (pureTableModalEl.classList.contains("hidden")) return;
            if (isMonthPickerModalOpen()) {
                closeMonthPickerModal();
                return;
            }
            if (isRequestLinkModalOpen()) {
                closeRequestLinkModal();
                return;
            }
            closeAllWmsPopovers();
            closePureTableModal();
        });

        document.addEventListener("click", (event) => {
            if (pureTableModalEl.classList.contains("hidden")) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest(".pure-row-verdict-dropdown")) {
                closePureTableFilterPanels();
                closeAllWmsPopovers();
                return;
            }
            if (target.closest(".status-dropdown")) {
                closeActiveVerdictPanel();
                closeAllWmsPopovers();
                return;
            }
            if (target.closest(".pure-wms-popover-wrap")) {
                closeActiveVerdictPanel();
                return;
            }
            closePureTableFilterPanels();
            closeActiveVerdictPanel();
            closeAllWmsPopovers();
        });

        pureTableBody.addEventListener("blur", (event) => {
            void handlePureTableInputBlur(event);
        }, true);

        pureTableBody.addEventListener("keydown", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) return;
            if (event.key === "Enter") {
                event.preventDefault();
                target.blur();
            }
        });

        pureTableBody.addEventListener("click", (event) => {
            void handlePureTableBodyClick(event);
        });

        pureTableHead?.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const th = target.closest("th[data-sort-key]");
            if (!th) return;

            const key = String(th.getAttribute("data-sort-key") || "").trim();
            if (!key) return;

            if (tableState.sortKey === key) {
                tableState.sortDir = tableState.sortDir * -1;
            } else {
                tableState.sortKey = key;
                tableState.sortDir = key === "dateLost" || key === "price" ? -1 : 1;
            }
            applyPureTableFiltersAndRender();
        });

        pureRequestLinkModalEl?.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.matches("[data-close-request-link-modal='1']")) {
                closeRequestLinkModal();
            }
        });

        pureRequestLinkCancelBtn?.addEventListener("click", () => {
            closeRequestLinkModal();
        });

        pureRequestLinkSaveBtn?.addEventListener("click", () => {
            void submitRequestLinkModal();
        });

        pureRequestLinkInputEl?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                void submitRequestLinkModal();
            } else if (event.key === "Escape") {
                event.preventDefault();
                closeRequestLinkModal();
            }
        });
    }

    function closePureTableModal() {
        pureTableModalEl?.classList.add("hidden");
        closeRequestLinkModal();
        closeMonthPickerModal();
        closePureTableFilterPanels();
        closeActiveVerdictPanel();
        closeAllWmsPopovers();
    }

    function togglePureFilterPanel(panel) {
        if (!panel) return;
        const isHidden = panel.classList.contains("hidden");
        closePureTableFilterPanels();
        if (isHidden) panel.classList.remove("hidden");
    }

    function closePureTableFilterPanels() {
        pureFilterLrPanel?.classList.add("hidden");
        pureFilterStatusPanel?.classList.add("hidden");
        pureFilterExtraPanel?.classList.add("hidden");
    }

    function isMonthPickerModalOpen() {
        return Boolean(pureMonthPickerModalEl && !pureMonthPickerModalEl.classList.contains("hidden"));
    }

    function openMonthPickerModal() {
        if (!pureMonthPickerModalEl) return;
        closePureTableFilterPanels();
        closeActiveVerdictPanel();
        closeAllWmsPopovers();
        renderMonthPickerModalContent();
        pureMonthPickerModalEl.classList.remove("hidden");
        pureMonthPickerModalEl.setAttribute("aria-hidden", "false");
    }

    function closeMonthPickerModal() {
        if (!pureMonthPickerModalEl) return;
        pureMonthPickerModalEl.classList.add("hidden");
        pureMonthPickerModalEl.setAttribute("aria-hidden", "true");
    }

    function buildMonthSummaries(rows) {
        const sourceRows = Array.isArray(rows) ? rows : [];
        const monthMap = new Map();
        const allSummary = createMonthSummaryBucket("", "Все месяцы");

        sourceRows.forEach((row) => {
            const monthKey = toText(row?.monthKey);
            if (!monthKey) return;

            if (!monthMap.has(monthKey)) {
                monthMap.set(monthKey, createMonthSummaryBucket(monthKey, formatMonthPickerLabel(monthKey)));
            }
            updateMonthSummaryBucket(monthMap.get(monthKey), row);
            updateMonthSummaryBucket(allSummary, row);
        });

        const monthItems = Array.from(monthMap.values())
            .map(finalizeMonthSummaryBucket)
            .sort((left, right) => String(right.key).localeCompare(String(left.key), "ru"));

        return [finalizeMonthSummaryBucket(allSummary), ...monthItems];
    }

    function createMonthSummaryBucket(key, label) {
        return {
            key: toText(key),
            label: toText(label),
            totalSum: 0,
            resolvedSum: 0,
            expensiveTotal: 0,
            expensiveResolved: 0,
            sumWithoutFound: 0,
            rowCount: 0
        };
    }

    function updateMonthSummaryBucket(bucket, row) {
        if (!bucket || typeof bucket !== "object") return;
        const price = Math.abs(toNumberOrNull(row?.price) || 0);
        const decision = extractDecisionValue(row?.decision);
        const isResolved = Boolean(decision);
        const isFound = decisionOptionKey(decision) === decisionOptionKey(AUTO_FOUND_DECISION);
        const isExpensive = price >= EXPENSIVE_PRICE_THRESHOLD;

        bucket.totalSum += price;
        if (isResolved) {
            bucket.resolvedSum += price;
        }
        if (isExpensive) {
            bucket.expensiveTotal += 1;
            if (isResolved) bucket.expensiveResolved += 1;
        }
        if (!isFound) {
            bucket.sumWithoutFound += price;
        }
        bucket.rowCount += 1;
    }

    function finalizeMonthSummaryBucket(bucket) {
        const total = Number(bucket?.totalSum || 0);
        const resolved = Number(bucket?.resolvedSum || 0);
        const percentByPrice = total > 0 ? (resolved / total) * 100 : 0;
        const level = percentByPrice >= 80 ? "good" : percentByPrice >= 50 ? "warn" : "bad";
        return {
            key: toText(bucket?.key),
            label: toText(bucket?.label) || "—",
            totalSum: total,
            resolvedSum: resolved,
            percentByPrice,
            expensiveTotal: Math.max(0, Math.trunc(Number(bucket?.expensiveTotal || 0))),
            expensiveResolved: Math.max(0, Math.trunc(Number(bucket?.expensiveResolved || 0))),
            sumWithoutFound: Math.max(0, Number(bucket?.sumWithoutFound || 0)),
            rowCount: Math.max(0, Math.trunc(Number(bucket?.rowCount || 0))),
            level
        };
    }

    function formatMonthPickerLabel(monthKey) {
        const normalized = toText(monthKey);
        const match = normalized.match(/^(\d{4})-(\d{2})$/);
        if (!match) return normalized || "—";

        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const monthDate = new Date(year, monthIndex, 1);
        const monthLabelRaw = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(monthDate);
        const monthLabel = monthLabelRaw ? monthLabelRaw[0].toUpperCase() + monthLabelRaw.slice(1) : "—";
        return `${monthLabel} ${year}`;
    }

    function getMonthSummaryByKey(monthKey) {
        const key = toText(monthKey);
        const summaries = Array.isArray(tableState.monthSummaries) ? tableState.monthSummaries : [];
        const found = summaries.find((item) => toText(item?.key) === key);
        if (found) return found;
        return summaries.find((item) => toText(item?.key) === "") || summaries[0] || null;
    }

    function setActivePureMonthFilter(monthKey) {
        const normalized = toText(monthKey);
        const summaries = Array.isArray(tableState.monthSummaries) ? tableState.monthSummaries : [];
        if (normalized && !summaries.some((item) => toText(item?.key) === normalized)) return;
        tableState.activeMonthKey = normalized;
        updateMonthPickerButtonCaption();
        renderMonthPickerModalContent();
        applyPureTableFiltersAndRender();
    }

    function updateMonthPickerButtonCaption() {
        if (!pureMonthPickerBtn) return;
        const summary = getMonthSummaryByKey(tableState.activeMonthKey);
        const caption = toText(summary?.label) || "Все месяцы";
        pureMonthPickerBtn.innerHTML = `${escapeHtml(caption)} <span class="caret">▾</span>`;
    }

    function renderMonthPickerModalContent() {
        if (!pureMonthPickerListEl || !pureMonthPickerFooterEl) return;

        const summaries = Array.isArray(tableState.monthSummaries) ? tableState.monthSummaries : [];
        pureMonthPickerListEl.innerHTML = "";
        pureMonthPickerFooterEl.innerHTML = "";
        pureMonthPickerFooterEl.hidden = true;

        if (!summaries.length || summaries.every((item) => Number(item?.rowCount || 0) <= 0)) {
            const empty = document.createElement("div");
            empty.className = "muted";
            empty.textContent = "Нет данных по месяцам";
            pureMonthPickerListEl.appendChild(empty);
            return;
        }

        summaries.forEach((summary) => {
            if (!summary || Number(summary.rowCount || 0) <= 0) return;
            const card = document.createElement("button");
            card.type = "button";
            card.className = `pure-month-picker-card is-${toText(summary.level) || "bad"}`;
            if (toText(summary.key) === toText(tableState.activeMonthKey)) {
                card.classList.add("is-selected");
            }
            card.dataset.monthKey = toText(summary.key);
            card.innerHTML = `
                <div class="pure-month-picker-head">
                    <div class="pure-month-picker-title">${escapeHtml(summary.label)}</div>
                    <div class="pure-month-picker-percent">${escapeHtml(formatPercent(summary.percentByPrice))}</div>
                </div>
                <div class="pure-month-picker-meta">Дорогостой: ${formatInt(summary.expensiveResolved)} / ${formatInt(summary.expensiveTotal)}</div>
                <div class="pure-month-picker-loss">Сумма потеряного: ${escapeHtml(formatRub(summary.sumWithoutFound))}</div>
            `;
            pureMonthPickerListEl.appendChild(card);
        });
    }

    async function loadPureTableRows(currentUserWhId, options = {}) {
        const { silent = false } = options;
        if (!pureTableBody) return;
        const wmsSeq = ++tableState.wmsLoadSeq;

        if (!currentUserWhId) {
            setPureTableInlineStatus("Не удалось определить wh_id пользователя.", "error");
            return;
        }
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            setPureTableInlineStatus("Supabase не инициализирован.", "error");
            return;
        }

        setPureTableInlineStatus("", "loading");
        renderPureTablePlaceholder("Загрузка...");

        try {
            const [rawRows, loadedDecisionOptions] = await Promise.all([
                fetchAllPureRowsForWh(currentUserWhId),
                loadDecisionOptionsForPureTable(currentUserWhId).catch((error) => {
                    console.error("pure_losses decision options load failed:", error);
                    return [];
                })
            ]);
            resolvePureTableUpdateColumns(rawRows);

            tableState.rows = rawRows.map((row) => normalizePureTableRow(row));
            tableState.monthSummaries = buildMonthSummaries(tableState.rows);
            if (tableState.activeMonthKey && !tableState.monthSummaries.some((item) => item.key === tableState.activeMonthKey)) {
                tableState.activeMonthKey = "";
            }
            updateMonthPickerButtonCaption();
            renderMonthPickerModalContent();
            tableState.decisionOptions = loadedDecisionOptions.length
                ? loadedDecisionOptions
                : buildDecisionOptionsFallback(rawRows);
            tableState.decisionOptionMap = buildDecisionOptionMap(tableState.decisionOptions);
            const rowsRef = tableState.rows;
            buildPureTableFilterControls(tableState.rows);
            applyPureTableFiltersAndRender();

            const baseCountText = `Строк загружено: ${formatInt(tableState.rows.length)}`;
            setPureTableInlineStatus(baseCountText, "success");
            if (!silent) {
                window.MiniUI?.toast?.("Таблица чистых списаний загружена", { type: "success" });
            }

            if (!rowsRef.length) return;

            setPureTableInlineStatus(baseCountText, "loading");
            void enrichRowsWithWmsBase(rowsRef)
                .then(() => {
                    if (tableState.wmsLoadSeq !== wmsSeq) return;
                    if (tableState.rows !== rowsRef) return;
                    applyPureTableFiltersAndRender();
                    setPureTableInlineStatus(baseCountText, "success");
                })
                .catch((wmsError) => {
                    if (tableState.wmsLoadSeq !== wmsSeq) return;
                    if (tableState.rows !== rowsRef) return;
                    console.error("pure_losses wms_base lookup failed:", wmsError);
                    setPureTableInlineStatus(`${baseCountText}. База WMS+ временно недоступна`, "error");
                });
        } catch (error) {
            const message = String(error?.message || error || "Не удалось загрузить таблицу.");
            setPureTableInlineStatus(message, "error");
            renderPureTablePlaceholder(message);
            if (!silent) {
                window.MiniUI?.toast?.("Ошибка загрузки таблицы чистых списаний", { type: "error" });
            }
        }
    }

    async function fetchAllPureRowsForWh(currentUserWhId) {
        const all = [];
        const pageSize = 1000;

        for (let from = 0; ; from += pageSize) {
            const to = from + pageSize - 1;
            const { data, error } = await supabaseClient
                .from(TABLE_PURE)
                .select("*")
                .eq("wh_id", currentUserWhId)
                .order("date_lost", { ascending: false })
                .range(from, to);

            if (error) {
                throw new Error("Не удалось загрузить данные pure_losses_rep.");
            }

            const chunk = Array.isArray(data) ? data : [];
            if (!chunk.length) break;
            all.push(...chunk);
            if (chunk.length < pageSize) break;
        }

        return all;
    }

    function normalizePureTableRow(row) {
        const requestLinks = parseRequestLinks(readEditableColumnValue(row, tableState.updateColumnMap.requestLink));
        const dateLostValue = toText(row?.date_lost);
        const dateLostParsed = parseDateValue(dateLostValue);
        const monthKey = dateLostParsed
            ? `${dateLostParsed.getFullYear()}-${String(dateLostParsed.getMonth() + 1).padStart(2, "0")}`
            : "";
        return {
            raw: row || {},
            shk: normalizeShk(row?.shk),
            nm: row?.nm ?? "",
            description: toText(row?.description || row?.decription),
            brand: toText(row?.brand),
            shkStateBeforeLost: toText(row?.shk_state_before_lost || row?.shk_state) || "—",
            dateLost: dateLostValue,
            monthKey,
            lr: normalizeLossReason(row?.lr) || toText(row?.lr) || "—",
            price: toNumberOrNull(row?.price),
            decision: extractDecisionValue(readEditableColumnValue(row, tableState.updateColumnMap.decision)),
            comment: toText(readEditableColumnValue(row, tableState.updateColumnMap.comment)),
            requestLinks,
            requestLink: requestLinks[0] || "",
            wmsTwoShk: [],
            wmsNmRep: [],
            animateDecisionFill: false,
            animateDecisionFillColor: "",
            forceVisibleUntilTs: 0
        };
    }

    async function loadDecisionOptionsForPureTable(currentUserWhId) {
        const fetchRows = async (withWhFilter) => {
            let query = supabaseClient
                .from(TABLE_WH_DATA)
                .select("data, wh_id, data_type")
                .eq("data_type", DATA_TYPE_OPP_PURE_OPTIONS)
                .limit(500);

            if (withWhFilter && currentUserWhId) {
                query = query.eq("wh_id", currentUserWhId);
            }

            const { data, error } = await query;
            if (error) {
                const errorText = String(error?.message || error?.details || error?.code || "unknown");
                throw new Error(`Не удалось загрузить варианты вердикта: ${errorText}`);
            }
            return Array.isArray(data) ? data : [];
        };

        let scopedRows = [];
        try {
            scopedRows = await fetchRows(true);
        } catch (error) {
            console.error("pure_losses decision options scoped load failed:", error);
        }

        let options = parseDecisionOptionsRows(scopedRows);
        if (options.length) return options;

        const fallbackRows = await fetchRows(false);
        options = parseDecisionOptionsRows(fallbackRows);
        return options;
    }

    function parseDecisionOptionsRows(rows) {
        const map = new Map();

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            parseDecisionOptionsPayload(row?.data).forEach((option) => {
                const normalized = normalizeDecisionOption(option);
                if (!normalized) return;
                const key = decisionOptionKey(normalized.value);
                const existing = map.get(key);
                if (!existing) {
                    map.set(key, normalized);
                    return;
                }
                if (!existing.pillColor && normalized.pillColor) {
                    existing.pillColor = normalized.pillColor;
                }
                if (!existing.rowColor && normalized.rowColor) {
                    existing.rowColor = normalized.rowColor;
                }
            });
        });

        return Array.from(map.values());
    }

    function parseDecisionOptionsPayload(payload) {
        if (payload === null || payload === undefined) return [];
        if (Array.isArray(payload)) {
            return payload.flatMap((item) => parseDecisionOptionItem(item));
        }
        if (typeof payload === "object") {
            const normalized = normalizeDecisionOption(payload);
            return normalized ? [normalized] : [];
        }

        const raw = String(payload).trim();
        if (!raw) return [];

        if (raw.startsWith("[") && raw.endsWith("]")) {
            try {
                const parsed = JSON.parse(raw);
                return parseDecisionOptionsPayload(parsed);
            } catch (_) {
                // fallback below
            }
        }

        return raw
            .split(/[\r\n;]+/)
            .flatMap((item) => parseDecisionOptionItem(item));
    }

    function parseDecisionOptionItem(item) {
        if (item === null || item === undefined) return [];
        if (Array.isArray(item)) {
            const normalized = normalizeDecisionOption({
                value: item[0],
                pillColor: item[1],
                rowColor: item[2]
            });
            return normalized ? [normalized] : [];
        }
        if (typeof item === "object") {
            const normalized = normalizeDecisionOption(item);
            return normalized ? [normalized] : [];
        }

        const raw = String(item).trim();
        if (!raw) return [];
        if (raw.includes("\n") || raw.includes(";")) {
            return raw
                .split(/[\r\n;]+/)
                .flatMap((line) => parseDecisionOptionItem(line));
        }

        const normalized = parseDecisionOptionLine(raw);
        return normalized ? [normalized] : [];
    }

    function parseDecisionOptionLine(rawLine) {
        const tokens = splitDecisionOptionTokens(rawLine);
        if (!tokens.length) return null;
        return normalizeDecisionOption({
            value: tokens[0],
            pillColor: tokens[1],
            rowColor: tokens[2]
        });
    }

    function splitDecisionOptionTokens(rawLine) {
        const source = String(rawLine || "").trim().replace(/;+$/g, "");
        if (!source) return [];

        const tokens = [];
        let token = "";
        let quoteChar = "";

        for (let i = 0; i < source.length; i += 1) {
            const ch = source[i];
            if (quoteChar) {
                if (ch === quoteChar) {
                    quoteChar = "";
                } else {
                    token += ch;
                }
                continue;
            }
            if (ch === "\"" || ch === "'") {
                quoteChar = ch;
                continue;
            }
            if (ch === ",") {
                tokens.push(token);
                token = "";
                continue;
            }
            token += ch;
        }
        tokens.push(token);

        return tokens.map((part) => sanitizeDecisionOptionText(part));
    }

    function sanitizeDecisionOptionText(value) {
        const text = String(value || "")
            .trim()
            .replace(/^"+|"+$/g, "")
            .replace(/^'+|'+$/g, "")
            .replace(/\s+/g, " ");
        return text;
    }

    function extractDecisionValue(value) {
        if (value === null || value === undefined) return "";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return sanitizeDecisionOptionText(value);
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const normalized = extractDecisionValue(item);
                if (normalized) return normalized;
            }
            return "";
        }

        if (typeof value === "object") {
            const candidate = value.value
                ?? value.text
                ?? value.label
                ?? value.option
                ?? value.name
                ?? "";
            return extractDecisionValue(candidate);
        }

        return "";
    }

    function normalizeDecisionOption(option) {
        if (option === null || option === undefined) return null;

        const value = extractDecisionValue(
            typeof option === "string" || typeof option === "number"
                ? option
                : option.value ?? option.text ?? option.option ?? option.label ?? option.name
        );
        if (!value) return null;

        const pillColor = normalizeDecisionColor(option.pillColor ?? option.pill_color ?? option.color ?? option.pill ?? "");
        const rowColor = normalizeDecisionColor(option.rowColor ?? option.row_color ?? option.fillColor ?? option.fill_color ?? option.fill ?? "");
        return { value, pillColor, rowColor };
    }

    function normalizeDecisionColor(value) {
        const clean = sanitizeDecisionOptionText(value).replace(/^#/, "");
        if (!clean) return "";
        if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(clean)) return "";
        return `#${clean.toLowerCase()}`;
    }

    function decisionOptionKey(value) {
        const normalized = extractDecisionValue(value);
        if (!normalized) return "__empty__";
        return normalized.toLowerCase();
    }

    function buildDecisionOptionMap(options) {
        const map = new Map();
        (Array.isArray(options) ? options : []).forEach((option) => {
            const normalized = normalizeDecisionOption(option);
            if (!normalized) return;
            map.set(decisionOptionKey(normalized.value), normalized);
        });
        return map;
    }

    function getDecisionOptionByValue(value) {
        const key = decisionOptionKey(value);
        const fromMap = tableState.decisionOptionMap.get(key);
        if (fromMap) return fromMap;

        const normalizedValue = extractDecisionValue(value);
        return {
            value: normalizedValue,
            pillColor: "",
            rowColor: ""
        };
    }

    function buildDecisionOptionsFallback(rawRows) {
        const map = new Map();
        const out = [];
        (Array.isArray(rawRows) ? rawRows : []).forEach((row) => {
            const decision = extractDecisionValue(readEditableColumnValue(row, tableState.updateColumnMap.decision));
            if (!decision) return;
            const normalized = normalizeDecisionOption({ value: decision });
            if (!normalized) return;
            const key = decisionOptionKey(normalized.value);
            if (map.has(key)) return;
            map.set(key, normalized);
            out.push(normalized);
        });
        return out;
    }

    async function enrichRowsWithWmsBase(rows) {
        const safeRows = Array.isArray(rows) ? rows : [];
        if (!safeRows.length) return;

        const uniqueShks = Array.from(new Set(
            safeRows.map((row) => normalizeShk(row?.shk)).filter(Boolean)
        ));
        const uniqueNms = Array.from(new Set(
            safeRows.map((row) => normalizeNmKey(row?.nm)).filter(Boolean)
        ));

        const [twoShkMap, nmRepMap] = await Promise.all([
            fetchTwoShkRowsForShks(uniqueShks),
            fetchNmRepRowsForNms(uniqueNms)
        ]);

        safeRows.forEach((row) => {
            const shk = normalizeShk(row?.shk);
            const nm = normalizeNmKey(row?.nm);
            row.wmsTwoShk = twoShkMap.get(shk) || [];
            row.wmsNmRep = filterNmRepRowsByLossDateWindow(row, nmRepMap.get(nm) || []);
        });
    }

    async function fetchTwoShkRowsForShks(shks) {
        const uniqueShks = Array.from(new Set((Array.isArray(shks) ? shks : []).map(normalizeShk).filter(Boolean)));
        if (!uniqueShks.length) return new Map();

        const chunks = chunkArray(uniqueShks, WMS_FILTER_CHUNK_SIZE);
        const allRows = [];
        for (const chunk of chunks) {
            const [byShk1, byShk2] = await Promise.all([
                fetchTwoShkRowsByColumnChunk("shk1", chunk),
                fetchTwoShkRowsByColumnChunk("shk2", chunk)
            ]);
            allRows.push(...byShk1, ...byShk2);
        }

        return mapTwoShkRowsByShk(allRows);
    }

    async function fetchTwoShkRowsByColumnChunk(columnName, shksChunk) {
        const chunk = Array.isArray(shksChunk) ? shksChunk.filter(Boolean) : [];
        if (!chunk.length) return [];

        const { data, error } = await supabaseClient
            .from(TABLE_2SHK)
            .select("*")
            .in(columnName, chunk);

        if (!error) {
            return Array.isArray(data) ? data : [];
        }

        const missingColumn = extractMissingColumnName(error);
        if (missingColumn && missingColumn === columnName) {
            return [];
        }

        if (chunk.length > 1) {
            const mid = Math.ceil(chunk.length / 2);
            const left = await fetchTwoShkRowsByColumnChunk(columnName, chunk.slice(0, mid));
            const right = await fetchTwoShkRowsByColumnChunk(columnName, chunk.slice(mid));
            return left.concat(right);
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось проверить ШК ${chunk[0]} в ${TABLE_2SHK}: ${errorText}`);
    }

    function mapTwoShkRowsByShk(rows) {
        const map = new Map();
        const seen = new Set();

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const signature = buildTwoShkRowSignature(row);
            if (!signature || seen.has(signature)) return;
            seen.add(signature);

            const shk1 = normalizeShk(row?.shk1);
            const shk2 = normalizeShk(row?.shk2);
            if (!shk1 && !shk2) return;

            const eventType = classifyTwoShkEventType(row?.eventtype, shk1, shk2);
            const dateValue = row?.created_at || row?.date || row?.inserted_at || row?.updated_at || "";
            const ts = parseTimestampValue(dateValue);
            const mediaLinks = parseMediaLinksFromTwoShkRow(row);

            const base = {
                eventType,
                shk1,
                shk2,
                dateValue,
                ts,
                mediaLinks
            };

            if (shk1) {
                if (!map.has(shk1)) map.set(shk1, []);
                map.get(shk1).push({
                    ...base,
                    otherShk: shk2 && shk2 !== shk1 ? shk2 : ""
                });
            }

            if (shk2 && shk2 !== shk1) {
                if (!map.has(shk2)) map.set(shk2, []);
                map.get(shk2).push({
                    ...base,
                    otherShk: shk1
                });
            }
        });

        map.forEach((items, key) => {
            const sorted = (items || []).slice().sort((a, b) => compareDateTs(b?.ts, a?.ts));
            map.set(key, sorted);
        });

        return map;
    }

    function classifyTwoShkEventType(value, shk1, shk2) {
        const normalized = String(value || "")
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^\wа-я\s]/gi, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (normalized.includes("пуст") && normalized.includes("упаков")) {
            return EVENT_EMPTY_PACK;
        }
        if (normalized.includes("2") && normalized.includes("шк")) {
            return EVENT_TWO_SHK;
        }
        if (normalized.includes("два") && normalized.includes("шк")) {
            return EVENT_TWO_SHK;
        }
        if (normalized.includes("пуст")) {
            return EVENT_EMPTY_PACK;
        }

        if (shk1 && shk2 && shk1 !== shk2) {
            return EVENT_TWO_SHK;
        }
        return EVENT_EMPTY_PACK;
    }

    function buildTwoShkRowSignature(row) {
        if (!row || typeof row !== "object") return "";
        const id = normalizeToken(row?.id || row?.two_shk_id || row?.row_id);
        if (id) return `id:${id}`;

        const dateValue = normalizeToken(row?.created_at || row?.date || row?.inserted_at || row?.updated_at);
        const shk1 = normalizeShk(row?.shk1);
        const shk2 = normalizeShk(row?.shk2);
        const eventType = normalizeToken(row?.eventtype);
        return `${dateValue}|${shk1}|${shk2}|${eventType}`;
    }

    function parseMediaLinksFromTwoShkRow(row) {
        const mediaFields = [
            row?.media,
            row?.media_links,
            row?.photos,
            row?.photo
        ];

        const links = [];
        mediaFields.forEach((value) => {
            if (Array.isArray(value)) {
                value.forEach((item) => {
                    const href = normalizeMediaLink(item);
                    if (href) links.push(href);
                });
                return;
            }

            parseMediaLinks(value).forEach((href) => {
                if (href) links.push(href);
            });
        });

        return Array.from(new Set(links));
    }

    function parseMediaLinks(value) {
        if (Array.isArray(value)) {
            return value.map((item) => normalizeMediaLink(item)).filter(Boolean);
        }

        const raw = String(value || "").trim();
        if (!raw) return [];

        if (raw.startsWith("[") && raw.endsWith("]")) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.map((item) => normalizeMediaLink(item)).filter(Boolean);
                }
            } catch (_) {
                // fallback to plain split below
            }
        }

        return raw
            .split(",")
            .map((item) => normalizeMediaLink(item))
            .filter(Boolean);
    }

    function normalizeMediaLink(url) {
        const value = String(url || "").trim().replace(/^"+|"+$/g, "");
        if (!value) return "";
        if (/^https?:\/\//i.test(value)) return value;
        if (/^www\./i.test(value)) return `https://${value}`;
        return value;
    }

    async function fetchNmRepRowsForNms(nms) {
        const uniqueNms = Array.from(new Set((Array.isArray(nms) ? nms : []).map(normalizeNmKey).filter(Boolean)));
        if (!uniqueNms.length) return new Map();

        const chunks = chunkArray(uniqueNms, WMS_FILTER_CHUNK_SIZE);
        const allRows = [];
        for (const chunk of chunks) {
            const rows = await fetchNmRepRowsByNmChunk(chunk);
            allRows.push(...rows);
        }

        return mapNmRepRowsByNm(allRows);
    }

    async function fetchNmRepRowsByNmChunk(nmChunk) {
        const chunk = Array.isArray(nmChunk) ? nmChunk.filter(Boolean) : [];
        if (!chunk.length) return [];

        const { data, error } = await supabaseClient
            .from(TABLE_NM)
            .select("*")
            .in("nm", chunk);

        if (!error) {
            return Array.isArray(data) ? data : [];
        }

        const missingColumn = extractMissingColumnName(error);
        if (missingColumn && missingColumn === "nm") {
            return [];
        }

        if (chunk.length > 1) {
            const mid = Math.ceil(chunk.length / 2);
            const left = await fetchNmRepRowsByNmChunk(chunk.slice(0, mid));
            const right = await fetchNmRepRowsByNmChunk(chunk.slice(mid));
            return left.concat(right);
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось проверить НМ ${chunk[0]} в ${TABLE_NM}: ${errorText}`);
    }

    function mapNmRepRowsByNm(rows) {
        const map = new Map();
        const seen = new Set();

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const signature = buildNmRepRowSignature(row);
            if (!signature || seen.has(signature)) return;
            seen.add(signature);

            const nm = normalizeNmKey(row?.nm);
            if (!nm) return;

            const dateValue = row?.date || row?.created_at || row?.inserted_at || row?.updated_at || "";
            const ts = parseTimestampValue(dateValue);
            const dateOnly = parseDateValue(dateValue)
                || (Number.isFinite(ts) ? new Date(new Date(ts).getFullYear(), new Date(ts).getMonth(), new Date(ts).getDate()) : null);
            const assignedShk = normalizeShk(row?.new_sticker || row?.shk || row?.sticker || row?.barcode);
            const emp = toText(row?.emp);
            const empName = toText(row?.emp_name || row?.fio || row?.name);

            if (!map.has(nm)) map.set(nm, []);
            map.get(nm).push({
                nm,
                dateValue,
                ts,
                dateOnly,
                emp,
                empName,
                assignedShk
            });
        });

        map.forEach((items, key) => {
            const sorted = (items || []).slice().sort((a, b) => compareDateTs(b?.ts, a?.ts));
            map.set(key, sorted);
        });

        return map;
    }

    function filterNmRepRowsByLossDateWindow(row, nmRows) {
        const items = Array.isArray(nmRows) ? nmRows : [];
        if (!items.length) return [];

        const lossDate = parseDateValue(row?.dateLost || row?.date_lost || row?.raw?.date_lost);
        if (!lossDate) return [];

        const minDate = addMonths(lossDate, -1);
        const maxDate = addMonths(lossDate, 1);

        return items.filter((item) => {
            const itemDate = item?.dateOnly || parseDateValue(item?.dateValue);
            if (!(itemDate instanceof Date) || Number.isNaN(itemDate.getTime())) return false;
            return compareDateTs(itemDate.getTime(), minDate.getTime()) >= 0
                && compareDateTs(itemDate.getTime(), maxDate.getTime()) <= 0;
        });
    }

    function buildNmRepRowSignature(row) {
        if (!row || typeof row !== "object") return "";
        const id = normalizeToken(row?.id || row?.nm_rep_id || row?.row_id);
        if (id) return `id:${id}`;

        const nm = normalizeNmKey(row?.nm);
        const dateValue = normalizeToken(row?.date || row?.created_at || row?.inserted_at || row?.updated_at);
        const emp = normalizeToken(row?.emp);
        const assigned = normalizeShk(row?.new_sticker || row?.shk || row?.sticker || row?.barcode);
        return `${nm}|${dateValue}|${emp}|${assigned}`;
    }

    function normalizeNmKey(value) {
        return normalizeToken(value);
    }

    function parseTimestampValue(value) {
        if (value === null || value === undefined || value === "") return null;
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
        if (typeof value === "number" && Number.isFinite(value)) return value;

        const raw = String(value).trim();
        if (!raw) return null;

        let normalized = raw.replace(" ", "T");
        normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
        const hasOffset = /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{2})$/.test(normalized);
        const parsed = hasOffset ? new Date(normalized) : new Date(`${normalized}Z`);
        if (!Number.isNaN(parsed.getTime())) return parsed.getTime();

        const dateOnly = parseDateValue(raw);
        if (dateOnly && !Number.isNaN(dateOnly.getTime())) return dateOnly.getTime();
        return null;
    }

    function formatDateTimeMsk(value) {
        const ts = parseTimestampValue(value);
        if (!Number.isFinite(ts)) return "—";
        return new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Europe/Moscow",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(ts));
    }

    function resolvePureTableUpdateColumns(rawRows) {
        const sample = Array.isArray(rawRows) ? rawRows.find((item) => item && typeof item === "object") : null;
        const keys = sample ? Object.keys(sample) : [];

        tableState.updateColumnMap.decision = pickFirstExistingColumn(
            keys,
            ["opp_deecision", "opp_decision"],
            "opp_deecision"
        );
        tableState.updateColumnMap.comment = pickFirstExistingColumn(
            keys,
            ["opp_comment"],
            "opp_comment"
        );
        tableState.updateColumnMap.emp = pickFirstExistingColumn(
            keys,
            ["opp_emp", "emp"],
            "opp_emp"
        );
        tableState.updateColumnMap.solved = pickFirstExistingColumn(
            keys,
            ["date_solved", "dt_solved"],
            "date_solved"
        );
        tableState.updateColumnMap.requestLink = pickFirstExistingColumn(
            keys,
            ["opp_request_link", "request_link", "opp_link"],
            "opp_request_link"
        );
    }

    function pickFirstExistingColumn(keys, candidates, fallback) {
        const safeKeys = Array.isArray(keys) ? keys : [];
        for (const candidate of candidates) {
            if (safeKeys.includes(candidate)) return candidate;
        }
        return fallback;
    }

    function readEditableColumnValue(row, key) {
        if (!row || !key) return "";
        if (!Object.prototype.hasOwnProperty.call(row, key)) return "";
        return row[key];
    }

    function buildPureTableFilterControls(rows) {
        const lrValues = Array.from(new Set(rows.map((row) => row.lr).filter((value) => String(value).trim() !== "")))
            .sort(sortMixedNumericStrings);
        const statusValues = Array.from(new Set(rows.map((row) => row.shkStateBeforeLost).filter(Boolean)))
            .sort((a, b) => String(a).localeCompare(String(b), "ru"));
        const extraValues = EXTRA_FILTER_VALUES.slice();

        syncFilterSet(tableState.activeLrs, lrValues);
        syncFilterSet(tableState.activeStatuses, statusValues);
        syncFilterSet(tableState.activeExtraStatuses, extraValues);

        renderFilterCheckboxList(
            pureFilterLrList,
            lrValues,
            tableState.activeLrs,
            () => {
                updateFilterButtonCaption(pureFilterLrBtn, tableState.activeLrs.size, lrValues.length);
                applyPureTableFiltersAndRender();
            }
        );
        renderFilterCheckboxList(
            pureFilterStatusList,
            statusValues,
            tableState.activeStatuses,
            () => {
                updateFilterButtonCaption(pureFilterStatusBtn, tableState.activeStatuses.size, statusValues.length);
                applyPureTableFiltersAndRender();
            }
        );
        renderFilterCheckboxList(
            pureFilterExtraList,
            extraValues,
            tableState.activeExtraStatuses,
            () => {
                updateFilterButtonCaption(pureFilterExtraBtn, tableState.activeExtraStatuses.size, extraValues.length);
                applyPureTableFiltersAndRender();
            }
        );

        updateFilterButtonCaption(pureFilterLrBtn, tableState.activeLrs.size, lrValues.length);
        updateFilterButtonCaption(pureFilterStatusBtn, tableState.activeStatuses.size, statusValues.length);
        updateFilterButtonCaption(pureFilterExtraBtn, tableState.activeExtraStatuses.size, extraValues.length);
    }

    function syncFilterSet(set, values) {
        if (!set || !(set instanceof Set)) return;

        const safeValues = Array.isArray(values) ? values : [];
        if (!set.size) {
            safeValues.forEach((value) => set.add(value));
            return;
        }

        Array.from(set).forEach((value) => {
            if (!safeValues.includes(value)) set.delete(value);
        });

        if (!set.size && safeValues.length) {
            safeValues.forEach((value) => set.add(value));
        }
    }

    function renderFilterCheckboxList(container, values, selectedSet, onChange) {
        if (!container) return;
        container.innerHTML = "";

        const safeValues = Array.isArray(values) ? values : [];
        if (!safeValues.length) {
            const empty = document.createElement("div");
            empty.className = "muted";
            empty.textContent = "Нет значений";
            container.appendChild(empty);
            return;
        }

        const allLabel = document.createElement("label");
        allLabel.className = "status-item";

        const allCheckbox = document.createElement("input");
        allCheckbox.type = "checkbox";

        const allText = document.createElement("span");
        allText.textContent = "Выбрать всё";
        const optionCheckboxes = [];

        function syncAllCheckboxState() {
            const selectedCount = selectedSet.size;
            const totalCount = safeValues.length;
            allCheckbox.checked = totalCount > 0 && selectedCount === totalCount;
            allCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalCount;
        }

        function syncOptionCheckboxes() {
            optionCheckboxes.forEach(({ checkbox, value }) => {
                checkbox.checked = selectedSet.has(value);
            });
        }

        allCheckbox.addEventListener("change", () => {
            if (allCheckbox.checked) {
                selectedSet.clear();
                safeValues.forEach((value) => selectedSet.add(value));
            } else {
                selectedSet.clear();
            }
            syncOptionCheckboxes();
            syncAllCheckboxState();
            onChange();
        });

        allLabel.append(allCheckbox, allText);
        container.appendChild(allLabel);

        safeValues.forEach((value) => {
            const label = document.createElement("label");
            label.className = "status-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = selectedSet.has(value);
            optionCheckboxes.push({ checkbox, value });

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) selectedSet.add(value);
                else selectedSet.delete(value);
                syncAllCheckboxState();
                onChange();
            });

            const span = document.createElement("span");
            span.textContent = String(value);

            label.append(checkbox, span);
            container.appendChild(label);
        });

        syncOptionCheckboxes();
        syncAllCheckboxState();
    }

    function updateFilterButtonCaption(button, selectedCount, totalCount) {
        if (!button) return;
        const text = totalCount <= 0 || selectedCount === totalCount
            ? "Выбраны все"
            : `Выбрано ${selectedCount} из ${totalCount}`;
        button.innerHTML = `${escapeHtml(text)} <span class="caret">▾</span>`;
    }

    function applyPureTableFiltersAndRender() {
        const nowTs = Date.now();
        const filtered = tableState.rows.filter((row) => {
            const matchMonth = !tableState.activeMonthKey || row.monthKey === tableState.activeMonthKey;
            const matchLr = tableState.activeLrs.has(row.lr);
            const matchStatus = tableState.activeStatuses.has(row.shkStateBeforeLost);
            const matchExtra = rowMatchesExtraFilter(row, tableState.activeExtraStatuses);
            const isTemporarilyVisible = Number(row?.forceVisibleUntilTs || 0) > nowTs;
            const matchUnresolved = !tableState.onlyUnresolved
                || !extractDecisionValue(row.decision)
                || isTemporarilyVisible;
            return matchMonth && matchLr && matchStatus && matchExtra && matchUnresolved;
        });

        tableState.filteredRows = sortPureRows(filtered);
        renderPureTableBody(tableState.filteredRows);
        updatePureTableSortIndicators();
    }

    function rowMatchesExtraFilter(row, activeSet) {
        if (!(activeSet instanceof Set)) return true;
        const statuses = getRowExtraStatuses(row);
        if (!statuses.length) return activeSet.has("Пусто");
        return statuses.some((status) => activeSet.has(status));
    }

    function getRowExtraStatuses(row) {
        const statuses = new Set();

        const twoShkRows = Array.isArray(row?.wmsTwoShk) ? row.wmsTwoShk : [];
        twoShkRows.forEach((item) => {
            const eventType = String(item?.eventType || "");
            if (eventType === EVENT_TWO_SHK) statuses.add("2 ШК");
            if (eventType === EVENT_EMPTY_PACK) statuses.add("Пустая упаковка");
        });

        const nmRows = Array.isArray(row?.wmsNmRep) ? row.wmsNmRep : [];
        if (nmRows.length) statuses.add("Оприход");

        if (!statuses.size) statuses.add("Пусто");
        return Array.from(statuses);
    }

    function getLatestNmRepEntry(row) {
        const nmRows = Array.isArray(row?.wmsNmRep) ? row.wmsNmRep : [];
        return nmRows.length ? nmRows[0] : null;
    }

    function isSameShkAcceptance(row, nmEntry) {
        const rowShk = normalizeShk(row?.shk);
        const assignedShk = normalizeShk(nmEntry?.assignedShk);
        return Boolean(rowShk && assignedShk && rowShk === assignedShk);
    }

    function renderPureTablePlaceholder(message) {
        if (!pureTableBody) return;
        closeAllWmsPopovers();
        closeActiveVerdictPanel();
        pureTableBody.innerHTML = "";
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 10;
        td.className = "muted";
        td.textContent = String(message || "");
        tr.appendChild(td);
        pureTableBody.appendChild(tr);
    }

    function renderPureTableBody(rows) {
        if (!pureTableBody) return;
        closeAllWmsPopovers();
        closeActiveVerdictPanel();
        pureTableBody.innerHTML = "";

        const safeRows = Array.isArray(rows) ? rows : [];
        if (!safeRows.length) {
            renderPureTablePlaceholder("По выбранным фильтрам строк нет.");
            return;
        }

        safeRows.forEach((row) => {
            const tr = document.createElement("tr");
            const extraStatuses = getRowExtraStatuses(row);
            const hasTwoShkOrEmpty = extraStatuses.includes("2 ШК") || extraStatuses.includes("Пустая упаковка");
            const hasAcceptance = extraStatuses.includes("Оприход");
            const latestNmRep = getLatestNmRepEntry(row);
            const hasSameShkAcceptance = hasAcceptance && isSameShkAcceptance(row, latestNmRep);
            const decisionOption = getDecisionOptionByValue(row.decision);
            const isDecisionVisualRow = !hasAcceptance && !hasTwoShkOrEmpty && Boolean(decisionOption?.rowColor);
            let rowFillColor = "";
            if (hasAcceptance) {
                if (hasSameShkAcceptance) {
                    tr.classList.add("pure-row-oprihod-same-shk");
                    rowFillColor = "#15803d";
                } else {
                    tr.classList.add("pure-row-oprihod");
                    rowFillColor = "#5b21b6";
                }
            } else if (hasTwoShkOrEmpty) {
                tr.classList.add("pure-row-blackout");
                rowFillColor = "#0f172a";
            } else if (decisionOption?.rowColor) {
                tr.classList.add("pure-row-decision");
                tr.style.setProperty("--pure-row-decision-bg", decisionOption.rowColor);
                tr.style.setProperty("--pure-row-decision-fg", pickContrastColor(hexToRgb(decisionOption.rowColor)));
                rowFillColor = decisionOption.rowColor;
            }

            const animatedFillColor = normalizeDecisionColor(row.animateDecisionFillColor) || rowFillColor;
            if (row.animateDecisionFill && animatedFillColor) {
                tr.classList.add("pure-row-fill-anim");
                if (isDecisionVisualRow) {
                    tr.classList.add("pure-row-fill-no-base");
                }
                tr.style.setProperty("--pure-row-fill-color", animatedFillColor);
            }

            const cells = [];
            cells.push(createShkCell(row.shk));
            cells.push(createSubjectCell(row.nm, row.description, row.brand));
            cells.push(createPlainCell(row.shkStateBeforeLost, "pure-col-status"));
            cells.push(createPlainCell(formatDateForUi(row.dateLost), "pure-col-date"));
            cells.push(createPlainCell(row.lr, "pure-col-lr"));
            cells.push(createPriceCell(row.price));
            cells.push(createGapCell());

            const verdictTd = document.createElement("td");
            verdictTd.className = "pure-col-verdict";
            verdictTd.appendChild(createVerdictDropdownCell(row, decisionOption));
            cells.push(verdictTd);

            const commentTd = document.createElement("td");
            const commentInput = document.createElement("input");
            commentInput.className = "input pure-edit-input comment";
            commentInput.type = "text";
            commentInput.value = row.comment;
            commentInput.placeholder = "Комментарий";
            commentInput.dataset.shk = row.shk;
            commentInput.dataset.dateLost = normalizeDateIsoValue(row?.dateLost);
            commentInput.dataset.field = "comment";
            if (isAutoFoundLockedRow(row)) {
                commentInput.disabled = true;
                commentInput.title = "Комментарий недоступен для редактирования";
            }
            commentTd.appendChild(commentInput);
            cells.push(commentTd);
            cells.push(createWmsBaseCell(row));

            cells.forEach((cell) => tr.appendChild(cell));

            pureTableBody.appendChild(tr);
            if (row.animateDecisionFill) {
                runRowFillAnimation(tr, ROW_FILL_ANIMATION_TOTAL_MS);
                window.setTimeout(() => {
                    if (!tr.isConnected) return;
                    const rafId = rowFillRafMap.get(tr);
                    if (rafId) {
                        window.cancelAnimationFrame(rafId);
                        rowFillRafMap.delete(tr);
                    }
                    tr.classList.remove("pure-row-fill-anim");
                    tr.classList.remove("pure-row-fill-no-base");
                    tr.style.removeProperty("--pure-row-fill-color");
                    tr.style.removeProperty("--pure-row-fill-x");
                    tr.querySelectorAll("td").forEach((cell) => {
                        cell.style.removeProperty("--pure-row-total-width");
                        cell.style.removeProperty("--pure-row-cell-left");
                    });
                }, ROW_FILL_ANIMATION_TOTAL_MS);
            }
            row.animateDecisionFill = false;
            row.animateDecisionFillColor = "";
        });
    }

    function runRowFillAnimation(tr, durationMs) {
        if (!(tr instanceof HTMLTableRowElement)) return;
        const cells = Array.from(tr.querySelectorAll("td:not(.pure-price-cell)"));
        if (!cells.length) return;

        const existingRaf = rowFillRafMap.get(tr);
        if (existingRaf) {
            window.cancelAnimationFrame(existingRaf);
            rowFillRafMap.delete(tr);
        }

        const rowRect = tr.getBoundingClientRect();
        const totalWidth = Math.max(1, Number(rowRect.width || tr.scrollWidth || 1));
        cells.forEach((cell) => {
            const left = Math.max(0, Number(cell.offsetLeft || 0));
            cell.style.setProperty("--pure-row-total-width", `${totalWidth}px`);
            cell.style.setProperty("--pure-row-cell-left", `${left}px`);
        });

        const safeDuration = Math.max(1, Number(durationMs) || ROW_FILL_ANIMATION_TOTAL_MS);
        let startTs = null;

        const easeOutCubic = (t) => {
            const x = Math.min(1, Math.max(0, t));
            return 1 - Math.pow(1 - x, 3);
        };

        const tick = (now) => {
            if (!tr.isConnected || !tr.classList.contains("pure-row-fill-anim")) {
                rowFillRafMap.delete(tr);
                return;
            }

            if (startTs === null) startTs = now;
            const linear = Math.min(1, Math.max(0, (now - startTs) / safeDuration));
            const eased = easeOutCubic(linear);
            const fillPx = Math.max(1, totalWidth * eased);
            tr.style.setProperty("--pure-row-fill-x", `${fillPx.toFixed(3)}px`);

            if (linear >= 1) {
                rowFillRafMap.delete(tr);
                return;
            }

            const rafId = window.requestAnimationFrame(tick);
            rowFillRafMap.set(tr, rafId);
        };

        tr.style.setProperty("--pure-row-fill-x", "1px");
        const rafId = window.requestAnimationFrame(tick);
        rowFillRafMap.set(tr, rafId);
    }

    function createShkCell(shkValue) {
        const td = document.createElement("td");
        td.className = "pure-col-shk pure-shk-cell";

        const normalized = normalizeShk(shkValue);
        if (!normalized) {
            td.textContent = "—";
            return td;
        }

        const pill = document.createElement("span");
        pill.className = "pure-shk-pill";

        const link = document.createElement("a");
        link.className = "pure-shk-link";
        link.href = `https://wms.wbwh.tech/shk/status/history?shk=${encodeURIComponent(normalized)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = normalized;

        pill.appendChild(link);
        td.appendChild(pill);
        return td;
    }

    function createPlainCell(value, className = "") {
        const td = document.createElement("td");
        if (className) td.className = className;
        td.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
        return td;
    }

    function createVerdictDropdownCell(row, currentOptionOverride) {
        const currentValue = extractDecisionValue(row?.decision);
        const currentOption = normalizeDecisionOption(currentOptionOverride) || getDecisionOptionByValue(currentValue);
        const options = getDecisionOptionsForRow(currentValue);
        const isLocked = isAutoFoundLockedRow(row);
        const dateLost = normalizeDateIsoValue(row?.dateLost || row?.date_lost || row?.raw?.date_lost);

        const wrap = document.createElement("div");
        wrap.className = "pure-row-verdict-dropdown";
        wrap.dataset.shk = row?.shk || "";
        wrap.dataset.dateLost = dateLost;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-outline pure-row-verdict-btn";
        btn.dataset.verdictToggle = "1";
        btn.dataset.shk = row?.shk || "";
        btn.dataset.dateLost = dateLost;
        btn.setAttribute("aria-expanded", "false");
        setVerdictButtonContent(btn, currentValue || "Выбрать");
        applyVerdictButtonColors(btn, currentOption?.pillColor);
        if (isLocked) {
            btn.disabled = true;
            btn.title = "Автоматически разобрано по движению товара";
        }

        const panel = document.createElement("div");
        panel.className = "pure-row-verdict-panel hidden";

        if (!isLocked) {
            options.forEach((option) => {
                const value = extractDecisionValue(option?.value);
                const optionBtn = document.createElement("button");
                optionBtn.type = "button";
                optionBtn.className = "pure-row-verdict-option";
                if (value === currentValue) {
                    optionBtn.classList.add("is-selected");
                }
                optionBtn.dataset.verdictOption = "1";
                optionBtn.dataset.shk = row?.shk || "";
                optionBtn.dataset.dateLost = dateLost;
                optionBtn.dataset.value = value;
                optionBtn.dataset.pillColor = option?.pillColor || "";
                optionBtn.dataset.rowColor = option?.rowColor || "";
                optionBtn.textContent = value || "—";
                if (option?.pillColor) {
                    optionBtn.style.setProperty("border-left", `3px solid ${option.pillColor}`);
                    optionBtn.style.setProperty("padding-left", "6px");
                }
                panel.appendChild(optionBtn);
            });
            wrap.append(btn, panel);
        } else {
            wrap.append(btn);
        }
        return wrap;
    }

    function getDecisionOptionsForRow(currentValue) {
        const normalizedCurrentValue = extractDecisionValue(currentValue);
        const options = [];
        const seen = new Set();
        options.push({ value: "", pillColor: "", rowColor: "" });
        seen.add("__empty__");

        const addOption = (option) => {
            const normalized = normalizeDecisionOption(option) || normalizeDecisionOption({ value: option });
            if (!normalized) return;
            const key = decisionOptionKey(normalized.value);
            if (seen.has(key)) return;
            seen.add(key);
            options.push(normalized);
        };

        (Array.isArray(tableState.decisionOptions) ? tableState.decisionOptions : []).forEach(addOption);
        addOption(getDecisionOptionByValue(normalizedCurrentValue));

        return options;
    }

    function applyVerdictButtonColors(button, pillColor) {
        if (!(button instanceof HTMLButtonElement)) return;
        const color = normalizeDecisionColor(pillColor);
        if (!color) {
            button.style.removeProperty("background-color");
            button.style.removeProperty("border-color");
            button.style.removeProperty("color");
            return;
        }
        button.style.backgroundColor = color;
        button.style.borderColor = color;
        button.style.color = pickContrastColor(hexToRgb(color));
    }

    function setVerdictButtonContent(button, text) {
        if (!(button instanceof HTMLButtonElement)) return;
        button.innerHTML = "";

        const label = document.createElement("span");
        label.className = "pure-row-verdict-label";
        label.textContent = String(text || "Выбрать");

        const caret = document.createElement("span");
        caret.className = "caret";
        caret.textContent = "▾";

        button.append(label, caret);
    }

    function isRequestLinkRequiredDecision(value) {
        return extractDecisionValue(value).toLowerCase() === VERDICT_REQUEST_REQUIRED;
    }

    function parseRequestLinks(value) {
        if (value === null || value === undefined) return [];

        if (Array.isArray(value)) {
            return dedupeRequestLinks(value.map((item) => toText(item)).filter(Boolean));
        }

        if (typeof value === "object") {
            const nested = value.links
                ?? value.items
                ?? value.value
                ?? value.urls
                ?? value.requests
                ?? value.href
                ?? value.url
                ?? value.link;
            return nested === undefined ? [] : parseRequestLinks(nested);
        }

        const raw = toText(value);
        if (!raw) return [];

        if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
            try {
                const parsed = JSON.parse(raw);
                return parseRequestLinks(parsed);
            } catch (_) {
                // fallback to plain text parsing below
            }
        }

        const parts = (raw.includes("\n") || raw.includes(";"))
            ? raw.split(/[\r\n;]+/)
            : [raw];

        return dedupeRequestLinks(parts.map((item) => toText(item)).filter(Boolean));
    }

    function dedupeRequestLinks(values) {
        const out = [];
        const seen = new Set();
        (Array.isArray(values) ? values : []).forEach((item) => {
            const clean = toText(item);
            if (!clean) return;
            const key = clean.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(clean);
        });
        return out;
    }

    function serializeRequestLinks(values) {
        const unique = dedupeRequestLinks(values);
        if (!unique.length) return null;
        if (unique.length === 1) return unique[0];
        return JSON.stringify(unique);
    }

    function getRowRequestLinks(row) {
        if (Array.isArray(row?.requestLinks)) {
            return dedupeRequestLinks(row.requestLinks);
        }
        return parseRequestLinks(row?.requestLink ?? row?.raw?.[tableState.updateColumnMap.requestLink]);
    }

    function compactLinkForUi(value) {
        const link = toText(value);
        if (!link) return "";
        if (link.length <= 30) return link;
        return `${link.slice(0, 27)}...`;
    }

    function createWmsBaseCell(row) {
        const td = document.createElement("td");
        td.className = "pure-col-extra pure-col-wms";

        const entries = buildWmsBaseEntriesForRow(row);
        if (!entries.length) {
            td.textContent = "";
            return td;
        }

        const wrap = document.createElement("div");
        wrap.className = "pure-wms-buttons";

        entries.forEach((entry) => {
            wrap.appendChild(createWmsPopoverControl(entry));
        });

        td.appendChild(wrap);
        return td;
    }

    function buildWmsBaseEntriesForRow(row) {
        const out = [];
        const twoShkRows = Array.isArray(row?.wmsTwoShk) ? row.wmsTwoShk : [];
        if (twoShkRows.length) {
            const latestByType = new Map();
            twoShkRows.forEach((item) => {
                const eventType = String(item?.eventType || EVENT_TWO_SHK);
                const prev = latestByType.get(eventType);
                if (!prev || compareDateTs(item?.ts, prev?.ts) > 0) {
                    latestByType.set(eventType, item);
                }
            });

            [EVENT_TWO_SHK, EVENT_EMPTY_PACK].forEach((eventType) => {
                const match = latestByType.get(eventType);
                if (!match) return;
                out.push({
                    kind: "two_shk",
                    label: eventType === EVENT_EMPTY_PACK ? EVENT_EMPTY_PACK : "2 ШК",
                    eventType: eventType,
                    dateText: formatDateTimeMsk(match.dateValue),
                    otherShk: match.otherShk,
                    shk1: match.shk1,
                    shk2: match.shk2,
                    mediaLinks: match.mediaLinks
                });
            });
        }

        const nmRows = Array.isArray(row?.wmsNmRep) ? row.wmsNmRep : [];
        if (nmRows.length) {
            const latest = nmRows[0];
            const sameShk = isSameShkAcceptance(row, latest);
            out.push({
                kind: "nm_rep",
                label: sameShk ? "Обнаружен без ШК" : "Оприход",
                dateText: formatDateTimeMsk(latest?.dateValue),
                emp: latest?.emp,
                empName: latest?.empName,
                assignedShk: latest?.assignedShk,
                sameShk
            });
        }

        const requestLinks = getRowRequestLinks(row);
        if (requestLinks.length) {
            const shk = normalizeShk(row?.shk);
            const dateLost = normalizeDateIsoValue(row?.dateLost || row?.date_lost || row?.raw?.date_lost);
            out.push({
                kind: "request_links",
                label: "Запросы",
                shk,
                dateLost,
                requests: requestLinks.map((href, index) => ({
                    href,
                    label: compactLinkForUi(href),
                    tooltip: href,
                    requestIndex: index
                }))
            });
        }

        return out;
    }

    function createWmsPopoverControl(entry) {
        const wrap = document.createElement("div");
        wrap.className = "pure-wms-popover-wrap";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-outline pure-wms-btn";
        btn.textContent = String(entry?.label || "Подробнее");

        const popover = document.createElement("div");
        popover.className = "pure-wms-popover hidden";

        const title = document.createElement("div");
        title.className = "pure-wms-popover-title";
        title.textContent = String(entry?.label || "Детали");
        popover.appendChild(title);

        if (entry?.kind === "two_shk") {
            if (entry.eventType === EVENT_TWO_SHK) {
                appendWmsPopoverLinkLine(popover, "Второй ШК", entry.otherShk || "");
            } else {
                appendWmsPopoverLine(popover, "ШК 1", entry.shk1 || "—");
                appendWmsPopoverLine(popover, "ШК 2", entry.shk2 || "—");
            }

            appendWmsPopoverLine(popover, "Дата", entry.dateText || "—");

            const mediaWrap = document.createElement("div");
            mediaWrap.className = "pure-wms-popover-photos";

            const mediaLinks = Array.isArray(entry?.mediaLinks) ? entry.mediaLinks : [];
            if (!mediaLinks.length) {
                const empty = document.createElement("div");
                empty.className = "pure-wms-popover-muted";
                empty.textContent = "Фото: —";
                mediaWrap.appendChild(empty);
            } else {
                mediaLinks.forEach((href, index) => {
                    const a = document.createElement("a");
                    a.className = "btn btn-outline pure-wms-photo-btn";
                    a.textContent = `Фото ${index + 1}`;
                    a.href = href;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    mediaWrap.appendChild(a);
                });
            }
            popover.appendChild(mediaWrap);
        } else if (entry?.kind === "request_links") {
            const list = document.createElement("div");
            list.className = "pure-wms-request-list";

            const requests = Array.isArray(entry?.requests) ? entry.requests : [];
            if (!requests.length) {
                const empty = document.createElement("div");
                empty.className = "pure-wms-popover-muted";
                empty.textContent = "Ссылки: —";
                list.appendChild(empty);
            } else {
                requests.forEach((item) => {
                    const row = document.createElement("div");
                    row.className = "pure-wms-request-item";

                    const link = document.createElement("a");
                    link.className = "pure-wms-request-link";
                    link.href = String(item?.href || "");
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.textContent = String(item?.label || "Ссылка");
                    link.title = String(item?.tooltip || item?.href || "");

                    const deleteBtn = document.createElement("button");
                    deleteBtn.type = "button";
                    deleteBtn.className = "pure-wms-request-delete-btn";
                    deleteBtn.dataset.requestLinkDelete = "1";
                    deleteBtn.dataset.shk = normalizeShk(entry?.shk);
                    deleteBtn.dataset.dateLost = normalizeDateIsoValue(entry?.dateLost);
                    deleteBtn.dataset.requestIndex = Number.isFinite(Number(item?.requestIndex))
                        ? String(Number(item.requestIndex))
                        : "";
                    deleteBtn.setAttribute("aria-label", "Удалить ссылку запроса");
                    deleteBtn.title = "Удалить ссылку";
                    deleteBtn.textContent = "×";

                    row.append(link, deleteBtn);
                    list.appendChild(row);
                });
            }
            popover.appendChild(list);
        } else {
            appendWmsPopoverLine(popover, "Дата", entry?.dateText || "—");
            appendWmsPopoverLine(popover, "Кто", buildNmWhoText(entry) || "—");
            appendWmsPopoverLine(popover, "Присвоенный ШК", entry?.assignedShk || "—");
        }

        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleWmsPopover(popover);
        });

        wrap.append(btn, popover);
        return wrap;
    }

    function appendWmsPopoverLine(container, label, value) {
        const line = document.createElement("div");
        line.className = "pure-wms-popover-line";

        const key = document.createElement("span");
        key.className = "pure-wms-popover-key";
        key.textContent = `${String(label || "")}: `;

        const val = document.createElement("span");
        val.className = "pure-wms-popover-value";
        val.textContent = String(value || "—");

        line.append(key, val);
        container.appendChild(line);
    }

    function appendWmsPopoverLinkLine(container, label, shkValue) {
        const shk = normalizeShk(shkValue);
        if (!shk) {
            appendWmsPopoverLine(container, label, "—");
            return;
        }

        const line = document.createElement("div");
        line.className = "pure-wms-popover-line";

        const key = document.createElement("span");
        key.className = "pure-wms-popover-key";
        key.textContent = `${String(label || "")}: `;

        const link = document.createElement("a");
        link.className = "pure-wms-popover-value";
        link.href = `https://wms.wbwh.tech/shk/status/history?shk=${encodeURIComponent(shk)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = shk;
        link.style.textDecoration = "none";
        link.style.color = "inherit";

        line.append(key, link);
        container.appendChild(line);
    }

    function buildNmWhoText(entry) {
        const name = toText(entry?.empName);
        const emp = toText(entry?.emp);
        if (name && emp) return `${name} (${emp})`;
        return name || emp || "";
    }

    function toggleWmsPopover(popover) {
        if (!(popover instanceof HTMLElement)) return;
        const wasOpen = !popover.classList.contains("hidden");
        closeAllWmsPopovers();
        if (wasOpen) return;
        popover.classList.remove("hidden");
        tableState.activeWmsPopover = popover;
    }

    function closeAllWmsPopovers() {
        const active = tableState.activeWmsPopover;
        if (active instanceof HTMLElement) {
            active.classList.add("hidden");
        }
        tableState.activeWmsPopover = null;
    }

    async function handlePureTableBodyClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const requestDeleteBtn = target.closest("button[data-request-link-delete='1']");
        if (requestDeleteBtn instanceof HTMLButtonElement) {
            event.preventDefault();
            event.stopPropagation();
            await handleRequestLinkDeleteClick(requestDeleteBtn);
            return;
        }

        const optionBtn = target.closest("button[data-verdict-option='1']");
        if (optionBtn instanceof HTMLButtonElement) {
            event.preventDefault();
            event.stopPropagation();
            await handleVerdictOptionClick(optionBtn);
            return;
        }

        const toggleBtn = target.closest("button[data-verdict-toggle='1']");
        if (toggleBtn instanceof HTMLButtonElement) {
            event.preventDefault();
            event.stopPropagation();
            toggleVerdictPanel(toggleBtn);
        }
    }

    function isRequestLinkModalOpen() {
        return Boolean(pureRequestLinkModalEl && !pureRequestLinkModalEl.classList.contains("hidden"));
    }

    function setRequestLinkModalBusy(isBusy) {
        const next = Boolean(isBusy);
        if (pureRequestLinkInputEl) pureRequestLinkInputEl.disabled = next;
        if (pureRequestLinkSaveBtn) pureRequestLinkSaveBtn.disabled = next;
        if (pureRequestLinkCancelBtn) pureRequestLinkCancelBtn.disabled = next;
    }

    function openRequestLinkModalForRow(row, decisionValue, rowColorHint = "") {
        if (!pureRequestLinkModalEl || !pureRequestLinkInputEl) return;
        const shk = normalizeShk(row?.shk);
        if (!shk) return;
        closePureTableFilterPanels();
        closeAllWmsPopovers();

        const decision = extractDecisionValue(decisionValue) || VERDICT_REQUEST_REQUIRED;
        const rowColor = normalizeDecisionColor(rowColorHint)
            || normalizeDecisionColor(getDecisionOptionByValue(decision)?.rowColor)
            || "";
        const links = getRowRequestLinks(row);
        const dateLost = normalizeDateIsoValue(row?.dateLost || row?.date_lost || row?.raw?.date_lost);

        tableState.requestModalState = {
            shk,
            dateLost,
            decision,
            rowColor
        };

        pureRequestLinkInputEl.value = "";
        if (pureRequestLinkHintEl) {
            pureRequestLinkHintEl.textContent = links.length
                ? `Уже добавлено ссылок: ${links.length}`
                : "Добавьте ссылку запроса";
        }

        setRequestLinkModalBusy(false);
        pureRequestLinkModalEl.classList.remove("hidden");
        pureRequestLinkModalEl.setAttribute("aria-hidden", "false");

        window.setTimeout(() => {
            if (!pureRequestLinkInputEl) return;
            pureRequestLinkInputEl.focus();
            pureRequestLinkInputEl.select();
        }, 0);
    }

    function closeRequestLinkModal() {
        if (!pureRequestLinkModalEl) return;
        pureRequestLinkModalEl.classList.add("hidden");
        pureRequestLinkModalEl.setAttribute("aria-hidden", "true");
        if (pureRequestLinkInputEl) pureRequestLinkInputEl.value = "";
        if (pureRequestLinkHintEl) pureRequestLinkHintEl.textContent = "";
        tableState.requestModalState = {
            shk: "",
            dateLost: "",
            decision: "",
            rowColor: ""
        };
        setRequestLinkModalBusy(false);
    }

    function findPureTableRow(shkValue, dateLostValue = "") {
        const shk = normalizeShk(shkValue);
        if (!shk) return null;
        const dateLost = normalizeDateIsoValue(dateLostValue);
        return tableState.rows.find((item) => {
            const itemShk = normalizeShk(item?.shk);
            if (itemShk !== shk) return false;
            if (!dateLost) return true;
            return normalizeDateIsoValue(item?.dateLost || item?.date_lost || item?.raw?.date_lost) === dateLost;
        }) || null;
    }

    function findVerdictDropdownByShk(shkValue, dateLostValue = "") {
        const shk = normalizeShk(shkValue);
        if (!shk || !pureTableBody) return null;
        const dateLost = normalizeDateIsoValue(dateLostValue);
        const wraps = pureTableBody.querySelectorAll(".pure-row-verdict-dropdown");
        for (const wrap of wraps) {
            if (!(wrap instanceof HTMLElement)) continue;
            if (normalizeShk(wrap.dataset.shk) !== shk) continue;
            if (dateLost && normalizeDateIsoValue(wrap.dataset.dateLost) !== dateLost) continue;
            return wrap;
        }
        return null;
    }

    async function submitRequestLinkModal() {
        if (!isRequestLinkModalOpen()) return;
        const modalState = tableState.requestModalState || {};
        const shk = normalizeShk(modalState.shk);
        const dateLost = normalizeDateIsoValue(modalState.dateLost);
        const decision = extractDecisionValue(modalState.decision || VERDICT_REQUEST_REQUIRED);
        if (!shk || !decision) return;

        const row = findPureTableRow(shk, dateLost);
        if (!row) {
            closeRequestLinkModal();
            return;
        }

        const link = toText(pureRequestLinkInputEl?.value);
        if (!link) {
            setPureTableInlineStatus("Введите ссылку запроса", "error");
            window.MiniUI?.toast?.("Введите ссылку запроса", { type: "error" });
            pureRequestLinkInputEl?.focus();
            return;
        }

        const nextRequestLinks = dedupeRequestLinks(getRowRequestLinks(row).concat([link]));
        const wrap = findVerdictDropdownByShk(shk, dateLost);

        setRequestLinkModalBusy(true);
        const saved = await applyVerdictSelection(row, decision, {
            wrap,
            rowColorHint: modalState.rowColor || "",
            updateRequestLinks: true,
            nextRequestLinks
        });
        if (saved) {
            closeRequestLinkModal();
            return;
        }
        setRequestLinkModalBusy(false);
    }

    async function handleRequestLinkDeleteClick(deleteBtn) {
        const shk = normalizeShk(deleteBtn.dataset.shk);
        const dateLost = normalizeDateIsoValue(deleteBtn.dataset.dateLost);
        const requestIndex = toIntegerOrNull(deleteBtn.dataset.requestIndex);
        if (!shk || requestIndex === null || requestIndex < 0) return;

        const row = findPureTableRow(shk, dateLost);
        if (!row) return;

        const currentLinks = getRowRequestLinks(row);
        if (requestIndex >= currentLinks.length) return;

        const targetLink = currentLinks[requestIndex];
        if (!targetLink) return;

        const confirmMessage = `Удалить ссылку запроса?\n${targetLink}`;
        const isApproved = typeof window.MiniUI?.confirm === "function"
            ? await window.MiniUI.confirm(confirmMessage, { okText: "Удалить", cancelText: "Отмена" })
            : window.confirm(confirmMessage);
        if (!isApproved) return;

        const nextLinks = currentLinks.filter((_, index) => index !== requestIndex);
        await updateRequestLinksForRow(row, nextLinks, { clearRequestDecisionWhenEmpty: true });
    }

    function toggleVerdictPanel(toggleBtn) {
        const wrap = toggleBtn.closest(".pure-row-verdict-dropdown");
        if (!wrap) return;
        const panel = wrap.querySelector(".pure-row-verdict-panel");
        if (!(panel instanceof HTMLElement)) return;

        const alreadyOpen = !panel.classList.contains("hidden");
        closeActiveVerdictPanel();
        if (alreadyOpen) return;

        panel.classList.remove("hidden");
        toggleBtn.setAttribute("aria-expanded", "true");
        tableState.activeVerdictPanel = panel;
    }

    function closeActiveVerdictPanel() {
        const panel = tableState.activeVerdictPanel;
        if (!(panel instanceof HTMLElement)) {
            tableState.activeVerdictPanel = null;
            return;
        }

        panel.classList.add("hidden");
        const wrap = panel.closest(".pure-row-verdict-dropdown");
        const btn = wrap?.querySelector("button[data-verdict-toggle='1']");
        if (btn instanceof HTMLButtonElement) {
            btn.setAttribute("aria-expanded", "false");
        }
        tableState.activeVerdictPanel = null;
    }

    async function handleVerdictOptionClick(optionBtn) {
        const shk = normalizeShk(optionBtn.dataset.shk);
        const dateLost = normalizeDateIsoValue(optionBtn.dataset.dateLost);
        const nextValue = extractDecisionValue(optionBtn.dataset.value);
        if (!shk) return;

        const wrap = optionBtn.closest(".pure-row-verdict-dropdown");
        const row = findPureTableRow(shk, dateLost);
        if (!row) return;

        if (isRequestLinkRequiredDecision(nextValue)) {
            closeActiveVerdictPanel();
            openRequestLinkModalForRow(row, nextValue, optionBtn.dataset.rowColor || "");
            setPureTableInlineStatus("Введите ссылку запроса", "info");
            return;
        }

        const previousValue = extractDecisionValue(row.decision);
        if (nextValue === previousValue) {
            closeActiveVerdictPanel();
            return;
        }

        await applyVerdictSelection(row, nextValue, {
            wrap,
            rowColorHint: optionBtn.dataset.rowColor || ""
        });
    }

    async function applyVerdictSelection(row, nextValue, options = {}) {
        const shk = normalizeShk(row?.shk);
        const dateLost = normalizeDateIsoValue(row?.dateLost || row?.date_lost || row?.raw?.date_lost);
        const rowIdentityKey = buildShkDateKey(shk, dateLost);
        if (!shk) return false;
        if (isAutoFoundLockedRow(row)) {
            setPureTableInlineStatus("Вердикт этой строки недоступен для редактирования", "info");
            return false;
        }
        const {
            wrap = null,
            rowColorHint = "",
            updateRequestLinks = false,
            nextRequestLinks = null
        } = options;

        const requiresRequestLink = isRequestLinkRequiredDecision(nextValue);
        const normalizedRequestLinks = updateRequestLinks
            ? dedupeRequestLinks(nextRequestLinks)
            : getRowRequestLinks(row);
        if (requiresRequestLink && !normalizedRequestLinks.length) {
            setPureTableInlineStatus("Введите ссылку запроса", "error");
            window.MiniUI?.toast?.("Введите ссылку запроса", { type: "error" });
            return false;
        }

        const patch = {
            [tableState.updateColumnMap.decision]: nextValue || null
        };
        if (nextValue) {
            patch[tableState.updateColumnMap.emp] = resolveCurrentUserId(user);
            patch[tableState.updateColumnMap.solved] = resolveCurrentTimestamp();
        } else {
            patch[tableState.updateColumnMap.emp] = null;
            patch[tableState.updateColumnMap.solved] = null;
        }
        if (updateRequestLinks) {
            patch[tableState.updateColumnMap.requestLink] = serializeRequestLinks(normalizedRequestLinks);
        }

        const prevDecisionRaw = row.raw?.[tableState.updateColumnMap.decision];
        const prevEmpRaw = row.raw?.[tableState.updateColumnMap.emp];
        const prevSolvedRaw = row.raw?.[tableState.updateColumnMap.solved];
        const prevRequestLinkRaw = row.raw?.[tableState.updateColumnMap.requestLink];
        const prevDecision = row.decision;
        const prevRequestLinks = getRowRequestLinks(row);
        const prevRequestLink = row.requestLink;
        const prevAnimateFlag = Boolean(row.animateDecisionFill);
        const prevAnimateColor = row.animateDecisionFillColor;
        const prevForceVisibleUntilTs = Number(row.forceVisibleUntilTs || 0);

        const saveToken = ++tableState.verdictSaveSeq;
        tableState.pendingVerdictSaveByShk.set(rowIdentityKey, saveToken);

        setVerdictDropdownBusy(wrap, true);
        closeActiveVerdictPanel();
        setPureTableInlineStatus("Сохраняем изменения", "loading");

        row.raw[tableState.updateColumnMap.decision] = patch[tableState.updateColumnMap.decision];
        row.raw[tableState.updateColumnMap.emp] = patch[tableState.updateColumnMap.emp];
        row.raw[tableState.updateColumnMap.solved] = patch[tableState.updateColumnMap.solved];
        if (updateRequestLinks) {
            row.raw[tableState.updateColumnMap.requestLink] = patch[tableState.updateColumnMap.requestLink];
            row.requestLinks = normalizedRequestLinks;
            row.requestLink = normalizedRequestLinks[0] || "";
        }
        row.decision = nextValue;
        row.animateDecisionFill = true;
        row.animateDecisionFillColor = normalizeDecisionColor(rowColorHint)
            || getDecisionOptionByValue(nextValue)?.rowColor
            || "";
        const shouldKeepVisible = tableState.onlyUnresolved && Boolean(nextValue);
        row.forceVisibleUntilTs = shouldKeepVisible
            ? Date.now() + ROW_FILL_ANIMATION_TOTAL_MS
            : 0;
        applyPureTableFiltersAndRender();
        if (shouldKeepVisible) {
            window.setTimeout(() => {
                const pendingToken = tableState.pendingVerdictSaveByShk.get(rowIdentityKey);
                if (pendingToken && pendingToken !== saveToken) return;
                const rowRef = findPureTableRow(shk, dateLost);
                if (!rowRef) return;
                rowRef.forceVisibleUntilTs = 0;
                applyPureTableFiltersAndRender();
            }, ROW_FILL_ANIMATION_TOTAL_MS + 20);
        }

        try {
            const appliedPatch = await updatePureRowFields(shk, userWhId, patch, dateLost);
            if (tableState.pendingVerdictSaveByShk.get(rowIdentityKey) !== saveToken) return false;
            Object.assign(row.raw, appliedPatch);
            row.decision = extractDecisionValue(readEditableColumnValue(row.raw, tableState.updateColumnMap.decision));
            row.requestLinks = parseRequestLinks(readEditableColumnValue(row.raw, tableState.updateColumnMap.requestLink));
            row.requestLink = row.requestLinks[0] || "";
            setPureTableInlineStatus("Изменения сохранены", "success");
            applyPureTableFiltersAndRender();
            return true;
        } catch (error) {
            if (tableState.pendingVerdictSaveByShk.get(rowIdentityKey) !== saveToken) return false;
            row.raw[tableState.updateColumnMap.decision] = prevDecisionRaw ?? null;
            row.raw[tableState.updateColumnMap.emp] = prevEmpRaw ?? null;
            row.raw[tableState.updateColumnMap.solved] = prevSolvedRaw ?? null;
            if (updateRequestLinks) {
                row.raw[tableState.updateColumnMap.requestLink] = prevRequestLinkRaw ?? null;
                row.requestLinks = prevRequestLinks;
                row.requestLink = prevRequestLink;
            }
            row.decision = prevDecision;
            row.animateDecisionFill = prevAnimateFlag;
            row.animateDecisionFillColor = prevAnimateColor;
            row.forceVisibleUntilTs = prevForceVisibleUntilTs;
            applyPureTableFiltersAndRender();
            const message = String(error?.message || error || "Не удалось сохранить изменения.");
            setPureTableInlineStatus(message, "error");
            window.MiniUI?.toast?.("Ошибка сохранения строки", { type: "error" });
            return false;
        } finally {
            if (tableState.pendingVerdictSaveByShk.get(rowIdentityKey) === saveToken) {
                tableState.pendingVerdictSaveByShk.delete(rowIdentityKey);
            }
            setVerdictDropdownBusy(wrap, false);
        }
    }

    async function updateRequestLinksForRow(row, nextRequestLinks, options = {}) {
        const shk = normalizeShk(row?.shk);
        const dateLost = normalizeDateIsoValue(row?.dateLost || row?.date_lost || row?.raw?.date_lost);
        const rowIdentityKey = buildShkDateKey(shk, dateLost);
        if (!shk) return false;

        const clearRequestDecisionWhenEmpty = options.clearRequestDecisionWhenEmpty !== false;
        const wrap = options.wrap || findVerdictDropdownByShk(shk, dateLost);
        const normalizedLinks = dedupeRequestLinks(nextRequestLinks);
        const serializedLinks = serializeRequestLinks(normalizedLinks);
        const shouldClearDecision = clearRequestDecisionWhenEmpty
            && !normalizedLinks.length
            && isRequestLinkRequiredDecision(row?.decision);
        const patch = {
            [tableState.updateColumnMap.requestLink]: serializedLinks
        };
        if (shouldClearDecision) {
            patch[tableState.updateColumnMap.decision] = null;
            patch[tableState.updateColumnMap.emp] = null;
            patch[tableState.updateColumnMap.solved] = null;
        }

        const prevRaw = row.raw?.[tableState.updateColumnMap.requestLink];
        const prevLinks = getRowRequestLinks(row);
        const prevRequestLink = row.requestLink;
        const prevDecisionRaw = row.raw?.[tableState.updateColumnMap.decision];
        const prevEmpRaw = row.raw?.[tableState.updateColumnMap.emp];
        const prevSolvedRaw = row.raw?.[tableState.updateColumnMap.solved];
        const prevDecision = row.decision;

        const saveToken = ++tableState.requestLinkSaveSeq;
        tableState.pendingRequestLinkSaveByShk.set(rowIdentityKey, saveToken);

        setVerdictDropdownBusy(wrap, true);
        setPureTableInlineStatus("Сохраняем изменения", "loading");

        row.raw[tableState.updateColumnMap.requestLink] = serializedLinks;
        row.requestLinks = normalizedLinks;
        row.requestLink = normalizedLinks[0] || "";
        if (shouldClearDecision) {
            row.raw[tableState.updateColumnMap.decision] = null;
            row.raw[tableState.updateColumnMap.emp] = null;
            row.raw[tableState.updateColumnMap.solved] = null;
            row.decision = "";
        }
        applyPureTableFiltersAndRender();

        try {
            const appliedPatch = await updatePureRowFields(shk, userWhId, patch, dateLost);
            if (tableState.pendingRequestLinkSaveByShk.get(rowIdentityKey) !== saveToken) return false;
            Object.assign(row.raw, appliedPatch);
            row.requestLinks = parseRequestLinks(readEditableColumnValue(row.raw, tableState.updateColumnMap.requestLink));
            row.requestLink = row.requestLinks[0] || "";
            row.decision = extractDecisionValue(readEditableColumnValue(row.raw, tableState.updateColumnMap.decision));
            setPureTableInlineStatus("Изменения сохранены", "success");
            applyPureTableFiltersAndRender();
            return true;
        } catch (error) {
            if (tableState.pendingRequestLinkSaveByShk.get(rowIdentityKey) !== saveToken) return false;
            row.raw[tableState.updateColumnMap.requestLink] = prevRaw ?? null;
            row.requestLinks = prevLinks;
            row.requestLink = prevRequestLink;
            row.raw[tableState.updateColumnMap.decision] = prevDecisionRaw ?? null;
            row.raw[tableState.updateColumnMap.emp] = prevEmpRaw ?? null;
            row.raw[tableState.updateColumnMap.solved] = prevSolvedRaw ?? null;
            row.decision = prevDecision;
            applyPureTableFiltersAndRender();
            const message = String(error?.message || error || "Не удалось сохранить ссылку.");
            setPureTableInlineStatus(message, "error");
            window.MiniUI?.toast?.("Ошибка сохранения ссылки", { type: "error" });
            return false;
        } finally {
            if (tableState.pendingRequestLinkSaveByShk.get(rowIdentityKey) === saveToken) {
                tableState.pendingRequestLinkSaveByShk.delete(rowIdentityKey);
            }
            setVerdictDropdownBusy(wrap, false);
        }
    }

    function setVerdictDropdownBusy(wrap, isBusy) {
        if (!(wrap instanceof Element)) return;
        wrap.querySelectorAll("button, input").forEach((node) => {
            if (node instanceof HTMLButtonElement || node instanceof HTMLInputElement) {
                node.disabled = Boolean(isBusy);
            }
        });
        if (isBusy) wrap.classList.add("is-saving");
        else wrap.classList.remove("is-saving");
    }

    function createSubjectCell(nm, name, brand) {
        const td = document.createElement("td");
        td.className = "pure-wrap-cell pure-col-subject";

        const nmLine = document.createElement("div");
        nmLine.className = "pure-subject-nm";
        nmLine.textContent = nm === null || nm === undefined || nm === ""
            ? "—"
            : String(nm);
        td.appendChild(nmLine);

        const main = document.createElement("div");
        main.className = "pure-name-main";
        main.textContent = name ? String(name) : "—";
        td.appendChild(main);

        const sub = document.createElement("div");
        sub.className = "pure-brand-sub";
        sub.textContent = brand ? String(brand) : "—";
        td.appendChild(sub);

        return td;
    }

    function createPriceCell(priceValue) {
        const td = document.createElement("td");
        td.className = "pure-price-cell";

        const num = toNumberOrNull(priceValue);
        if (num === null) {
            td.textContent = "—";
            return td;
        }

        td.textContent = formatPriceForUi(num);
        const visual = getPriceVisual(num);
        td.style.setProperty("background-color", visual.background, "important");
        td.style.setProperty("color", visual.color, "important");
        return td;
    }

    function createGapCell() {
        const td = document.createElement("td");
        td.className = "pure-gap-col";
        td.textContent = "";
        return td;
    }

    async function handlePureTableInputBlur(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.classList.contains("pure-edit-input")) return;

        const shk = normalizeShk(target.dataset.shk);
        const dateLost = normalizeDateIsoValue(target.dataset.dateLost);
        const field = target.dataset.field;
        if (!shk || !field) return;

        const row = findPureTableRow(shk, dateLost);
        if (!row) return;
        if (isAutoFoundLockedRow(row)) {
            target.value = row.comment;
            target.disabled = true;
            return;
        }

        const previousValue = field === "decision" ? extractDecisionValue(row.decision) : row.comment;
        const nextValue = String(target.value || "").trim();
        if (nextValue === previousValue) return;

        const patch = {};
        if (field === "decision") {
            patch[tableState.updateColumnMap.decision] = nextValue || null;
            if (nextValue) {
                patch[tableState.updateColumnMap.emp] = resolveCurrentUserId(user);
                patch[tableState.updateColumnMap.solved] = resolveCurrentTimestamp();
            } else {
                patch[tableState.updateColumnMap.emp] = null;
                patch[tableState.updateColumnMap.solved] = null;
            }
        } else if (field === "comment") {
            patch[tableState.updateColumnMap.comment] = nextValue || null;
        } else {
            return;
        }

        target.disabled = true;
        setPureTableInlineStatus("Сохраняем изменения", "loading");

        try {
            const appliedPatch = await updatePureRowFields(shk, userWhId, patch, normalizeDateIsoValue(row?.dateLost));
            Object.assign(row.raw, appliedPatch);
            row.decision = extractDecisionValue(readEditableColumnValue(row.raw, tableState.updateColumnMap.decision));
            row.comment = toText(readEditableColumnValue(row.raw, tableState.updateColumnMap.comment));

            target.value = field === "decision" ? row.decision : row.comment;
            setPureTableInlineStatus("Изменения сохранены", "success");
            applyPureTableFiltersAndRender();
        } catch (error) {
            target.value = previousValue;
            const message = String(error?.message || error || "Не удалось сохранить изменения.");
            setPureTableInlineStatus(message, "error");
            window.MiniUI?.toast?.("Ошибка сохранения строки", { type: "error" });
        } finally {
            target.disabled = false;
        }
    }

    async function updatePureRowFields(shk, currentUserWhId, patch, dateLostValue = "") {
        const sanitized = sanitizeUpdatePatch(patch);
        if (!Object.keys(sanitized).length) {
            throw new Error("В таблице отсутствуют поля для сохранения.");
        }

        let query = supabaseClient
            .from(TABLE_PURE)
            .update(sanitized)
            .eq("shk", shk)
            .eq("wh_id", currentUserWhId);

        const dateLost = normalizeDateIsoValue(dateLostValue);
        if (dateLost) {
            query = query.eq("date_lost", dateLost);
        }

        const { error } = await query;

        if (!error) return sanitized;

        const missingColumn = extractMissingColumnName(error);
        if (missingColumn && Object.prototype.hasOwnProperty.call(sanitized, missingColumn)) {
            tableState.unsupportedUpdateColumns.add(missingColumn);
            return updatePureRowFields(shk, currentUserWhId, patch, dateLostValue);
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Ошибка обновления строки ${shk}: ${errorText}`);
    }

    function sanitizeUpdatePatch(patch) {
        const out = {};
        Object.entries(patch || {}).forEach(([key, value]) => {
            if (!key) return;
            if (tableState.unsupportedUpdateColumns.has(key)) return;
            out[key] = value;
        });
        return out;
    }

    function isAutoFoundLockedRow(row) {
        const empRaw = readEditableColumnValue(row?.raw, tableState.updateColumnMap.emp);
        const emp = normalizeToken(empRaw);
        return emp === AUTO_FOUND_EMP_ID;
    }

    function resolveCurrentUserId(currentUser) {
        const userId = currentUser?.id ?? currentUser?.user_id ?? null;
        if (userId === null || userId === undefined || userId === "") return null;
        return String(userId);
    }

    function resolveCurrentTimestamp() {
        if (typeof window.MiniUI?.nowIsoPlus3 === "function") {
            return window.MiniUI.nowIsoPlus3();
        }
        return new Date().toISOString();
    }

    function setPureTableInlineStatus(message, type) {
        if (!pureTableInlineStatusEl) return;
        const text = String(message || "").trim();
        const statusType = String(type || "").toLowerCase();
        pureTableInlineStatusEl.innerHTML = "";

        if (statusType === "loading") {
            if (text) {
                const textEl = document.createElement("span");
                textEl.className = "pure-inline-status-text";
                textEl.textContent = text;
                pureTableInlineStatusEl.appendChild(textEl);
            }
            const loader = document.createElement("span");
            loader.className = "pure-inline-loader";
            const bar = document.createElement("span");
            bar.className = "pure-inline-loader-bar";
            loader.appendChild(bar);
            pureTableInlineStatusEl.appendChild(loader);
            pureTableInlineStatusEl.style.color = "#64748b";
            return;
        }

        if (text) {
            const textEl = document.createElement("span");
            textEl.className = "pure-inline-status-text";
            textEl.textContent = text;
            pureTableInlineStatusEl.appendChild(textEl);
        }

        pureTableInlineStatusEl.style.color = statusType === "error"
            ? "#b91c1c"
            : statusType === "success"
                ? "#15803d"
                : "#64748b";
    }

    function sortPureRows(rows) {
        const safeRows = Array.isArray(rows) ? rows.slice() : [];
        const key = tableState.sortKey;
        const dir = tableState.sortDir === -1 ? -1 : 1;

        safeRows.sort((a, b) => {
            const cmp = comparePureRowsByKey(a, b, key);
            if (cmp !== 0) return cmp * dir;
            return sortMixedNumericStrings(a?.shk, b?.shk);
        });
        return safeRows;
    }

    function comparePureRowsByKey(a, b, key) {
        switch (key) {
            case "shk":
                return sortMixedNumericStrings(a?.shk, b?.shk);
            case "subject":
                return compareNullableNumbers(a?.nm, b?.nm, 0)
                    || compareStrings(a?.description, b?.description)
                    || compareStrings(a?.brand, b?.brand);
            case "shkStateBeforeLost":
                return compareStrings(a?.shkStateBeforeLost, b?.shkStateBeforeLost);
            case "dateLost":
                return compareNullableDates(a?.dateLost, b?.dateLost);
            case "lr":
                return sortMixedNumericStrings(a?.lr, b?.lr);
            case "price":
                return compareNullableNumbers(a?.price, b?.price, 0);
            case "decision":
                return compareStrings(extractDecisionValue(a?.decision), extractDecisionValue(b?.decision));
            case "comment":
                return compareStrings(a?.comment, b?.comment);
            default:
                return 0;
        }
    }

    function compareNullableNumbers(left, right, fallback) {
        const l = toNumberOrNull(left);
        const r = toNumberOrNull(right);
        if (l !== null && r !== null) {
            if (l === r) return 0;
            return l > r ? 1 : -1;
        }
        if (l !== null) return -1;
        if (r !== null) return 1;
        return fallback || 0;
    }

    function compareNullableDates(left, right) {
        const l = parseDateValue(left);
        const r = parseDateValue(right);
        if (l && r) {
            const lTs = l.getTime();
            const rTs = r.getTime();
            if (lTs === rTs) return 0;
            return lTs > rTs ? 1 : -1;
        }
        if (l) return -1;
        if (r) return 1;
        return compareStrings(left, right);
    }

    function compareStrings(left, right) {
        const l = String(left || "").toLowerCase();
        const r = String(right || "").toLowerCase();
        return l.localeCompare(r, "ru");
    }

    function updatePureTableSortIndicators() {
        if (!pureTableHead) return;
        pureTableHead.querySelectorAll("th[data-sort-key]").forEach((th) => {
            const key = th.getAttribute("data-sort-key");
            const indicator = th.querySelector(".pure-sort-indicator");
            if (!indicator) return;

            if (key === tableState.sortKey) {
                indicator.textContent = tableState.sortDir === -1 ? "▼" : "▲";
                return;
            }
            indicator.textContent = "";
        });
    }

    function getPriceVisual(price) {
        const stops = [
            { value: 0, color: "#c8f3d3" },
            { value: 200, color: "#c8f3d3" },
            { value: 500, color: "#ffe9a3" },
            { value: 4000, color: "#ffb0a6" },
            { value: 10000, color: "#d9868d" }
        ];

        const clamped = Math.max(0, Number(price) || 0);
        if (clamped >= stops[stops.length - 1].value) {
            const rgb = hexToRgb(stops[stops.length - 1].color);
            return {
                background: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                color: pickContrastColor(rgb)
            };
        }

        for (let i = 0; i < stops.length - 1; i += 1) {
            const from = stops[i];
            const to = stops[i + 1];
            if (clamped < from.value || clamped > to.value) continue;

            const ratio = to.value === from.value
                ? 0
                : (clamped - from.value) / (to.value - from.value);

            const rgbFrom = hexToRgb(from.color);
            const rgbTo = hexToRgb(to.color);
            const mixed = {
                r: Math.round(rgbFrom.r + (rgbTo.r - rgbFrom.r) * ratio),
                g: Math.round(rgbFrom.g + (rgbTo.g - rgbFrom.g) * ratio),
                b: Math.round(rgbFrom.b + (rgbTo.b - rgbFrom.b) * ratio)
            };
            return {
                background: `rgb(${mixed.r}, ${mixed.g}, ${mixed.b})`,
                color: pickContrastColor(mixed)
            };
        }

        const rgb = hexToRgb(stops[0].color);
        return {
            background: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
            color: pickContrastColor(rgb)
        };
    }

    function hexToRgb(hex) {
        const clean = String(hex || "").replace("#", "").trim();
        const normalized = clean.length === 3
            ? clean.split("").map((part) => part + part).join("")
            : clean;
        const num = parseInt(normalized, 16);
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    }

    function pickContrastColor(rgb) {
        const r = Number(rgb?.r || 0);
        const g = Number(rgb?.g || 0);
        const b = Number(rgb?.b || 0);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.58 ? "#ffffff" : "#111827";
    }

    async function refreshLastUploadedDate(currentUserWhId) {
        if (!lastUploadDateEl) return;

        if (!currentUserWhId || typeof supabaseClient === "undefined" || !supabaseClient) {
            lastUploadDateEl.textContent = "Последняя выгруженная дата: —";
            return;
        }

        try {
            const { data, error } = await supabaseClient
                .from(TABLE_PURE)
                .select("date_lost")
                .eq("wh_id", currentUserWhId)
                .order("date_lost", { ascending: false })
                .limit(1);

            if (error) {
                lastUploadDateEl.textContent = "Последняя выгруженная дата: —";
                return;
            }

            const rawDate = Array.isArray(data) && data[0] ? data[0].date_lost : "";
            const formatted = formatDateForUi(rawDate);
            lastUploadDateEl.textContent = `Последняя выгруженная дата: ${formatted || "—"}`;
        } catch {
            lastUploadDateEl.textContent = "Последняя выгруженная дата: —";
        }
    }

    async function refreshMainDashboard(currentUserWhId) {
        if (!currentUserWhId || typeof supabaseClient === "undefined" || !supabaseClient) {
            renderMainStats([]);
            renderUploadCalendar([], createPureDeadlineConfig(null));
            renderMainDynamics([]);
            renderLeaders([], new Map());
            return;
        }

        try {
            const [rows, pureDeadlineConfig, employeeNameMap] = await Promise.all([
                fetchAllPureRowsForWh(currentUserWhId),
                loadPureDeadlineConfig(currentUserWhId).catch(() => createPureDeadlineConfig(null)),
                loadEmployeeNameMap(currentUserWhId).catch((error) => {
                    console.error("pure_losses employees load failed:", error);
                    return new Map();
                })
            ]);
            resolvePureTableUpdateColumns(rows);
            renderMainStats(rows);
            renderUploadCalendar(rows, pureDeadlineConfig);
            renderMainDynamics(rows);
            renderLeaders(rows, employeeNameMap);
        } catch (error) {
            console.error("pure_losses main dashboard load failed:", error);
            renderMainStats([]);
            renderUploadCalendar([], createPureDeadlineConfig(null));
            renderMainDynamics([]);
            renderLeaders([], new Map());
        }
    }

    async function loadPureDeadlineConfig(currentUserWhId) {
        const fetchRows = async (withWhFilter) => {
            let query = supabaseClient
                .from(TABLE_WH_DATA)
                .select("data, wh_id, data_type")
                .eq("data_type", DATA_TYPE_OPP_PURE_DEADLINES)
                .limit(300);

            if (withWhFilter && currentUserWhId) {
                query = query.eq("wh_id", currentUserWhId);
            }

            const { data, error } = await query;
            if (error) {
                const errorText = String(error?.message || error?.details || error?.code || "unknown");
                throw new Error(`Не удалось загрузить дедлайны pure: ${errorText}`);
            }
            return Array.isArray(data) ? data : [];
        };

        let scopedRows = [];
        try {
            scopedRows = await fetchRows(true);
        } catch (error) {
            console.error("pure_losses deadline scoped load failed:", error);
        }

        let offsetDays = extractPureDeadlineOffsetFromRows(scopedRows);
        if (offsetDays !== null) return createPureDeadlineConfig(offsetDays);

        try {
            const fallbackRows = await fetchRows(false);
            offsetDays = extractPureDeadlineOffsetFromRows(fallbackRows);
        } catch (error) {
            console.error("pure_losses deadline fallback load failed:", error);
        }

        return createPureDeadlineConfig(offsetDays);
    }

    async function loadEmployeeNameMap(currentUserWhId) {
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            return new Map();
        }

        const fetchRows = async (withWhFilter) => {
            let query = supabaseClient
                .from(TABLE_WH_DATA)
                .select("data, wh_id, data_type")
                .eq("data_type", DATA_TYPE_OPP_TABLE_EMPLOYEES)
                .limit(300);

            if (withWhFilter && currentUserWhId) {
                query = query.eq("wh_id", currentUserWhId);
            }

            const { data, error } = await query;
            if (error) {
                const errorText = String(error?.message || error?.details || error?.code || "unknown");
                throw new Error(`Не удалось загрузить справочник сотрудников: ${errorText}`);
            }
            return Array.isArray(data) ? data : [];
        };

        let scopedRows = [];
        try {
            scopedRows = await fetchRows(true);
        } catch (error) {
            console.error("pure_losses employees scoped load failed:", error);
        }

        const scopedMap = extractEmployeeNameMapFromRows(scopedRows);
        if (scopedMap.size) {
            await enrichEmployeeMapWithUsers(scopedMap);
            return scopedMap;
        }

        let fallbackRows = [];
        try {
            fallbackRows = await fetchRows(false);
        } catch (error) {
            console.error("pure_losses employees fallback load failed:", error);
        }

        const fallbackMap = extractEmployeeNameMapFromRows(fallbackRows);
        if (fallbackMap.size) {
            await enrichEmployeeMapWithUsers(fallbackMap);
        }
        return fallbackMap;
    }

    function extractEmployeeNameMapFromRows(rows) {
        const map = new Map();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const parsed = extractEmployeesFromData(row?.data);
            parsed.forEach((name, id) => {
                const idNorm = normalizeToken(id);
                const nameText = toText(name);
                if (!idNorm || !nameText) return;
                map.set(idNorm, nameText);
            });
        });
        return map;
    }

    function parseMaybeJson(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === "object") return value;

        const raw = toText(value);
        if (!raw) return null;

        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }

    function extractEmployeesFromData(rawData) {
        const result = new Map();
        const parsed = parseMaybeJson(rawData);

        const put = (idRaw, aliasRaw) => {
            const id = normalizeToken(idRaw);
            const alias = toText(aliasRaw);
            if (!id || !alias) return;
            result.set(id, alias);
        };

        const parsePairsObject = (obj) => {
            if (!obj || typeof obj !== "object") return;
            Object.keys(obj).forEach((idKey) => {
                const value = obj[idKey];
                if (value === null || value === undefined) return;
                if (typeof value === "string" || typeof value === "number") {
                    put(idKey, value);
                }
            });
        };

        if (parsed && typeof parsed === "object") {
            if (Array.isArray(parsed)) {
                parsed.forEach((item) => {
                    if (!item || typeof item !== "object") return;
                    put(
                        item.id ?? item.user_id ?? item.key,
                        item.alias ?? item.name ?? item.value ?? item.display_name
                    );
                });
            } else {
                if (Array.isArray(parsed.employees)) {
                    parsed.employees.forEach((item) => {
                        if (!item || typeof item !== "object") return;
                        put(
                            item.id ?? item.user_id ?? item.key,
                            item.alias ?? item.name ?? item.value ?? item.display_name
                        );
                    });
                }

                if (parsed.values && typeof parsed.values === "object") {
                    parsePairsObject(parsed.values);
                }

                parsePairsObject(parsed);
            }
        }

        const sourceText = typeof rawData === "string" ? rawData : "";
        const pairRegex = /["']?([A-Za-z0-9_-]+)["']?\s*:\s*["']([^"']+)["']/g;
        let match = null;
        while ((match = pairRegex.exec(sourceText)) !== null) {
            put(match[1], match[2]);
        }

        return result;
    }

    async function enrichEmployeeMapWithUsers(employeeMap) {
        if (!(employeeMap instanceof Map) || !employeeMap.size) return;
        if (typeof supabaseClient === "undefined" || !supabaseClient) return;

        const numericIds = Array.from(employeeMap.keys())
            .map((id) => normalizeToken(id))
            .filter((id) => /^-?\d+$/.test(id))
            .map((id) => Number(id));
        if (!numericIds.length) return;

        const { data, error } = await supabaseClient
            .from("users")
            .select("id, fio, name")
            .in("id", numericIds);

        if (error || !Array.isArray(data)) return;

        data.forEach((row) => {
            const id = normalizeToken(row?.id);
            if (!id) return;
            const displayName = toText(row?.fio || row?.name);
            if (!displayName) return;
            employeeMap.set(id, displayName);
        });
    }

    function extractPureDeadlineOffsetFromRows(rows) {
        const safeRows = Array.isArray(rows) ? rows : [];
        for (const row of safeRows) {
            const offset = extractPureDeadlineOffset(row?.data);
            if (offset !== null) return offset;
        }
        return null;
    }

    function extractPureDeadlineOffset(rawData) {
        if (rawData === null || rawData === undefined) return null;

        if (Array.isArray(rawData)) {
            for (const item of rawData) {
                const nested = extractPureDeadlineOffset(item);
                if (nested !== null) return nested;
            }
            return null;
        }

        if (typeof rawData === "object") {
            const obj = rawData;

            if (Array.isArray(obj.deadlines)) {
                for (const item of obj.deadlines) {
                    if (!item || typeof item !== "object") continue;
                    const key = normalizePureDeadlineKey(item.key ?? item.name ?? item.status ?? "");
                    if (key !== "pure") continue;
                    const value = parsePureDeadlineNumber(item.offset_days ?? item.offset ?? item.value);
                    if (value !== null) return value;
                }
            }

            const directPure = obj.pure ?? obj.Pure ?? obj.PURE;
            const directValue = parsePureDeadlineNumber(directPure);
            if (directValue !== null) return directValue;

            for (const [key, value] of Object.entries(obj)) {
                const normalizedKey = normalizePureDeadlineKey(key);
                if (normalizedKey === "pure") {
                    const parsed = parsePureDeadlineNumber(value);
                    if (parsed !== null) return parsed;
                    continue;
                }

                if (normalizedKey === "deadlines" || normalizedKey === "values" || normalizedKey === "config") {
                    const nested = extractPureDeadlineOffset(value);
                    if (nested !== null) return nested;
                }
            }
            return null;
        }

        const text = toText(rawData);
        if (!text) return null;

        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            try {
                const parsed = JSON.parse(text);
                const nested = extractPureDeadlineOffset(parsed);
                if (nested !== null) return nested;
            } catch (_) {
                // ignore JSON parsing error, fallback to regex
            }
        }

        const pairRegex = /["']?pure["']?\s*:\s*["']?(-?\d+(?:[.,]\d+)?)["']?/i;
        const match = text.match(pairRegex);
        if (match && match[1] !== undefined) {
            const parsed = parsePureDeadlineNumber(match[1]);
            if (parsed !== null) return parsed;
        }

        const lines = text.split(/[\r\n;]+/);
        for (const line of lines) {
            const normalizedLine = toText(line);
            if (!normalizedLine) continue;
            const lineMatch = normalizedLine.match(/^["']?pure["']?\s*[:=,]\s*["']?(-?\d+(?:[.,]\d+)?)["']?$/i);
            if (!lineMatch) continue;
            const parsed = parsePureDeadlineNumber(lineMatch[1]);
            if (parsed !== null) return parsed;
        }

        return null;
    }

    function parsePureDeadlineNumber(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);

        const text = String(value)
            .trim()
            .replace(/['"]/g, "")
            .replace(",", ".");
        if (!text) return null;

        const parsed = Number(text);
        if (!Number.isFinite(parsed)) return null;
        return Math.trunc(parsed);
    }

    function normalizePureDeadlineKey(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "")
            .replace(/['"]/g, "");
    }

    function createPureDeadlineConfig(offsetDays) {
        const parsedOffset = parsePureDeadlineNumber(offsetDays);
        if (parsedOffset === null) {
            return {
                offsetDays: null,
                cutoffDate: null,
                cutoffIso: ""
            };
        }

        const today = getDashboardTodayDate();
        const cutoffDate = addDays(today, parsedOffset);
        return {
            offsetDays: parsedOffset,
            cutoffDate,
            cutoffIso: formatIsoDate(cutoffDate)
        };
    }

    function normalizePureDeadlineConfig(config) {
        if (!config || typeof config !== "object") {
            return createPureDeadlineConfig(null);
        }
        return createPureDeadlineConfig(config.offsetDays);
    }

    function isDateAllowedByDeadline(dateValue, pureDeadlineConfig) {
        if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return false;
        const config = normalizePureDeadlineConfig(pureDeadlineConfig);
        if (!(config.cutoffDate instanceof Date)) return true;
        return compareDateTs(dateValue.getTime(), config.cutoffDate.getTime()) <= 0;
    }

    function isCalendarDateInDeadlineRange(dateValue, todayValue, pureDeadlineConfig) {
        if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return false;
        const today = todayValue instanceof Date ? todayValue : getDashboardTodayDate();
        if (compareDateTs(dateValue.getTime(), today.getTime()) > 0) return false;
        return isDateAllowedByDeadline(dateValue, pureDeadlineConfig);
    }

    function formatMonthForCalendar(dateValue) {
        const date = dateValue instanceof Date ? dateValue : getDashboardTodayDate();
        const text = new Intl.DateTimeFormat("ru-RU", {
            month: "long",
            year: "numeric"
        }).format(date);
        return text.replace(/\s*г\.?$/i, "").replace(/^./, (ch) => ch.toUpperCase());
    }

    function renderMainStats(rows) {
        const uniqueRows = dedupeRowsByShk(rows);
        const today = getDashboardTodayDate();
        const overallMetrics = calculateMainStatsMetrics(uniqueRows, today, "recent_30_days");
        setText(statTotalShkEl, formatInt(overallMetrics.totalShk));
        setText(statResolvedShkEl, formatInt(overallMetrics.resolvedShk));
        setText(statExpensiveTotalEl, formatInt(overallMetrics.expensiveTotal));
        setText(statExpensiveResolvedEl, formatInt(overallMetrics.expensiveResolved));
        setText(statPureBacklogEl, formatPercent(overallMetrics.backlogPercent));
        setText(statBalanceEl, formatLossBalance(overallMetrics.balanceAmount));

        const monthStats = resolveDashboardMonthStats(today);
        const monthRows = filterRowsByMonth(uniqueRows, monthStats);
        const monthMetrics = calculateMainStatsMetrics(monthRows, today, "subset");
        setText(statMonthTitleEl, `Статистика за ${monthStats.label}`);
        setText(statMonthTotalShkEl, formatInt(monthMetrics.totalShk));
        setText(statMonthResolvedShkEl, formatInt(monthMetrics.resolvedShk));
        setText(statMonthExpensiveTotalEl, formatInt(monthMetrics.expensiveTotal));
        setText(statMonthExpensiveResolvedEl, formatInt(monthMetrics.expensiveResolved));
        setText(statMonthPureBacklogEl, formatPercent(monthMetrics.backlogPercent));
        setText(statMonthBalanceEl, formatLossBalance(monthMetrics.balanceAmount));
        setText(statMonthDynamicsTitleEl, `Динамика списаний за ${monthStats.label}`);

        const previousMonthStats = shiftDashboardMonthStats(monthStats, -1);
        const previousMonthRows = filterRowsByMonth(uniqueRows, previousMonthStats);
        const previousMonthMetrics = calculateMainStatsMetrics(previousMonthRows, today, "subset");
        setText(statPrevMonthTitleEl, `Статистика за ${previousMonthStats.label}`);
        setText(statPrevMonthTotalShkEl, formatInt(previousMonthMetrics.totalShk));
        setText(statPrevMonthResolvedShkEl, formatInt(previousMonthMetrics.resolvedShk));
        setText(statPrevMonthExpensiveTotalEl, formatInt(previousMonthMetrics.expensiveTotal));
        setText(statPrevMonthExpensiveResolvedEl, formatInt(previousMonthMetrics.expensiveResolved));
        setText(statPrevMonthPureBacklogEl, formatPercent(previousMonthMetrics.backlogPercent));
        setText(statPrevMonthBalanceEl, formatLossBalance(previousMonthMetrics.balanceAmount));
        setText(statPrevMonthDynamicsTitleEl, `Динамика списаний за ${previousMonthStats.label}`);
    }

    function calculateMainStatsMetrics(rows, todayValue, backlogMode) {
        const safeRows = Array.isArray(rows) ? rows : [];
        const today = todayValue instanceof Date ? todayValue : getDashboardTodayDate();
        const periodStart = addDays(today, -29);

        let totalShk = 0;
        let resolvedShk = 0;
        let expensiveTotal = 0;
        let expensiveResolved = 0;
        let recentTotal = 0;
        let recentResolved = 0;
        let balanceAmount = 0;

        safeRows.forEach((row) => {
            totalShk += 1;
            const decision = extractDecisionValue(readEditableColumnValue(row, tableState.updateColumnMap.decision));
            const isResolved = Boolean(decision);
            if (isResolved) resolvedShk += 1;

            const price = toNumberOrNull(row?.price);
            if (price !== null) {
                balanceAmount += Math.abs(price);
            }
            const isExpensive = price !== null && price >= EXPENSIVE_PRICE_THRESHOLD;
            if (isExpensive) {
                expensiveTotal += 1;
                if (isResolved) expensiveResolved += 1;
            }

            if (backlogMode === "recent_30_days") {
                const dateLost = parseDateValue(row?.date_lost);
                const isInRecentWindow = Boolean(dateLost)
                    && compareDateTs(dateLost.getTime(), periodStart.getTime()) >= 0
                    && compareDateTs(dateLost.getTime(), today.getTime()) <= 0;
                if (isInRecentWindow) {
                    recentTotal += 1;
                    if (isResolved) recentResolved += 1;
                }
            }
        });

        const backlogSourceTotal = backlogMode === "recent_30_days" ? recentTotal : totalShk;
        const backlogSourceResolved = backlogMode === "recent_30_days" ? recentResolved : resolvedShk;
        const solvedPercent = backlogSourceTotal > 0 ? (backlogSourceResolved / backlogSourceTotal) * 100 : 0;
        const backlogPercent = backlogSourceTotal > 0 ? Math.max(0, 100 - solvedPercent) : 0;

        return {
            totalShk,
            resolvedShk,
            expensiveTotal,
            expensiveResolved,
            backlogPercent,
            balanceAmount
        };
    }

    function resolveDashboardMonthStats(todayValue) {
        const today = todayValue instanceof Date ? todayValue : getDashboardTodayDate();
        const isCurrentMonthWindow = today.getDate() >= 21;
        return createDashboardMonthStats(isCurrentMonthWindow
            ? new Date(today.getFullYear(), today.getMonth(), 1)
            : new Date(today.getFullYear(), today.getMonth() - 1, 1));
    }

    function createDashboardMonthStats(targetDate) {
        const target = targetDate instanceof Date
            ? new Date(targetDate.getFullYear(), targetDate.getMonth(), 1)
            : new Date();
        const monthLabelRaw = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(target);
        const label = monthLabelRaw ? monthLabelRaw[0].toUpperCase() + monthLabelRaw.slice(1) : "—";
        return {
            year: target.getFullYear(),
            monthIndex: target.getMonth(),
            label
        };
    }

    function shiftDashboardMonthStats(monthStats, offsetMonths) {
        const shift = Number.isFinite(Number(offsetMonths)) ? Number(offsetMonths) : 0;
        const target = new Date(Number(monthStats?.year || 0), Number(monthStats?.monthIndex || 0) + shift, 1);
        return createDashboardMonthStats(target);
    }

    function filterRowsByMonth(rows, monthStats) {
        const sourceRows = Array.isArray(rows) ? rows : [];
        return sourceRows.filter((row) => {
            const dateLost = parseDateValue(row?.date_lost);
            if (!dateLost) return false;
            return dateLost.getFullYear() === monthStats.year
                && dateLost.getMonth() === monthStats.monthIndex;
        });
    }

    function renderLeaders(rows, employeeNameMap) {
        if (!pureLeadersPeriodEl || !pureLeadersBodyEl || !pureLeadersEmptyEl) return;

        const today = getDashboardTodayDate();
        const period = getLeadersPeriod(today);
        pureLeadersPeriodEl.textContent = `Текущий период: ${formatDateForUi(period.start)} — ${formatDateForUi(period.end)}`;
        const displayMap = normalizeEmployeeDisplayMap(employeeNameMap);

        const counters = new Map();
        const sourceRows = Array.isArray(rows) ? rows : [];
        sourceRows.forEach((row) => {
            const decision = extractDecisionValue(readEditableColumnValue(row, tableState.updateColumnMap.decision));
            if (!decision) return;

            const empId = normalizeToken(readEditableColumnValue(row, tableState.updateColumnMap.emp));
            if (!empId) return;

            const solvedDate = parseDateValue(readEditableColumnValue(row, tableState.updateColumnMap.solved));
            if (!solvedDate) return;
            if (compareDateTs(solvedDate.getTime(), period.start.getTime()) < 0) return;
            if (compareDateTs(solvedDate.getTime(), period.end.getTime()) > 0) return;

            counters.set(empId, (counters.get(empId) || 0) + 1);
        });

        const leaderboard = Array.from(counters.entries())
            .map(([empId, count]) => ({ empId, count }))
            .sort((left, right) => {
                if (right.count !== left.count) return right.count - left.count;
                return sortMixedNumericStrings(left.empId, right.empId);
            });

        pureLeadersBodyEl.innerHTML = "";
        if (!leaderboard.length) {
            pureLeadersEmptyEl.hidden = false;
            return;
        }

        pureLeadersEmptyEl.hidden = true;
        const fragment = document.createDocumentFragment();

        leaderboard.forEach((item, index) => {
            const employeeName = resolveEmployeeDisplayName(item.empId, displayMap);
            const tr = document.createElement("tr");
            if (index === 0) tr.classList.add("pure-leaders-row-top1");
            tr.innerHTML = `
                <td class="pure-leaders-rank">${index + 1}</td>
                <td class="pure-leaders-emp">${escapeHtml(employeeName)}</td>
                <td class="pure-leaders-count">${formatInt(item.count)}</td>
            `;
            fragment.appendChild(tr);
        });

        pureLeadersBodyEl.appendChild(fragment);
    }

    function getLeadersPeriod(todayValue) {
        const today = todayValue instanceof Date ? todayValue : getDashboardTodayDate();
        const baseYear = today.getFullYear();
        const baseMonth = today.getMonth();
        const start = today.getDate() >= 20
            ? new Date(baseYear, baseMonth, 20)
            : new Date(baseYear, baseMonth - 1, 20);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 20);
        return { start, end };
    }

    function normalizeEmployeeDisplayMap(employeeNameMap) {
        const map = new Map();
        if (!(employeeNameMap instanceof Map)) return map;

        employeeNameMap.forEach((name, id) => {
            const idNorm = normalizeToken(id);
            const nameText = toText(name);
            if (!idNorm || !nameText) return;
            map.set(idNorm, nameText);
            const intId = toIntegerOrNull(idNorm);
            if (intId !== null) map.set(String(intId), nameText);
        });

        return map;
    }

    function resolveEmployeeDisplayName(empId, employeeDisplayMap) {
        const id = normalizeToken(empId);
        if (!id) return "—";
        if (employeeDisplayMap instanceof Map && employeeDisplayMap.has(id)) {
            return toText(employeeDisplayMap.get(id)) || id;
        }
        const intId = toIntegerOrNull(id);
        if (intId !== null && employeeDisplayMap instanceof Map) {
            const intKey = String(intId);
            if (employeeDisplayMap.has(intKey)) {
                return toText(employeeDisplayMap.get(intKey)) || intKey;
            }
        }
        return id;
    }

    function renderMainDynamics(rows) {
        const sourceRows = dedupeRowsByShk(rows);
        const today = getDashboardTodayDate();
        const monthStats = resolveDashboardMonthStats(today);
        const previousMonthStats = shiftDashboardMonthStats(monthStats, -1);

        const charts = [
            {
                chartKey: "overall",
                canvasEl: pureDynamicsChartCanvasEl,
                emptyEl: pureDynamicsChartEmptyEl,
                rows: sourceRows,
                dateKeys: buildDateRangeKeys(addDays(today, -29), today)
            },
            {
                chartKey: "month",
                canvasEl: pureMonthDynamicsChartCanvasEl,
                emptyEl: pureMonthDynamicsChartEmptyEl,
                rows: filterRowsByMonth(sourceRows, monthStats),
                dateKeys: buildDateRangeKeys(
                    new Date(monthStats.year, monthStats.monthIndex, 1),
                    getMonthChartRangeEnd(monthStats, today)
                )
            },
            {
                chartKey: "previousMonth",
                canvasEl: purePrevMonthDynamicsChartCanvasEl,
                emptyEl: purePrevMonthDynamicsChartEmptyEl,
                rows: filterRowsByMonth(sourceRows, previousMonthStats),
                dateKeys: buildDateRangeKeys(
                    new Date(previousMonthStats.year, previousMonthStats.monthIndex, 1),
                    getMonthChartRangeEnd(previousMonthStats, today)
                )
            }
        ];

        if (typeof window.Chart === "undefined") {
            charts.forEach((item) => {
                destroyDynamicsChart(item.chartKey);
                showDynamicsEmpty(item.emptyEl, "Не удалось загрузить модуль графика");
            });
            return;
        }

        charts.forEach((item) => {
            renderMainDynamicsChart(item);
        });
    }

    function renderMainDynamicsChart({ chartKey, canvasEl, emptyEl, rows, dateKeys }) {
        destroyDynamicsChart(chartKey);
        if (!(canvasEl instanceof HTMLCanvasElement)) return;

        const keys = Array.isArray(dateKeys) ? dateKeys : [];
        if (!keys.length) {
            showDynamicsEmpty(emptyEl, "Нет данных для отображения графика");
            return;
        }

        const byDate = new Map();
        keys.forEach((iso) => {
            byDate.set(iso, {
                total: 0,
                byLr: new Map()
            });
        });

        const sourceRows = Array.isArray(rows) ? rows : [];
        const lrSet = new Set();

        sourceRows.forEach((row) => {
            const date = parseDateValue(row?.date_lost);
            if (!date) return;

            const iso = formatIsoDate(date);
            if (!byDate.has(iso)) return;
            const bucket = byDate.get(iso);

            bucket.total += 1;
            const lr = toText(row?.lr);
            if (!lr) return;
            lrSet.add(lr);
            bucket.byLr.set(lr, (bucket.byLr.get(lr) || 0) + 1);
        });

        hideDynamicsEmpty(emptyEl);

        const labels = keys.map((iso) => formatDateForUi(iso));
        const lrKeys = Array.from(lrSet).sort(sortMixedNumericStrings);

        const datasets = [{
            label: "Общее кол-во списаний",
            data: keys.map((iso) => byDate.get(iso)?.total || 0),
            borderColor: "#0f172a",
            backgroundColor: "#0f172a",
            borderWidth: 1.6,
            borderDash: [8, 6],
            pointRadius: 1.8,
            pointHoverRadius: 3.2,
            pointHitRadius: 12,
            tension: 0.24
        }];

        lrKeys.forEach((lr, index) => {
            const color = DYNAMICS_LR_COLORS[index % DYNAMICS_LR_COLORS.length];
            datasets.push({
                label: `LR ${lr}`,
                data: keys.map((iso) => byDate.get(iso)?.byLr?.get(lr) || 0),
                borderColor: color,
                backgroundColor: color,
                borderWidth: 1.9,
                pointRadius: 1.9,
                pointHoverRadius: 3.6,
                tension: 0.3
            });
        });

        pureDynamicsCharts[chartKey] = new window.Chart(canvasEl, {
            type: "line",
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: "index",
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top"
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const index = Number(items?.[0]?.dataIndex);
                                if (!Number.isFinite(index)) return "";
                                const key = keys[index];
                                return formatDateForUi(key);
                            },
                            label: (ctx) => {
                                return `${ctx.dataset.label}: ${formatInt(ctx.parsed?.y || 0)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        },
                        title: {
                            display: true,
                            text: "Кол-во ШК"
                        }
                    },
                    x: {
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            maxTicksLimit: 14
                        }
                    }
                }
            }
        });
    }

    function destroyDynamicsChart(chartKey) {
        const key = toText(chartKey);
        if (!key || !(key in pureDynamicsCharts)) return;
        const chart = pureDynamicsCharts[key];
        if (!chart) return;
        chart.destroy();
        pureDynamicsCharts[key] = null;
    }

    function showDynamicsEmpty(emptyElement, message) {
        if (!(emptyElement instanceof HTMLElement)) return;
        emptyElement.textContent = message || "Нет данных для отображения графика";
        emptyElement.hidden = false;
    }

    function hideDynamicsEmpty(emptyElement) {
        if (!(emptyElement instanceof HTMLElement)) return;
        emptyElement.hidden = true;
    }

    function buildDateRangeKeys(startDateValue, endDateValue) {
        const startDate = startDateValue instanceof Date ? startDateValue : getDashboardTodayDate();
        const endDate = endDateValue instanceof Date ? endDateValue : startDate;
        const startTs = startDate.getTime();
        const endTs = endDate.getTime();

        if (compareDateTs(startTs, endTs) > 0) return [];

        const keys = [];
        let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

        while (compareDateTs(cursor.getTime(), end.getTime()) <= 0) {
            keys.push(formatIsoDate(cursor));
            cursor = addDays(cursor, 1);
        }

        return keys;
    }

    function getMonthChartRangeEnd(monthStats, todayValue) {
        const today = todayValue instanceof Date ? todayValue : getDashboardTodayDate();
        const monthLastDate = new Date(monthStats.year, monthStats.monthIndex + 1, 0);
        if (monthStats.year === today.getFullYear() && monthStats.monthIndex === today.getMonth()) {
            return new Date(today.getFullYear(), today.getMonth(), today.getDate());
        }
        return monthLastDate;
    }

    function renderUploadCalendar(rows, pureDeadlineConfig) {
        if (!uploadCalendarGridEl) return;
        uploadCalendarGridEl.innerHTML = "";

        const today = getDashboardTodayDate();
        const monday = getWeekStartMonday(today);
        const start = addDays(monday, -21);
        const uploadDates = new Set();
        const deadlineConfig = normalizePureDeadlineConfig(pureDeadlineConfig);

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const date = parseDateValue(row?.date_lost);
            if (!date) return;
            uploadDates.add(formatIsoDate(date));
        });

        const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
        dayNames.forEach((dayName) => {
            const head = document.createElement("div");
            head.className = "pure-upload-day-head";
            head.textContent = dayName;
            uploadCalendarGridEl.appendChild(head);
        });

        const todayIso = formatIsoDate(today);
        for (let i = 0; i < 35; i += 1) {
            const date = addDays(start, i);
            const iso = formatIsoDate(date);
            const hasUpload = uploadDates.has(iso);
            const shouldBeUploaded = isCalendarDateInDeadlineRange(date, today, deadlineConfig);
            const prevDate = i > 0 ? addDays(start, i - 1) : null;
            const isMonthSwitch = !prevDate || prevDate.getMonth() !== date.getMonth() || prevDate.getFullYear() !== date.getFullYear();

            if (isMonthSwitch) {
                const split = document.createElement("div");
                split.className = "pure-upload-month-split";
                split.textContent = formatMonthForCalendar(date);
                uploadCalendarGridEl.appendChild(split);

                const mondayWeekday = (date.getDay() + 6) % 7;
                for (let gapIndex = 0; gapIndex < mondayWeekday; gapIndex += 1) {
                    const gap = document.createElement("div");
                    gap.className = "pure-upload-day-gap";
                    uploadCalendarGridEl.appendChild(gap);
                }
            }

            const day = document.createElement("div");
            day.className = "pure-upload-day";
            if (!hasUpload && shouldBeUploaded) day.classList.add("is-missing");
            if (iso === todayIso) day.classList.add("is-today");
            if (date.getDate() === 20) day.classList.add("is-twentieth");
            day.textContent = String(date.getDate());
            if (hasUpload) {
                day.title = `${formatDateForUi(iso)} — есть выгрузка`;
            } else if (shouldBeUploaded) {
                day.title = `${formatDateForUi(iso)} — нет выгрузки`;
            } else {
                day.title = `${formatDateForUi(iso)} — вне срока выгрузки`;
            }
            uploadCalendarGridEl.appendChild(day);
        }
    }

    function dedupeRowsByShk(rows) {
        const out = [];
        const seen = new Set();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const shk = normalizeShk(row?.shk);
            const dateLost = normalizeDateIsoValue(row?.date_lost);
            const key = dateLost ? buildShkDateKey(shk, dateLost) : shk;
            if (!shk || seen.has(key)) return;
            seen.add(key);
            out.push(row);
        });
        return out;
    }

    function getDashboardTodayDate() {
        const todayIso = toText(window.MiniUI?.todayIsoDatePlus3?.());
        const parsed = parseDateValue(todayIso);
        if (parsed) return parsed;
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    function getWeekStartMonday(dateValue) {
        const base = dateValue instanceof Date
            ? new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate())
            : getDashboardTodayDate();
        const day = base.getDay();
        const diffToMonday = day === 0 ? -6 : 1 - day;
        return addDays(base, diffToMonday);
    }

    function addDays(dateValue, days) {
        const base = dateValue instanceof Date
            ? new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate())
            : getDashboardTodayDate();
        base.setDate(base.getDate() + Number(days || 0));
        return base;
    }

    function addMonths(dateValue, months) {
        const base = dateValue instanceof Date
            ? new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate())
            : getDashboardTodayDate();
        const shift = Number(months || 0);
        const targetMonthStart = new Date(base.getFullYear(), base.getMonth() + shift, 1);
        const targetMonthLastDay = new Date(
            targetMonthStart.getFullYear(),
            targetMonthStart.getMonth() + 1,
            0
        ).getDate();
        const targetDay = Math.min(base.getDate(), targetMonthLastDay);
        return new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), targetDay);
    }

    function setText(element, value) {
        if (!(element instanceof HTMLElement)) return;
        element.textContent = String(value ?? "—");
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

    function prepareIncomingRows(rows, currentUserWhId, autoLrSet, pureDeadlineConfig) {
        const rowsByKey = new Map();
        const postedRowsByKey = new Map();
        const stats = {
            skippedByWh: 0,
            skippedPostedFlag: 0,
            skippedByIsAuto: 0,
            skippedByDeadline: 0,
            skippedInvalid: 0,
            duplicateInFileIgnored: 0
        };

        for (const row of rows) {
            const normalizedRow = buildNormalizedRow(row);

            const whId = normalizeToken(getCellValue(row, normalizedRow, "wh_id"));
            if (!whId || whId !== currentUserWhId) {
                stats.skippedByWh += 1;
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

            const dateLost = formatIsoDate(dateObj);
            const rowKey = buildShkDateKey(shk, dateLost);
            const postedFlag = getCellValue(row, normalizedRow, "posted_flag");
            if (isTrueLike(postedFlag)) {
                stats.skippedPostedFlag += 1;
                rowsByKey.delete(rowKey);
                if (postedRowsByKey.has(rowKey)) {
                    stats.duplicateInFileIgnored += 1;
                    continue;
                }
                postedRowsByKey.set(rowKey, {
                    shk,
                    wh_id: whId,
                    date_lost: dateLost
                });
                continue;
            }

            if (!isDateAllowedByDeadline(dateObj, pureDeadlineConfig)) {
                stats.skippedByDeadline += 1;
                continue;
            }

            if (postedRowsByKey.has(rowKey)) {
                stats.duplicateInFileIgnored += 1;
                continue;
            }

            const incoming = {
                shk,
                nm: toIntegerOrNull(getCellValue(row, normalizedRow, "nm")),
                decription: toText(getCellValue(row, normalizedRow, "decription")),
                brand: toText(getCellValue(row, normalizedRow, "brand")),
                shk_state_before_lost: toText(getCellValue(row, normalizedRow, "shk_state_before_lost")),
                wh_id: whId,
                date_lost: dateLost,
                lr: toIntegerOrNull(lrRaw) ?? toIntegerOrNull(lr) ?? lr,
                price: toNumberOrNull(getCellValue(row, normalizedRow, "price")) ?? 0
            };

            if (rowsByKey.has(rowKey)) {
                stats.duplicateInFileIgnored += 1;
                continue;
            }
            rowsByKey.set(rowKey, incoming);
        }

        return { rowsByKey, postedRowsByKey, stats };
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

    function buildSyncPlan(rowsByKey, postedRowsByKey, existingByShk, currentUserWhId) {
        const rowsToInsert = [];
        const autoFoundUpdates = [];
        const stats = {
            insertedNew: 0,
            skippedSameDate: 0,
            autoMarkedFound: 0
        };

        for (const incoming of rowsByKey.values()) {
            const shk = incoming.shk;
            const existingRows = existingByShk.get(shk) || [];
            const hasSameDate = existingRows.some((row) => isSameShkAndDate(row, incoming.shk, incoming.date_lost, currentUserWhId));
            if (hasSameDate) {
                stats.skippedSameDate += 1;
                continue;
            }
            rowsToInsert.push(toInsertPayload(incoming));
            stats.insertedNew += 1;
        }

        for (const postedSignal of postedRowsByKey.values()) {
            const existingRows = existingByShk.get(postedSignal.shk) || [];
            existingRows.forEach((row) => {
                if (!isSameShkAndDate(row, postedSignal.shk, postedSignal.date_lost, currentUserWhId)) return;
                if (!isRowPendingForAutoFound(row)) return;
                autoFoundUpdates.push(buildAutoFoundUpdateTarget(row, postedSignal));
                stats.autoMarkedFound += 1;
            });
        }

        const uniqueAutoFoundUpdates = dedupeAutoFoundUpdateTargets(autoFoundUpdates);

        return {
            rowsToInsert,
            autoFoundUpdates: uniqueAutoFoundUpdates,
            stats: {
                ...stats,
                autoMarkedFound: uniqueAutoFoundUpdates.length
            }
        };
    }

    function buildShkDateKey(shkValue, dateLostValue) {
        return `${normalizeShk(shkValue)}|${normalizeToken(dateLostValue)}`;
    }

    function collectIncomingShks(prepared) {
        const shks = new Set();
        const rowsByKey = prepared?.rowsByKey instanceof Map ? prepared.rowsByKey : new Map();
        const postedRowsByKey = prepared?.postedRowsByKey instanceof Map ? prepared.postedRowsByKey : new Map();

        rowsByKey.forEach((row) => {
            const shk = normalizeShk(row?.shk);
            if (shk) shks.add(shk);
        });
        postedRowsByKey.forEach((row) => {
            const shk = normalizeShk(row?.shk);
            if (shk) shks.add(shk);
        });

        return Array.from(shks);
    }

    function flattenRowsFromMap(mapByKey) {
        const out = [];
        if (!(mapByKey instanceof Map)) return out;
        mapByKey.forEach((rows) => {
            if (!Array.isArray(rows)) return;
            out.push(...rows);
        });
        return out;
    }

    function normalizeDateIsoValue(value) {
        const parsed = parseDateValue(value);
        if (parsed) return formatIsoDate(parsed);
        const text = toText(value);
        return text || "";
    }

    function isSameShkAndDate(row, shkValue, dateLostValue, whIdValue) {
        const rowShk = normalizeShk(row?.shk);
        const rowDate = normalizeDateIsoValue(row?.date_lost);
        const rowWh = normalizeToken(row?.wh_id);
        const shk = normalizeShk(shkValue);
        const dateLost = normalizeDateIsoValue(dateLostValue);
        const whId = normalizeToken(whIdValue);
        return Boolean(rowShk && rowDate && shk && dateLost)
            && rowShk === shk
            && rowDate === dateLost
            && (!whId || rowWh === whId);
    }

    function isRowPendingForAutoFound(row) {
        const decision = extractDecisionValue(readEditableColumnValue(row, tableState.updateColumnMap.decision));
        const comment = toText(readEditableColumnValue(row, tableState.updateColumnMap.comment));
        return !decision && !comment;
    }

    function getPureRowIdTarget(row) {
        const idCandidates = ["id", "pure_losses_id", "row_id"];
        for (const column of idCandidates) {
            if (!Object.prototype.hasOwnProperty.call(row || {}, column)) continue;
            const value = normalizeToken(row?.[column]);
            if (!value) continue;
            return { column, value };
        };
        return null;
    }

    function buildAutoFoundUpdateTarget(row, postedSignal) {
        return {
            idTarget: getPureRowIdTarget(row),
            shk: normalizeShk(postedSignal?.shk),
            wh_id: normalizeToken(postedSignal?.wh_id),
            date_lost: normalizeDateIsoValue(postedSignal?.date_lost)
        };
    }

    function dedupeAutoFoundUpdateTargets(targets) {
        const out = [];
        const seen = new Set();
        (Array.isArray(targets) ? targets : []).forEach((item) => {
            const idColumn = toText(item?.idTarget?.column);
            const idValue = normalizeToken(item?.idTarget?.value);
            const key = idColumn && idValue
                ? `id:${idColumn}:${idValue}`
                : `key:${buildShkDateKey(item?.shk, item?.date_lost)}|${normalizeToken(item?.wh_id)}`;
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(item);
        });
        return out;
    }

    async function applySyncPlan(syncPlan) {
        const insertChunks = chunkArray(syncPlan.rowsToInsert, INSERT_CHUNK_SIZE);
        for (const rowsChunk of insertChunks) {
            await insertRowsAdaptive(rowsChunk);
        }

        const autoFoundUpdates = Array.isArray(syncPlan.autoFoundUpdates) ? syncPlan.autoFoundUpdates : [];
        for (const target of autoFoundUpdates) {
            await applyAutoFoundUpdate(target);
        }
    }

    async function applyAutoFoundUpdate(target) {
        if (!target || typeof target !== "object") return;

        const patch = sanitizeUpdatePatch({
            [tableState.updateColumnMap.decision]: AUTO_FOUND_DECISION,
            [tableState.updateColumnMap.emp]: AUTO_FOUND_EMP_ID,
            [tableState.updateColumnMap.comment]: AUTO_FOUND_COMMENT
        });
        if (!Object.keys(patch).length) return;

        let query = supabaseClient.from(TABLE_PURE).update(patch);
        if (target.idTarget?.column && target.idTarget?.value) {
            query = query.eq(target.idTarget.column, target.idTarget.value);
        } else {
            query = query
                .eq("shk", target.shk)
                .eq("wh_id", target.wh_id)
                .eq("date_lost", target.date_lost);

            if (Object.prototype.hasOwnProperty.call(patch, tableState.updateColumnMap.decision)) {
                query = query.is(tableState.updateColumnMap.decision, null);
            }
            if (Object.prototype.hasOwnProperty.call(patch, tableState.updateColumnMap.comment)) {
                query = query.is(tableState.updateColumnMap.comment, null);
            }
        }

        const { error } = await query;
        if (!error) return;

        const missingColumn = extractMissingColumnName(error);
        if (missingColumn && Object.prototype.hasOwnProperty.call(patch, missingColumn)) {
            tableState.unsupportedUpdateColumns.add(missingColumn);
            await applyAutoFoundUpdate(target);
            return;
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось обновить строку с движением товара: ${errorText}`);
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

        const match = text.match(/column\s+([^\s]+)\s+does not exist/i)
            || text.match(/could not find(?:\s+the)?\s+"?([a-z0-9_.]+)"?\s+column/i);
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

    function sortMixedNumericStrings(a, b) {
        const aNum = Number(a);
        const bNum = Number(b);
        const aIsNum = Number.isFinite(aNum);
        const bIsNum = Number.isFinite(bNum);

        if (aIsNum && bIsNum) return aNum - bNum;
        if (aIsNum) return -1;
        if (bIsNum) return 1;
        return String(a).localeCompare(String(b), "ru");
    }

    function formatDateForUi(value) {
        const parsed = parseDateValue(value);
        if (!parsed) return toText(value);
        const dd = String(parsed.getDate()).padStart(2, "0");
        const mm = String(parsed.getMonth() + 1).padStart(2, "0");
        const yyyy = parsed.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    }

    function formatPriceForUi(value) {
        const num = toNumberOrNull(value);
        if (num === null) return "—";
        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(num);
    }

    function formatRub(value) {
        const num = Number.isFinite(Number(value)) ? Number(value) : 0;
        return `${formatPriceForUi(Math.max(0, num))} ₽`;
    }

    function formatInt(value) {
        const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
        return Math.trunc(safe).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }

    function formatPercent(value) {
        const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
        return `${new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1
        }).format(Math.max(0, safe))}%`;
    }

    function formatLossBalance(value) {
        const safe = toNumberOrNull(value);
        if (safe === null || Math.abs(safe) < 0.005) return "0 ₽";
        return `-${formatPriceForUi(Math.abs(safe))} ₽`;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
})();
