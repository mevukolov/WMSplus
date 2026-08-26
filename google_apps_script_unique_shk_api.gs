/**
 * Google Apps Script Web API
 *
 * Возвращает:
 * 1) Уникальные ШК по датам за выбранный период
 * 2) Периодовые итоги
 * 3) Блок дедлайнов "Разбор за сегодня" (today_deadline)
 *
 * Листы периода (таблица "Уникальные ШК по датам"):
 * 1) "24"           -> ШК: B, Дата: C,  Разбор: H (не 0)
 * 2) "Предсорт SPS" -> ШК: E, Дата: J,  Разбор: N (не 0)
 * 3) "Упаковка"     -> ШК: C, Дата: G,  Разбор: K (не 0)
 *
 * Листы дедлайнов ("Разбор за сегодня"):
 * - SPS_WMI -> "Предсорт SPS" (только Ст ШК: SPS/WMI)
 * - SMC     -> "Маркет SMC"
 * - SMS     -> "Буфер SMS" + "Почта SMS"
 * - WMI_BZ  -> "Без заказа WMI"
 * - RWP     -> "Ожидает упаковки RWP"
 * - 24      -> "24"
 * - ORS     -> "Движение после продажи ORS"
 * - REPACK  -> "Упаковка"
 *
 * Параметры doGet:
 * - spreadsheet_id (optional): ID таблицы
 * - date_from (optional): YYYY-MM-DD, включительно
 * - date_to (optional): YYYY-MM-DD, включительно
 * - date (optional): YYYY-MM-DD, точечный фильтр после построения by_date
 * - deadlines_json (optional): JSON с дедлайнами, пример:
 *   {"deadlines":[{"key":"SPS","offset_days":-1},{"key":"24","offset_days":0}]}
 */

const PERIOD_SHEETS = [
  { name: "24", shkCol: 2, dateCol: 3, analyzedCol: 9 },
  { name: "Предсорт SPS", shkCol: 5, dateCol: 10, analyzedCol: 14 },
  { name: "Упаковка", shkCol: 3, dateCol: 7, analyzedCol: 11 }
];

const DEADLINE_SOURCES = [
  {
    key: "SPS_WMI",
    sheet: {
      name: "Предсорт SPS",
      shkCol: 5,
      dateCol: 10,
      statusCol: 6,
      analyzedCol: 14,
      analyzerCol: 13,
      breakdownCol: 14,
      commentCol: 12,
      priceCol: 8
    },
    statusWhitelist: ["SPS", "WMI"]
  },
  {
    key: "SMC",
    sheet: {
      name: "Маркет SMC",
      shkCol: 5,
      dateCol: 10,
      statusCol: 6,
      analyzedCol: 14,
      analyzerCol: 13,
      breakdownCol: 14,
      commentCol: 12,
      priceCol: 8
    }
  },
  {
    key: "SMS",
    sheet: {
      name: "Буфер SMS",
      shkCol: 5,
      dateCol: 10,
      statusCol: 6,
      analyzedCol: 14,
      analyzerCol: 13,
      breakdownCol: 14,
      commentCol: 12,
      priceCol: 8
    }
  },
  {
    key: "SMS",
    sheet: {
      name: "Почта SMS",
      shkCol: 5,
      dateCol: 10,
      statusCol: 6,
      analyzedCol: 14,
      analyzerCol: 13,
      breakdownCol: 14,
      commentCol: 12,
      priceCol: 8
    }
  },
  {
    key: "WMI_BZ",
    sheet: {
      name: "Без заказа WMI",
      shkCol: 5,
      dateCol: 10,
      statusCol: 6,
      analyzedCol: 14,
      analyzerCol: 13,
      breakdownCol: 14,
      commentCol: 12,
      priceCol: 8
    }
  },
  {
    key: "RWP",
    sheet: {
      name: "Ожидает упаковки RWP",
      shkCol: 3,
      dateCol: 7,
      statusCol: 6,
      analyzedCol: 11,
      analyzerCol: 10,
      breakdownCol: 11,
      commentCol: 9,
      priceCol: 4
    }
  },
  {
    key: "24",
    sheet: {
      name: "24",
      shkCol: 2,
      dateCol: 3,
      statusCol: 7,
      analyzedCol: 9,
      analyzerCol: 9,
      breakdownCol: 10,
      priceCol: 6
    }
  },
  {
    key: "ORS",
    sheet: {
      name: "Движение после продажи ORS",
      shkCol: 3,
      dateCol: 4,
      statusCol: 5,
      analyzedCol: 9,
      analyzerCol: 8,
      breakdownCol: 9,
      commentCol: 7,
      headerAliases: {
        shkCol: ["ШК", "Штрихкод", "Штрих код"],
        dateCol: ["Дата создания", "Дата", "Дата запроса"],
        statusCol: ["Ст ШК", "Статус ШК", "Статус"],
        analyzedCol: ["Ст разбора", "Статус разбора", "Вердикт"],
        analyzerCol: ["Разбор", "Сотрудник", "Исполнитель"],
        breakdownCol: ["Ст разбора", "Статус разбора", "Вердикт"],
        commentCol: ["Комментарий", "Коммент", "Примечание"]
      }
    }
  },
  {
    key: "REPACK",
    sheet: {
      name: "Упаковка",
      shkCol: 3,
      dateCol: 7,
      statusCol: 6,
      analyzedCol: 11,
      analyzerCol: 10,
      breakdownCol: 11,
      commentCol: 9,
      priceCol: 4
    }
  }
];

const OPP_TELEGRAM_CACHE_DEFAULT_DEADLINES = [
  { key: "SPS_WMI", offset_days: -1, display_key: "SPS + WMI" },
  { key: "SMC", offset_days: -2, display_key: "SMC" },
  { key: "SMS", offset_days: -2, display_key: "SMS" },
  { key: "WMI_BZ", offset_days: -1, display_key: "WMI Без заказа" },
  { key: "RWP", offset_days: -7, display_key: "RWP" },
  { key: "24", offset_days: 0, display_key: "24" },
  { key: "ORS", offset_days: 0, display_key: "ORS" },
  { key: "REPACK", offset_days: -7, display_key: "Упаковка" }
];

const OPP_24_EXPORT_CONFIG = {
  sheetName: "24",
  shkCol: 2,
  writeoffDateCol: 3,
  exceptionCol: 4,
  priceCol: 6,
  statusCol: 7,
  analyzerCol: 9,
  verdictCol: 10,
  preAnalyzerCol: 16,
  preStatusCol: 17,
  preSourceCol: 18,
  preRequestLinkCol: 19
};

const OPP_24_EXPORT_SLOTS = [
  { key: "0830", label: "08:30", hour: 8, minute: 30 },
  { key: "1830", label: "18:30", hour: 18, minute: 30 }
];

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};

    const spreadsheetId = String(params.spreadsheet_id || "").trim();
    const requestedDate = normalizeDateInput_(String(params.date || "").trim());
    const dateFrom = normalizeDateInput_(String(params.date_from || "").trim());
    const dateTo = normalizeDateInput_(String(params.date_to || "").trim());
    const deadlines = parseDeadlinesParam_(String(params.deadlines_json || "").trim());

    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new Error("date_from не может быть больше date_to");
    }

    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();

    const tz = ss.getSpreadsheetTimeZone() || "Europe/Moscow";
    const skipPeriodSheets = String(params.skip_period_sheets || "").trim() === "1";
    const skipTodayDeadline = String(params.skip_today_deadline || "").trim() === "1";
    const shiftCurrentOnly = String(params.shift_current_only || "").trim() === "1";

    const report = buildUniqueShkReport_(ss, tz, {
      dateFrom: dateFrom,
      dateTo: dateTo,
      deadlines: deadlines,
      skipPeriodSheets: skipPeriodSheets,
      skipTodayDeadline: skipTodayDeadline,
      shiftCurrentOnly: shiftCurrentOnly
    });

    let byDate = report.by_date;
    if (requestedDate) {
      byDate = byDate.filter((row) => row.date === requestedDate);
    }

    const result = {
      ok: true,
      mode: "unique_shk_by_date",
      timezone: tz,
      generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      period: {
        from: report.period_from,
        to: report.period_to
      },
      sheets: PERIOD_SHEETS.map((s) => s.name),
      total_period_unique_shk: report.total_period_unique_shk,
      total_period_analyzed_unique_shk: report.total_period_analyzed_unique_shk,
      by_date: byDate,
      today_deadline: report.today_deadline,
      shift_dynamics: report.shift_dynamics
    };

    if (report.missing_sheets.length) {
      result.missing_sheets = report.missing_sheets;
    }

    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function buildUniqueShkReport_(ss, tz, options) {
  const opts = options || {};
  const periodFrom = normalizeDateInput_(String(opts.dateFrom || "").trim());
  const periodTo = normalizeDateInput_(String(opts.dateTo || "").trim());
  const deadlines = Array.isArray(opts.deadlines) ? opts.deadlines : [];
  const skipPeriodSheets = Boolean(opts.skipPeriodSheets);
  const skipTodayDeadline = Boolean(opts.skipTodayDeadline);
  const shiftCurrentOnly = Boolean(opts.shiftCurrentOnly);

  const byDateMap = Object.create(null);
  const missingSheetSet = new Set();

  const periodTotalSet = new Set();
  const periodAnalyzedSet = new Set();
  const todayDeadlineState = initTodayDeadlineState_(deadlines, tz);

  if (!skipPeriodSheets) {
    PERIOD_SHEETS.forEach((cfg) => {
      const sheet = resolveSheetByName_(ss, cfg.name);
      if (!sheet) {
        missingSheetSet.add(cfg.name);
        return;
      }

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

      const lastCol = Math.max(
        sheet.getLastColumn(),
        cfg.shkCol,
        cfg.dateCol,
        cfg.analyzedCol,
        cfg.statusCol || 1
      );
      const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

      values.forEach((row) => {
        const shk = normalizeShk_(row[cfg.shkCol - 1]);
        const dateInfo = parseDateCellInfo_(row[cfg.dateCol - 1], tz);
        const dateKey = dateInfo.dateKey;
        const dateObj = dateInfo.dateObj;
        const analyzedRaw = row[cfg.analyzedCol - 1];
        const isAnalyzed = isAnalyzedValue_(analyzedRaw);

        if (!shk || !dateKey) return;

        if (!isDateInPeriod_(dateKey, periodFrom, periodTo)) return;

        if (!byDateMap[dateKey]) {
          byDateMap[dateKey] = {
            totalSet: new Set(),
            analyzedTotalSet: new Set(),
            sheets: Object.create(null),
            analyzedSheets: Object.create(null)
          };
        }

        const bucket = byDateMap[dateKey];

        if (!bucket.sheets[cfg.name]) {
          bucket.sheets[cfg.name] = new Set();
        }
        bucket.sheets[cfg.name].add(shk);
        bucket.totalSet.add(shk);
        periodTotalSet.add(shk);

        if (isAnalyzed) {
          if (!bucket.analyzedSheets[cfg.name]) {
            bucket.analyzedSheets[cfg.name] = new Set();
          }
          bucket.analyzedSheets[cfg.name].add(shk);
          bucket.analyzedTotalSet.add(shk);
          periodAnalyzedSet.add(shk);
        }
      });
    });
  }

  const byDate = skipPeriodSheets
    ? []
    : Object.keys(byDateMap)
      .sort()
      .reverse()
      .map((dateKey) => {
        const bucket = byDateMap[dateKey];

        const sheetCounts = {};
        const analyzedSheetCounts = {};

        let sheetSum = 0;
        let analyzedSheetSum = 0;

        PERIOD_SHEETS.forEach((cfg) => {
          const sheetCount = bucket.sheets[cfg.name] ? bucket.sheets[cfg.name].size : 0;
          const analyzedSheetCount = bucket.analyzedSheets[cfg.name] ? bucket.analyzedSheets[cfg.name].size : 0;

          sheetCounts[cfg.name] = sheetCount;
          analyzedSheetCounts[cfg.name] = analyzedSheetCount;

          sheetSum += sheetCount;
          analyzedSheetSum += analyzedSheetCount;
        });

        return {
          date: dateKey,
          sheets: sheetCounts,
          analyzed_sheets: analyzedSheetCounts,
          sheet_sum: sheetSum,
          analyzed_sheet_sum: analyzedSheetSum,
          total_unique_shk: bucket.totalSet.size,
          total_analyzed_unique_shk: bucket.analyzedTotalSet.size
        };
      });

  const deadlineRowsByKey = collectDeadlineRowsByKey_(ss, tz, todayDeadlineState.byKey, missingSheetSet);
  const deadlineSourceCounts = Object.create(null);
  const deadlineDateCounts = Object.create(null);
  Object.keys(deadlineRowsByKey).forEach((key) => {
    const rows = deadlineRowsByKey[key] || [];
    deadlineSourceCounts[key] = rows.length;
    const dateCounts = Object.create(null);
    rows.forEach((row) => {
      const dateKey = String(row.date_key || "").trim();
      if (!dateKey) return;
      dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
    });
    deadlineDateCounts[key] = Object.keys(dateCounts)
      .sort()
      .reverse()
      .slice(0, 60)
      .reduce((acc, dateKey) => {
        acc[dateKey] = dateCounts[dateKey];
        return acc;
      }, {});
  });
  if (!skipTodayDeadline) {
    fillTodayDeadlineStateFromRows_(todayDeadlineState, deadlineRowsByKey);
  }
  const shiftDynamics = buildShiftDynamics_(
    periodFrom,
    periodTo,
    todayDeadlineState.items,
    deadlineRowsByKey,
    tz,
    shiftCurrentOnly
  );

  return {
    period_from: periodFrom || "",
    period_to: periodTo || "",
    total_period_unique_shk: periodTotalSet.size,
    total_period_analyzed_unique_shk: periodAnalyzedSet.size,
    by_date: byDate,
    missing_sheets: Array.from(missingSheetSet),
    deadline_source_counts: deadlineSourceCounts,
    deadline_date_counts: deadlineDateCounts,
    today_deadline: skipTodayDeadline
      ? {
        timezone: tz,
        as_of_label: Utilities.formatDate(new Date(), tz, "dd.MM.yyyy HH:mm"),
        items: []
      }
      : finalizeTodayDeadlineState_(todayDeadlineState, tz),
    shift_dynamics: shiftDynamics
  };
}

function initTodayDeadlineState_(deadlines, tz) {
  const entries = normalizeDeadlineEntries_(deadlines);
  const now = new Date();
  const shiftContext = getShiftContext_(now, tz);
  const items = [];
  const byKey = Object.create(null);

  entries.forEach((entry) => {
    const dayAdjustment = Number(entry.day_adjustment || 0);
    const cutoff = buildDeadlineCutoff_(Number(entry.offset_days || 0) + dayAdjustment, now, tz, shiftContext);
    const item = {
      key: entry.key,
      display_key: entry.display_key || entry.key,
      offset_days: entry.offset_days,
      day_adjustment: dayAdjustment,
      compare_mode: cutoff.compare_mode,
      cutoff_date_key: cutoff.cutoff_date_key || "",
      cutoff_ms: cutoff.cutoff_ms || 0,
      due_until_label: cutoff.due_until_label,
      due_for_date_label: cutoff.due_for_date_label,
      totalSet: new Set(),
      analyzedSet: new Set(),
      duePriceByShk: new Map(),
      analyzedPriceByShk: new Map(),
      expensiveDueSet: new Set(),
      expensiveAnalyzedSet: new Set()
    };
    items.push(item);
    byKey[item.key] = item;
  });

  return {
    hasItems: items.length > 0,
    items: items,
    byKey: byKey,
    as_of_label: Utilities.formatDate(now, tz, "dd.MM.yyyy HH:mm"),
    shift_mode: shiftContext.shift_mode,
    operational_date_key: shiftContext.operational_date_key,
    operational_date_label: shiftContext.operational_date_label
  };
}

function finalizeTodayDeadlineState_(state, tz) {
  if (!state || !state.hasItems) {
    return {
      timezone: tz,
      as_of_label: Utilities.formatDate(new Date(), tz, "dd.MM.yyyy HH:mm"),
      items: []
    };
  }

  const items = state.items.map((item) => {
    const dueTotal = item.totalSet.size;
    const analyzed = item.analyzedSet.size;
    const remaining = Math.max(dueTotal - analyzed, 0);
    const percent = dueTotal > 0 ? (analyzed / dueTotal) * 100 : 0;
    const dueTotalPrice = sumMapValues_(item.duePriceByShk);
    const analyzedTotalPrice = sumMapValues_(item.analyzedPriceByShk);
    const expensiveDueTotal = item.expensiveDueSet.size;
    const expensiveAnalyzed = item.expensiveAnalyzedSet.size;
    const expensivePercent = expensiveDueTotal > 0 ? (expensiveAnalyzed / expensiveDueTotal) * 100 : 0;

    return {
      key: item.key,
      display_key: item.display_key,
      offset_days: item.offset_days,
      day_adjustment: item.day_adjustment || 0,
      due_for_date_label: item.due_for_date_label,
      due_until_label: item.due_until_label,
      due_total_unique_shk: dueTotal,
      analyzed_due_unique_shk: analyzed,
      remaining_due_unique_shk: remaining,
      analyzed_percent: Math.round(percent * 10) / 10,
      due_total_sum_price: Math.round(dueTotalPrice * 100) / 100,
      analyzed_due_sum_price: Math.round(analyzedTotalPrice * 100) / 100,
      expensive_due_total_unique_shk: expensiveDueTotal,
      expensive_analyzed_due_unique_shk: expensiveAnalyzed,
      expensive_analyzed_percent: Math.round(expensivePercent * 10) / 10
    };
  });

  return {
    timezone: tz,
    as_of_label: state.as_of_label,
    shift_mode: state.shift_mode || "current_day",
    operational_date_key: state.operational_date_key || "",
    operational_date_label: state.operational_date_label || "",
    items: items
  };
}

function collectDeadlineRowsByKey_(ss, tz, byKeyMap, missingSheetSet) {
  const out = Object.create(null);
  const activeByKey = byKeyMap && typeof byKeyMap === "object" ? byKeyMap : {};

  const activeSources = DEADLINE_SOURCES.filter((source) => {
    return Boolean(activeByKey[source.key]);
  });

  activeSources.forEach((source) => {
    const key = source.key;
    if (!out[key]) out[key] = [];

    const cfg = source.sheet;
    const sheet = resolveSheetByName_(ss, cfg.name);
    if (!sheet) {
      if (missingSheetSet && typeof missingSheetSet.add === "function") {
        missingSheetSet.add(cfg.name);
      }
      return;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const colCfg = resolveSheetColumnConfig_(sheet, cfg);
    const lastCol = Math.max(
      sheet.getLastColumn(),
      colCfg.shkCol,
      colCfg.dateCol,
      colCfg.analyzedCol,
      colCfg.analyzerCol || colCfg.analyzedCol,
      colCfg.breakdownCol || colCfg.analyzedCol,
      colCfg.commentCol || 1,
      colCfg.statusCol || 1,
      colCfg.priceCol || 1
    );
    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    values.forEach((row) => {
      const shk = normalizeShk_(row[colCfg.shkCol - 1]);
      const dateInfo = parseDateCellInfo_(row[colCfg.dateCol - 1], tz);
      const dateKey = dateInfo.dateKey;
      const dateObj = dateInfo.dateObj;
      const analyzedRaw = row[colCfg.analyzedCol - 1];
      const isAnalyzed = isAnalyzedValue_(analyzedRaw);
      const analyzerRawCell = row[(colCfg.analyzerCol || colCfg.analyzedCol) - 1];
      const analyzedRawText = normalizeAnalyzerRaw_(analyzerRawCell);
      const breakdownStatusCell = row[(colCfg.breakdownCol || colCfg.analyzedCol) - 1];
      const breakdownStatus = normalizeBreakdownStatus_(breakdownStatusCell);
      const hasCommentColumn = Boolean(colCfg.commentCol);
      const commentText = hasCommentColumn ? normalizeCommentText_(row[colCfg.commentCol - 1]) : "";
      const price = colCfg.priceCol ? parsePriceValue_(row[colCfg.priceCol - 1]) : null;

      if (!shk || !dateKey) return;
      if (!statusMatchesWhitelist_(row[colCfg.statusCol - 1], source.statusWhitelist)) return;

      out[key].push({
        key: key,
        source_sheet: cfg.name,
        shk: shk,
        date_key: dateKey,
        date_obj: dateObj,
        is_analyzed: isAnalyzed,
        analyzed_raw: analyzedRawText,
        breakdown_status: breakdownStatus,
        has_comment_column: hasCommentColumn,
        comment_text: commentText,
        price: price
      });
    });
  });

  return out;
}

function fillTodayDeadlineStateFromRows_(state, rowsByKey) {
  if (!state || !state.hasItems) return;

  state.items.forEach((item) => {
    const rows = rowsByKey[item.key] || [];
    rows.forEach((row) => {
      applyDeadlineRow_(state, item.key, row.shk, row.date_key, row.date_obj, row.is_analyzed, row.price);
    });
  });
}

function buildShiftDynamics_(periodFrom, periodTo, deadlineItems, rowsByKey, tz, shiftCurrentOnly) {
  const items = Array.isArray(deadlineItems) ? deadlineItems : [];
  if (!items.length) return [];

  const itemsByKey = Object.create(null);
  items.forEach((item) => {
    if (!item || !item.key) return;
    itemsByKey[item.key] = item;
  });

  const range = shiftCurrentOnly
    ? [getShiftContext_(new Date(), tz).operational_date_key].filter(Boolean)
    : buildDateRangeKeys_(periodFrom, periodTo, tz);
  if (!range.length) return [];

  const sheetNamesByKey = buildDeadlineSheetNamesByKey_();
  const result = [];

  range.forEach((operationalDateKey) => {
    const dayShift = buildShiftEntry_(
      operationalDateKey,
      "day",
      itemsByKey,
      rowsByKey,
      sheetNamesByKey,
      tz
    );
    if (dayShift) result.push(dayShift);

    const nightShift = buildShiftEntry_(
      operationalDateKey,
      "night",
      itemsByKey,
      rowsByKey,
      sheetNamesByKey,
      tz
    );
    if (nightShift) result.push(nightShift);
  });

  return result.sort((a, b) => Number(b.shift_sort_ts || 0) - Number(a.shift_sort_ts || 0));
}

function buildShiftEntry_(operationalDateKey, shiftType, itemsByKey, rowsByKey, sheetNamesByKey, tz) {
  const keyOrder = shiftType === "night"
    ? ["SPS_WMI", "SMC", "SMS"]
    : ["REPACK", "RWP", "ORS", "24", "WMI_BZ"];

  const baseDate = parseDateKeyToDate_(operationalDateKey);
  if (!baseDate) return null;

  let shiftName = shiftType === "night" ? "Ночная смена" : "Дневная смена";
  let shiftLabel = formatDateKeyRu_(operationalDateKey);
  let shiftStart = createDateWithTime_(baseDate, 8, 0, 0, 0);

  if (shiftType === "night") {
    const nextDateKey = addDaysToDateKey_(operationalDateKey, 1, tz);
    shiftLabel = formatDateKeyRu_(operationalDateKey) + "-" + formatDateKeyRu_(nextDateKey);
    shiftStart = createDateWithTime_(baseDate, 20, 0, 0, 0);
  }

  const details = [];
  let totalDue = 0;
  let totalAnalyzed = 0;
  let totalDuePrice = 0;
  let totalAnalyzedPrice = 0;
  let totalExpensiveDue = 0;
  let totalExpensiveAnalyzed = 0;
  const shiftAnalyzerRawSet = new Set();
  const shiftBreakdownCounts = new Map();

  keyOrder.forEach((key) => {
    const item = itemsByKey[key];
    if (!item) return;

    const requirement = buildShiftRequirementForKey_(
      key,
      Number(item.offset_days || 0),
      Number(item.day_adjustment || 0),
      operationalDateKey,
      shiftType,
      tz
    );
    const rows = rowsByKey[key] || [];

    const dueSet = new Set();
    const analyzedSet = new Set();
    const duePriceByShk = new Map();
    const analyzedPriceByShk = new Map();
    const expensiveDueSet = new Set();
    const expensiveAnalyzedSet = new Set();
    const analyzerRawSet = new Set();
    const breakdownCounts = new Map();
    const lowQualityWaitingWithoutCommentSet = new Set();
    let uploadRowsCount = 0;

    rows.forEach((row) => {
      if (!rowMatchesShiftRequirement_(requirement, row)) return;
      uploadRowsCount += 1;
      dueSet.add(row.shk);
      putPriceForShk_(duePriceByShk, row.shk, row.price);
      if (isExpensivePrice_(duePriceByShk.get(row.shk))) {
        expensiveDueSet.add(row.shk);
      }
      if (row.is_analyzed) analyzedSet.add(row.shk);
      if (row.breakdown_status) {
        incrementCounterMap_(breakdownCounts, row.breakdown_status);
        incrementCounterMap_(shiftBreakdownCounts, row.breakdown_status);
      }
      if (row.has_comment_column && isWaitingProcessingWithoutComment_(row.breakdown_status, row.comment_text)) {
        lowQualityWaitingWithoutCommentSet.add(row.shk);
      }
      if (row.is_analyzed) {
        const analyzerRaw = normalizeAnalyzerRaw_(row.analyzed_raw);
        if (analyzerRaw) {
          analyzerRawSet.add(analyzerRaw);
          shiftAnalyzerRawSet.add(analyzerRaw);
        }
        const priceForAnalyzed = Number.isFinite(row.price) ? row.price : duePriceByShk.get(row.shk);
        putPriceForShk_(analyzedPriceByShk, row.shk, priceForAnalyzed);
        if (isExpensivePrice_(analyzedPriceByShk.get(row.shk))) {
          expensiveAnalyzedSet.add(row.shk);
        }
      }
    });

    const dueTotal = dueSet.size;
    const analyzed = analyzedSet.size;
    const lowQualityWaitingWithoutComment = lowQualityWaitingWithoutCommentSet.size;
    const lowQualityWaitingWithoutCommentPercent = dueTotal > 0
      ? (lowQualityWaitingWithoutComment / dueTotal) * 100
      : 0;
    analyzedSet.forEach((shk) => {
      if (!analyzedPriceByShk.has(shk) && duePriceByShk.has(shk)) {
        putPriceForShk_(analyzedPriceByShk, shk, duePriceByShk.get(shk));
      }
      if (isExpensivePrice_(analyzedPriceByShk.get(shk))) {
        expensiveAnalyzedSet.add(shk);
      }
    });
    const dueTotalPrice = sumMapValues_(duePriceByShk);
    const analyzedTotalPrice = sumMapValues_(analyzedPriceByShk);
    const expensiveDueTotal = expensiveDueSet.size;
    const expensiveAnalyzed = expensiveAnalyzedSet.size;
    const expensivePercent = expensiveDueTotal > 0 ? (expensiveAnalyzed / expensiveDueTotal) * 100 : 0;

    totalDue += dueTotal;
    totalAnalyzed += analyzed;
    totalDuePrice += dueTotalPrice;
    totalAnalyzedPrice += analyzedTotalPrice;
    totalExpensiveDue += expensiveDueTotal;
    totalExpensiveAnalyzed += expensiveAnalyzed;

    details.push({
      key: key,
      display_key: item.display_key || key,
      sheet_names: sheetNamesByKey[key] || [],
      day_adjustment: Number(item.day_adjustment || 0),
      due_for_date_label: requirement.due_for_date_label,
      due_until_label: requirement.due_until_label,
      due_total_unique_shk: dueTotal,
      analyzed_due_unique_shk: analyzed,
      due_total_sum_price: Math.round(dueTotalPrice * 100) / 100,
      analyzed_due_sum_price: Math.round(analyzedTotalPrice * 100) / 100,
      expensive_due_total_unique_shk: expensiveDueTotal,
      expensive_analyzed_due_unique_shk: expensiveAnalyzed,
      expensive_analyzed_percent: Math.round(expensivePercent * 10) / 10,
      analyzer_values: Array.from(analyzerRawSet).sort(),
      breakdown_status_counts: mapToSortedStatusCounts_(breakdownCounts),
      low_quality_status: "Ожидает обработки",
      low_quality_without_comment_unique_shk: lowQualityWaitingWithoutComment,
      low_quality_without_comment_percent: Math.round(lowQualityWaitingWithoutCommentPercent * 10) / 10,
      upload_status: uploadRowsCount > 0 ? "Есть" : "Нет выгрузки"
    });
  });

  if (!details.length) return null;

  const percent = totalDue > 0 ? (totalAnalyzed / totalDue) * 100 : 0;
  const expensivePercent = totalExpensiveDue > 0 ? (totalExpensiveAnalyzed / totalExpensiveDue) * 100 : 0;
  return {
    shift_id: shiftType + ":" + operationalDateKey,
    shift_type: shiftType,
    shift_name: shiftName,
    shift_label: shiftLabel,
    shift_sort_ts: shiftStart.getTime(),
    operational_date_key: operationalDateKey,
    operational_date_label: formatDateKeyRu_(operationalDateKey),
    total_due_unique_shk: totalDue,
    analyzed_due_unique_shk: totalAnalyzed,
    total_due_sum_price: Math.round(totalDuePrice * 100) / 100,
    analyzed_due_sum_price: Math.round(totalAnalyzedPrice * 100) / 100,
    expensive_due_total_unique_shk: totalExpensiveDue,
    expensive_analyzed_due_unique_shk: totalExpensiveAnalyzed,
    expensive_analyzed_percent: Math.round(expensivePercent * 10) / 10,
    analyzer_values: Array.from(shiftAnalyzerRawSet).sort(),
    breakdown_status_counts: mapToSortedStatusCounts_(shiftBreakdownCounts),
    analyzed_percent: Math.round(percent * 10) / 10,
    details: details
  };
}

function buildShiftRequirementForKey_(key, offsetDays, dayAdjustment, operationalDateKey, shiftType, tz) {
  const baseDate = parseDateKeyToDate_(operationalDateKey);
  const adjustment = Number(dayAdjustment || 0);
  if (!baseDate) {
    return buildShiftRequirementByOffset_(Number(offsetDays || 0) + adjustment, operationalDateKey, tz);
  }
  const adjustedBaseDate = new Date(baseDate.getTime());
  adjustedBaseDate.setDate(adjustedBaseDate.getDate() + adjustment);
  const adjustedOperationalDateKey = Utilities.formatDate(adjustedBaseDate, tz, "yyyy-MM-dd");

  if (key === "WMI_BZ") {
    return buildShiftRequirementByOffset_(
      normalizeDateOnlyOffsetDays_(Number(offsetDays || 0) + adjustment),
      operationalDateKey,
      tz
    );
  }

  if (key === "ORS") {
    const prev = new Date(adjustedBaseDate.getTime());
    prev.setDate(prev.getDate() - 1);
    const prevDateKey = Utilities.formatDate(prev, tz, "yyyy-MM-dd");
    const start = createDateWithTime_(prev, 0, 0, 0, 0);
    const end = createDateWithTime_(adjustedBaseDate, 0, 0, 0, 0);
    return buildWindowRequirement_(
      start,
      end,
      tz,
      "ORS: за " + formatDateKeyRu_(prevDateKey),
      prevDateKey
    );
  }

  if (key === "REPACK") {
    return buildShiftRequirementByOffset_(Number(offsetDays || 0) + 1 + adjustment, operationalDateKey, tz);
  }

  return buildShiftRequirementByOffset_(Number(offsetDays || 0) + adjustment, operationalDateKey, tz);
}

function normalizeDateOnlyOffsetDays_(offsetDays) {
  const offset = Number(offsetDays || 0);
  if (!isFinite(offset)) return 0;
  if (Math.abs(offset - Math.round(offset)) < 1e-9) return offset;
  return offset < 0 ? Math.floor(offset) : Math.ceil(offset);
}

function buildShiftRequirementByOffset_(offsetDays, operationalDateKey, tz) {
  const dayMs = 24 * 60 * 60 * 1000;
  const baseDate = parseDateKeyToDate_(operationalDateKey);
  if (!baseDate) {
    return {
      mode: "exact_date",
      required_date_key: operationalDateKey || "",
      due_for_date_label: formatDateKeyRu_(operationalDateKey || ""),
      due_until_label: "Должно быть разобрано за " + formatDateKeyRu_(operationalDateKey || "")
    };
  }

  const isInteger = Math.abs(offsetDays - Math.round(offsetDays)) < 1e-9;
  if (isInteger) {
    const target = new Date(baseDate.getTime() + offsetDays * dayMs);
    const requiredDateKey = Utilities.formatDate(target, tz, "yyyy-MM-dd");
    const requiredDateLabel = formatDateKeyRu_(requiredDateKey);
    return {
      mode: "exact_date",
      required_date_key: requiredDateKey,
      due_for_date_label: requiredDateLabel,
      due_until_label: "Должно быть разобрано за " + requiredDateLabel
    };
  }

  const closeTs = buildOperationalDayCloseDate_(baseDate);
  const windowEnd = new Date(closeTs.getTime() + offsetDays * dayMs);

  const prevOperationalDate = new Date(baseDate.getTime());
  prevOperationalDate.setDate(prevOperationalDate.getDate() - 1);
  const prevCloseTs = buildOperationalDayCloseDate_(prevOperationalDate);
  const windowStart = new Date(prevCloseTs.getTime() + offsetDays * dayMs);

  const endLabel = Utilities.formatDate(windowEnd, tz, "dd.MM.yyyy HH:mm");
  const startLabel = Utilities.formatDate(windowStart, tz, "dd.MM.yyyy HH:mm");
  return {
      mode: "datetime_window",
      window_start_ms: windowStart.getTime(),
      window_end_ms: windowEnd.getTime(),
      fallback_date_key: Utilities.formatDate(windowEnd, tz, "yyyy-MM-dd"),
      due_for_date_label: endLabel,
      due_until_label: "Должно быть разобрано за интервал " + startLabel + " - " + endLabel
  };
}

function rowMatchesShiftRequirement_(requirement, row) {
  if (!requirement || !row) return false;

  if (requirement.mode === "exact_date") {
    return String(row.date_key || "") === String(requirement.required_date_key || "");
  }

  if (requirement.mode === "datetime_window") {
    if (row.date_obj instanceof Date && !isNaN(row.date_obj.getTime())) {
      const ts = row.date_obj.getTime();
      return ts >= requirement.window_start_ms && ts < requirement.window_end_ms;
    }
    if (requirement.fallback_date_key) {
      return String(row.date_key || "") === String(requirement.fallback_date_key || "");
    }
    return false;
  }

  return false;
}

function buildWindowRequirement_(startDate, endDate, tz, label, fallbackDateKey) {
  return {
    mode: "datetime_window",
    window_start_ms: startDate.getTime(),
    window_end_ms: endDate.getTime(),
    fallback_date_key: fallbackDateKey || "",
    due_for_date_label: label,
    due_until_label: label
  };
}

function buildOperationalDayCloseDate_(operationalDateBase) {
  const dt = new Date(operationalDateBase.getTime());
  dt.setDate(dt.getDate() + 1);
  dt.setHours(8, 0, 0, 0);
  return dt;
}

function createDateWithTime_(baseDate, hh, mm, ss, ms) {
  const dt = new Date(baseDate.getTime());
  dt.setHours(Number(hh || 0), Number(mm || 0), Number(ss || 0), Number(ms || 0));
  return dt;
}

function addDaysToDateKey_(dateKey, days, tz) {
  const base = parseDateKeyToDate_(dateKey);
  if (!base) return "";
  base.setDate(base.getDate() + Number(days || 0));
  return Utilities.formatDate(base, tz, "yyyy-MM-dd");
}

function buildDateRangeKeys_(fromKey, toKey, tz) {
  const dayMs = 24 * 60 * 60 * 1000;
  let fromDate = parseDateKeyToDate_(fromKey);
  let toDate = parseDateKeyToDate_(toKey);

  if (!toDate) toDate = new Date();
  if (!fromDate) {
    fromDate = new Date(toDate.getTime() - 6 * dayMs);
  }

  if (fromDate.getTime() > toDate.getTime()) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }

  const out = [];
  const cur = new Date(fromDate.getTime());
  cur.setHours(0, 0, 0, 0);
  const end = new Date(toDate.getTime());
  end.setHours(0, 0, 0, 0);

  while (cur.getTime() <= end.getTime()) {
    out.push(Utilities.formatDate(cur, tz, "yyyy-MM-dd"));
    cur.setDate(cur.getDate() + 1);
  }

  return out;
}

function parseDateKeyToDate_(dateKey) {
  const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function buildDeadlineSheetNamesByKey_() {
  const map = Object.create(null);
  DEADLINE_SOURCES.forEach((source) => {
    if (!map[source.key]) map[source.key] = [];
    if (map[source.key].indexOf(source.sheet.name) === -1) {
      map[source.key].push(source.sheet.name);
    }
  });
  return map;
}

function formatDateTimeIso_(date, tz) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function formatDateTimeRu_(date, tz) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, tz, "dd.MM.yyyy HH:mm");
}

function hasMeaningfulCell_(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number" && isFinite(value)) return true;
  const raw = String(value).trim();
  if (!raw) return false;
  const lowered = raw.toLowerCase();
  return lowered !== "0" && lowered !== "0.0" && lowered !== "0,0" && lowered !== "false" && lowered !== "нет";
}

function normalizeOpp24Employee_(value) {
  return String(value || "").trim();
}

function readOpp24Rows_(ss, tz) {
  const cfg = OPP_24_EXPORT_CONFIG;
  const sheet = resolveSheetByName_(ss, cfg.sheetName);
  if (!sheet) {
    return {
      ok: false,
      missing_sheet: cfg.sheetName,
      rows: []
    };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {
      ok: true,
      missing_sheet: "",
      rows: []
    };
  }

  const lastCol = Math.max(
    sheet.getLastColumn(),
    cfg.shkCol,
    cfg.writeoffDateCol,
    cfg.exceptionCol,
    cfg.priceCol,
    cfg.statusCol,
    cfg.analyzerCol,
    cfg.verdictCol,
    cfg.preAnalyzerCol,
    cfg.preStatusCol,
    cfg.preSourceCol,
    cfg.preRequestLinkCol
  );
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const displayValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
  const rows = [];

  values.forEach((row, idx) => {
    const displayRow = displayValues[idx] || [];
    const shk = normalizeShk_(row[cfg.shkCol - 1]);
    const dateInfo = parseDateCellInfo_(row[cfg.writeoffDateCol - 1], tz);
    if (!shk || !dateInfo.dateKey) return;

    const priceRaw = row[cfg.priceCol - 1];
    const priceDisplay = displayRow[cfg.priceCol - 1];
    const price = parsePriceValue_(priceRaw);
    const pricePresent = hasMeaningfulCell_(priceRaw) || hasMeaningfulCell_(priceDisplay);
    const preAnalyzer = normalizeOpp24Employee_(displayRow[cfg.preAnalyzerCol - 1] || row[cfg.preAnalyzerCol - 1]);
    const preStatus = normalizeBreakdownStatus_(displayRow[cfg.preStatusCol - 1] || row[cfg.preStatusCol - 1]);
    const exceptionValue = String(displayRow[cfg.exceptionCol - 1] || row[cfg.exceptionCol - 1] || "").trim();

    rows.push({
      row_number: idx + 2,
      shk: shk,
      writeoff_date_key: dateInfo.dateKey,
      writeoff_date_obj: dateInfo.dateObj,
      writeoff_at: formatDateTimeIso_(dateInfo.dateObj, tz),
      writeoff_label: formatDateTimeRu_(dateInfo.dateObj, tz),
      exception_value: exceptionValue,
      price: Number.isFinite(price) ? price : null,
      price_present: pricePresent,
      status: String(displayRow[cfg.statusCol - 1] || row[cfg.statusCol - 1] || "").trim(),
      analyzer: normalizeAnalyzerRaw_(displayRow[cfg.analyzerCol - 1] || row[cfg.analyzerCol - 1]),
      verdict: normalizeBreakdownStatus_(displayRow[cfg.verdictCol - 1] || row[cfg.verdictCol - 1]),
      pre_analyzer: preAnalyzer,
      pre_status: preStatus,
      pre_source: String(displayRow[cfg.preSourceCol - 1] || row[cfg.preSourceCol - 1] || "").trim(),
      pre_request_link: String(displayRow[cfg.preRequestLinkCol - 1] || row[cfg.preRequestLinkCol - 1] || "").trim()
    });
  });

  return {
    ok: true,
    missing_sheet: "",
    rows: rows
  };
}

function latestOpp24ExpectedSlot_(now, tz) {
  const todayKey = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  const today = parseDateKeyToDate_(todayKey);
  const morning = createDateWithTime_(today, 8, 30, 0, 0);
  const evening = createDateWithTime_(today, 18, 30, 0, 0);

  if (now.getTime() >= evening.getTime()) {
    return {
      key: "1830",
      label: "18:30",
      export_at: evening,
      export_date_key: todayKey
    };
  }

  if (now.getTime() >= morning.getTime()) {
    return {
      key: "0830",
      label: "08:30",
      export_at: morning,
      export_date_key: todayKey
    };
  }

  const prevKey = addDaysToDateKey_(todayKey, -1, tz);
  const prev = parseDateKeyToDate_(prevKey);
  return {
    key: "1830",
    label: "18:30",
    export_at: createDateWithTime_(prev, 18, 30, 0, 0),
    export_date_key: prevKey
  };
}

function nearestOpp24Slot_(date, tz) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return {
      key: "",
      label: "",
      export_at: null,
      export_date_key: ""
    };
  }

  const dateKey = Utilities.formatDate(date, tz, "yyyy-MM-dd");
  const keys = [
    addDaysToDateKey_(dateKey, -1, tz),
    dateKey,
    addDaysToDateKey_(dateKey, 1, tz)
  ];
  let best = null;

  keys.forEach((key) => {
    const base = parseDateKeyToDate_(key);
    if (!base) return;
    OPP_24_EXPORT_SLOTS.forEach((slot) => {
      const candidate = createDateWithTime_(base, slot.hour, slot.minute, 0, 0);
      const diff = Math.abs(candidate.getTime() - date.getTime());
      if (!best || diff < best.diff) {
        best = {
          key: slot.key,
          label: slot.label,
          export_at: candidate,
          export_date_key: key,
          diff: diff
        };
      }
    });
  });

  return best || {
    key: "",
    label: "",
    export_at: null,
    export_date_key: ""
  };
}

function incrementUniqueMapSet_(map, key, shk) {
  if (!(map instanceof Map)) return;
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey || !shk) return;
  if (!map.has(normalizedKey)) map.set(normalizedKey, new Set());
  map.get(normalizedKey).add(shk);
}

function uniqueMapToSortedCounts_(map) {
  if (!(map instanceof Map)) return [];
  return Array.from(map.entries())
    .map(([name, set]) => ({
      name: String(name || "").trim(),
      count: set instanceof Set ? set.size : 0
    }))
    .filter((item) => item.name && item.count > 0)
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}

function normalizeYesNoToken_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function buildOpp24StatsForRows_(rows, tz) {
  const totalSet = new Set();
  const exceptionYesSet = new Set();
  const writeoffTargetSet = new Set();
  const pricePresentSet = new Set();
  const priceByShk = new Map();
  const noPreAnalysisCandidateSet = new Set();
  const preAnalysisPresentSet = new Set();
  const preNotAutoByEmployee = new Map();
  const waitingByEmployee = new Map();
  const verdictCounts = new Map();
  const preStatusCounts = new Map();
  const topPriceByShk = new Map();
  const topItemByShk = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const shk = row.shk;
    if (!shk) return;
    totalSet.add(shk);
    const exceptionToken = normalizeYesNoToken_(row.exception_value);
    if (exceptionToken === "да") exceptionYesSet.add(shk);
    if (exceptionToken === "нет") writeoffTargetSet.add(shk);

    if (row.price_present) pricePresentSet.add(shk);
    if (Number.isFinite(row.price)) {
      putPriceForShk_(priceByShk, shk, row.price);
      const existing = topPriceByShk.get(shk);
      if (!Number.isFinite(existing) || row.price > existing) {
        topPriceByShk.set(shk, row.price);
        topItemByShk.set(shk, row);
      }
    }

    const preAnalyzer = normalizeOpp24Employee_(row.pre_analyzer);
    const preStatus = normalizeBreakdownStatus_(row.pre_status);
    const verdict = normalizeBreakdownStatus_(row.verdict);
    const hasPre = Boolean(preAnalyzer || preStatus);
    if (hasPre) preAnalysisPresentSet.add(shk);
    else noPreAnalysisCandidateSet.add(shk);

    if (verdict) incrementCounterMap_(verdictCounts, verdict);
    if (preStatus) incrementCounterMap_(preStatusCounts, preStatus);

    if (preAnalyzer && normalizeStatusToken_(verdict) !== normalizeStatusToken_("Автосписание")) {
      incrementUniqueMapSet_(preNotAutoByEmployee, preAnalyzer, shk);
    }

    if (preAnalyzer && normalizeStatusToken_(preStatus) === normalizeStatusToken_("Ожидает обработки")) {
      incrementUniqueMapSet_(waitingByEmployee, preAnalyzer, shk);
    }
  });

  const noPreAnalysisSet = new Set();
  noPreAnalysisCandidateSet.forEach((shk) => {
    if (!preAnalysisPresentSet.has(shk)) noPreAnalysisSet.add(shk);
  });

  const total = totalSet.size;
  const missingPrice = Math.max(0, total - pricePresentSet.size);
  const topExpensiveItems = Array.from(topItemByShk.values())
    .filter((row) => Number.isFinite(row.price))
    .sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
    .slice(0, 10)
    .map((row) => ({
      shk: row.shk,
      price: row.price,
      writeoff_at: row.writeoff_at,
      writeoff_label: row.writeoff_label,
      verdict: row.verdict || "",
      pre_analyzer: row.pre_analyzer || "",
      pre_status: row.pre_status || "",
      pre_request_link: row.pre_request_link || ""
    }));

  return {
    total_unique_shk: total,
    exception_unique_shk: exceptionYesSet.size,
    writeoff_target_unique_shk: writeoffTargetSet.size,
    total_sum_price: Math.round(sumMapValues_(priceByShk) * 100) / 100,
    max_price: topExpensiveItems.length ? Number(topExpensiveItems[0].price || 0) : 0,
    top_expensive_items: topExpensiveItems,
    missing_price_unique_shk: missingPrice,
    missing_price_percent: total > 0 ? Math.round((missingPrice / total) * 1000) / 10 : 0,
    no_preanalysis_unique_shk: noPreAnalysisSet.size,
    no_preanalysis_percent: total > 0 ? Math.round((noPreAnalysisSet.size / total) * 1000) / 10 : 0,
    preanalysis_not_auto_by_employee: uniqueMapToSortedCounts_(preNotAutoByEmployee),
    waiting_processing_by_employee: uniqueMapToSortedCounts_(waitingByEmployee),
    verdict_counts: mapToSortedStatusCounts_(verdictCounts),
    pre_status_counts: mapToSortedStatusCounts_(preStatusCounts)
  };
}

function buildOpp24ExportAnalytics_(ss, tz) {
  const read = readOpp24Rows_(ss, tz);
  const now = new Date();
  const expected = latestOpp24ExpectedSlot_(now, tz);
  const toleranceMs = 90 * 60 * 1000;

  let latestWriteoff = null;
  (read.rows || []).forEach((row) => {
    const dt = row.writeoff_date_obj;
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return;
    if (!latestWriteoff || dt.getTime() > latestWriteoff.getTime()) {
      latestWriteoff = dt;
    }
  });

  const estimatedExport = latestWriteoff
    ? new Date(latestWriteoff.getTime() - 24 * 60 * 60 * 1000)
    : null;
  const estimatedSlot = estimatedExport ? nearestOpp24Slot_(estimatedExport, tz) : null;
  const windowEnd = latestWriteoff;
  const windowStart = latestWriteoff
    ? new Date(latestWriteoff.getTime() - 24 * 60 * 60 * 1000)
    : null;
  const currentRows = latestWriteoff
    ? (read.rows || []).filter((row) => {
      const dt = row.writeoff_date_obj;
      return dt instanceof Date &&
        !isNaN(dt.getTime()) &&
        dt.getTime() >= windowStart.getTime() &&
        dt.getTime() <= windowEnd.getTime();
    })
    : [];
  const currentStats = buildOpp24StatsForRows_(currentRows, tz);
  const expectedMs = expected.export_at ? expected.export_at.getTime() : 0;
  const estimatedMs = estimatedExport ? estimatedExport.getTime() : 0;
  const isFresh = Boolean(estimatedExport && expectedMs && estimatedMs >= expectedMs - toleranceMs);
  const todayKey = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  const weekTo = addDaysToDateKey_(todayKey, -1, tz);
  const weekFrom = addDaysToDateKey_(weekTo, -6, tz);
  const weeklyRows = (read.rows || []).filter((row) => {
    const key = String(row.writeoff_date_key || "");
    return key && key >= weekFrom && key <= weekTo;
  });
  const weeklyStats = buildOpp24StatsForRows_(weeklyRows, tz);

  return {
    ok: read.ok,
    missing_sheet: read.missing_sheet || "",
    timezone: tz,
    generated_at: formatDateTimeIso_(now, tz),
    current_export: Object.assign({
      expected_slot_key: expected.key,
      expected_slot_label: expected.label,
      expected_export_at: formatDateTimeIso_(expected.export_at, tz),
      expected_export_label: formatDateTimeRu_(expected.export_at, tz),
      latest_writeoff_at: formatDateTimeIso_(latestWriteoff, tz),
      latest_writeoff_label: formatDateTimeRu_(latestWriteoff, tz),
      estimated_export_at: formatDateTimeIso_(estimatedExport, tz),
      estimated_export_label: formatDateTimeRu_(estimatedExport, tz),
      estimated_slot_key: estimatedSlot ? estimatedSlot.key : "",
      estimated_slot_label: estimatedSlot ? estimatedSlot.label : "",
      is_fresh: isFresh,
      freshness_status: isFresh ? "ok" : "late_or_missing",
      freshness_delta_minutes: estimatedExport && expected.export_at
        ? Math.round((estimatedExport.getTime() - expected.export_at.getTime()) / 60000)
        : null,
      window_start_at: formatDateTimeIso_(windowStart, tz),
      window_start_label: formatDateTimeRu_(windowStart, tz),
      window_end_at: formatDateTimeIso_(windowEnd, tz),
      window_end_label: formatDateTimeRu_(windowEnd, tz),
      source_rows: currentRows.length
    }, currentStats),
    weekly_stats: Object.assign({
      period_from: weekFrom,
      period_to: weekTo,
      period_from_label: formatDateKeyRu_(weekFrom),
      period_to_label: formatDateKeyRu_(weekTo),
      source_rows: weeklyRows.length
    }, weeklyStats)
  };
}

function applyDeadlineRow_(state, keyRaw, shk, dateKey, dateObj, isAnalyzed, price) {
  if (!state || !state.hasItems) return;

  const key = normalizeDeadlineKey_(keyRaw);
  if (!key) return;

  const item = state.byKey[key];
  if (!item) return;

  if (!isDateWithinDeadline_(item, dateKey, dateObj)) return;

  item.totalSet.add(shk);
  putPriceForShk_(item.duePriceByShk, shk, price);
  if (isExpensivePrice_(item.duePriceByShk.get(shk))) {
    item.expensiveDueSet.add(shk);
  }
  if (item.analyzedSet.has(shk) && !item.analyzedPriceByShk.has(shk)) {
    const duePrice = item.duePriceByShk.get(shk);
    putPriceForShk_(item.analyzedPriceByShk, shk, duePrice);
    if (isExpensivePrice_(item.analyzedPriceByShk.get(shk))) {
      item.expensiveAnalyzedSet.add(shk);
    }
  }

  if (isAnalyzed) {
    item.analyzedSet.add(shk);
    const priceForAnalyzed = Number.isFinite(price) ? price : item.duePriceByShk.get(shk);
    putPriceForShk_(item.analyzedPriceByShk, shk, priceForAnalyzed);
    if (isExpensivePrice_(item.analyzedPriceByShk.get(shk))) {
      item.expensiveAnalyzedSet.add(shk);
    }
  }
}

function isDateWithinDeadline_(item, dateKey, dateObj) {
  if (!item) return false;

  if (item.compare_mode === "date_key") {
    if (!dateKey || !item.cutoff_date_key) return false;
    return dateKey <= item.cutoff_date_key;
  }

  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
    return false;
  }
  return dateObj.getTime() <= item.cutoff_ms;
}

function buildDeadlineCutoff_(offsetDays, now, tz, shiftContext) {
  const dayMs = 24 * 60 * 60 * 1000;
  const eps = 1e-9;

  if (Math.abs(offsetDays) < eps) {
    const nowLabel = Utilities.formatDate(now, tz, "dd.MM.yyyy HH:mm");
    return {
      compare_mode: "datetime",
      cutoff_ms: now.getTime(),
      due_for_date_label: nowLabel,
      due_until_label: "Должно быть разобрано онлайн (до текущего времени)"
    };
  }

  const isInteger = Math.abs(offsetDays - Math.round(offsetDays)) < eps;
  if (isInteger) {
    const baseDate = shiftContext && shiftContext.operational_anchor_date
      ? shiftContext.operational_anchor_date
      : now;
    const target = new Date(baseDate.getTime() + offsetDays * dayMs);
    const cutoffDateKey = Utilities.formatDate(target, tz, "yyyy-MM-dd");
    const cutoffDateLabel = formatDateKeyRu_(cutoffDateKey);
    const isNightCarry = Boolean(shiftContext && shiftContext.shift_mode === "night_carry");
    return {
      compare_mode: "date_key",
      cutoff_date_key: cutoffDateKey,
      due_for_date_label: cutoffDateLabel,
      due_until_label: isNightCarry
        ? "Должно быть разобрано за " + cutoffDateLabel + " (ночная смена)"
        : "Должно быть разобрано за " + cutoffDateLabel
    };
  }

  const cutoff = new Date(now.getTime() + offsetDays * dayMs);
  const cutoffLabel = Utilities.formatDate(cutoff, tz, "dd.MM.yyyy HH:mm");
  return {
    compare_mode: "datetime",
    cutoff_ms: cutoff.getTime(),
    due_for_date_label: cutoffLabel,
    due_until_label: "Должно быть разобрано до " + cutoffLabel
  };
}

function getShiftContext_(now, tz) {
  const localHour = Number(Utilities.formatDate(now, tz, "H"));
  const isNightCarry = localHour >= 0 && localHour < 8;

  const operationalAnchorDate = new Date(now.getTime());
  if (isNightCarry) {
    operationalAnchorDate.setDate(operationalAnchorDate.getDate() - 1);
  }

  const operationalDateKey = Utilities.formatDate(operationalAnchorDate, tz, "yyyy-MM-dd");
  const operationalDateLabel = formatDateKeyRu_(operationalDateKey);

  return {
    shift_mode: isNightCarry ? "night_carry" : "current_day",
    operational_anchor_date: operationalAnchorDate,
    operational_date_key: operationalDateKey,
    operational_date_label: operationalDateLabel
  };
}

function normalizeDeadlineEntries_(entriesRaw) {
  const src = Array.isArray(entriesRaw) ? entriesRaw : [];
  const out = [];
  const byKey = Object.create(null);

  src.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;

    const key = normalizeDeadlineKey_(entry.key || entry.status || entry.name);
    if (!key) return;

    const offset = parseDeadlineOffset_(entry.offset_days != null ? entry.offset_days : entry.offset);
    if (offset === null) return;
    const dayAdjustment = parseDeadlineOffset_(
      entry.day_adjustment != null
        ? entry.day_adjustment
        : (entry.adjustment_days != null ? entry.adjustment_days : entry.shift_days)
    );
    const safeDayAdjustment = dayAdjustment === null ? 0 : dayAdjustment;

    if (byKey[key]) {
      byKey[key].offset_days = offset;
      byKey[key].day_adjustment = safeDayAdjustment;
      return;
    }

    const normalized = {
      key: key,
      display_key: String(entry.display_key || entry.key || key).trim(),
      offset_days: offset,
      day_adjustment: safeDayAdjustment
    };

    out.push(normalized);
    byKey[key] = normalized;
  });

  return out;
}

function parseDeadlinesParam_(raw) {
  const out = [];
  const byKey = Object.create(null);

  function put(keyRaw, offsetRaw, displayKeyRaw, adjustmentRaw) {
    const key = normalizeDeadlineKey_(keyRaw);
    const offset = parseDeadlineOffset_(offsetRaw);
    if (!key || offset === null) return;
    const adjustment = parseDeadlineOffset_(adjustmentRaw);
    const safeAdjustment = adjustment === null ? 0 : adjustment;

    if (byKey[key]) {
      byKey[key].offset_days = offset;
      byKey[key].day_adjustment = safeAdjustment;
      return;
    }

    const item = {
      key: key,
      display_key: String(displayKeyRaw || keyRaw || key).trim(),
      offset_days: offset,
      day_adjustment: safeAdjustment
    };
    out.push(item);
    byKey[key] = item;
  }

  if (!raw) return out;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parsed = raw;
  }

  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed)) {
      parsed.forEach((item) => {
        if (!item || typeof item !== "object") return;
        put(
          item.key || item.name || item.status,
          item.offset_days != null ? item.offset_days : item.offset,
          item.display_key || item.key,
          item.day_adjustment != null ? item.day_adjustment : (item.adjustment_days != null ? item.adjustment_days : item.shift_days)
        );
      });
    } else {
      if (Array.isArray(parsed.deadlines)) {
        parsed.deadlines.forEach((item) => {
          if (!item || typeof item !== "object") return;
          put(
            item.key || item.name || item.status,
            item.offset_days != null ? item.offset_days : item.offset,
            item.display_key || item.key,
            item.day_adjustment != null ? item.day_adjustment : (item.adjustment_days != null ? item.adjustment_days : item.shift_days)
          );
        });
      }

      if (parsed.values && typeof parsed.values === "object") {
        Object.keys(parsed.values).forEach((key) => {
          put(key, parsed.values[key], key);
        });
      }

      Object.keys(parsed).forEach((key) => {
        if (key === "deadlines" || key === "values") return;
        put(key, parsed[key], key);
      });
    }
  }

  if (typeof parsed === "string") {
    const pairRegex = /["']?([A-Za-z0-9_]+)["']?\s*:\s*["']?(-?\d+(?:[.,]\d+)?)["']?/g;
    let match = null;
    while ((match = pairRegex.exec(parsed)) !== null) {
      put(match[1], match[2], match[1]);
    }
  }

  return out;
}

function parseDeadlineOffset_(value) {
  if (typeof value === "number") {
    if (!isFinite(value)) return null;
    return value;
  }

  const raw = String(value || "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return isFinite(parsed) ? parsed : null;
}

function normalizeDeadlineKey_(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeStatusToken_(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-ZА-Я0-9_]/g, "");
}

function statusMatchesWhitelist_(statusRaw, whitelist) {
  const allowed = Array.isArray(whitelist) ? whitelist : [];
  if (!allowed.length) return true;

  const rowToken = normalizeStatusToken_(statusRaw);
  if (!rowToken) return false;

  return allowed.some((status) => {
    const target = normalizeStatusToken_(status);
    if (!target) return false;
    if (rowToken === target) return true;
    if (rowToken.indexOf(target) >= 0) return true;
    return false;
  });
}

function normalizeHeaderToken_(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/Ё/g, "Е")
    .replace(/\s+/g, "")
    .replace(/[^A-ZА-Я0-9]/g, "");
}

function findHeaderColumnInRow_(headerRow, aliases) {
  const aliasTokens = (Array.isArray(aliases) ? aliases : [])
    .map((alias) => normalizeHeaderToken_(alias))
    .filter(Boolean);
  if (!aliasTokens.length) return null;

  const headers = (Array.isArray(headerRow) ? headerRow : [])
    .map((value, index) => ({
      token: normalizeHeaderToken_(value),
      col: index + 1
    }))
    .filter((item) => item.token);

  for (var aExact = 0; aExact < aliasTokens.length; aExact++) {
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].token === aliasTokens[aExact]) return headers[i].col;
    }
  }

  for (var a = 0; a < aliasTokens.length; a++) {
    for (var h = 0; h < headers.length; h++) {
      const alias = aliasTokens[a];
      if (alias.length <= 2 || headers[h].token.length <= 2) continue;
      if (headers[h].token.indexOf(alias) !== -1 || alias.indexOf(headers[h].token) !== -1) {
        return headers[h].col;
      }
    }
  }

  return null;
}

function resolveSheetColumnConfig_(sheet, cfg) {
  const resolved = Object.assign({}, cfg || {});
  const aliasesByField = resolved.headerAliases || null;
  if (!aliasesByField || !sheet) return resolved;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return resolved;

  const headerRowsCount = Math.min(5, lastRow);
  const headerRows = sheet.getRange(1, 1, headerRowsCount, lastCol).getDisplayValues();
  let best = null;

  headerRows.forEach((headerRow) => {
    const found = Object.create(null);
    let score = 0;

    Object.keys(aliasesByField).forEach((field) => {
      const col = findHeaderColumnInRow_(headerRow, aliasesByField[field]);
      if (col) {
        found[field] = col;
        score += 1;
      }
    });

    if (!best || score > best.score) {
      best = { score: score, found: found };
    }
  });

  if (best && best.score > 0) {
    Object.keys(best.found).forEach((field) => {
      resolved[field] = best.found[field];
    });
  }

  return resolved;
}

function normalizeSheetName_(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function resolveSheetByName_(ss, wantedName) {
  const direct = ss.getSheetByName(wantedName);
  if (direct) return direct;

  const wanted = normalizeSheetName_(wantedName);
  if (!wanted) return null;

  const sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (normalizeSheetName_(sh.getName()) === wanted) {
      return sh;
    }
  }

  return null;
}

function formatDateKeyRu_(dateKey) {
  const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateKey || "");
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function parseDateCellInfo_(value, tz) {
  const dateObj = parseDateCellToDate_(value);
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
    return { dateObj: null, dateKey: "" };
  }

  return {
    dateObj: dateObj,
    dateKey: Utilities.formatDate(dateObj, tz, "yyyy-MM-dd")
  };
}

function buildSafeDateFromParts_(yyyy, mm, dd, hh, mi, ss) {
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  const hour = Number(hh || 0);
  const minute = Number(mi || 0);
  const second = Number(ss || 0);

  const dt = new Date(year, month - 1, day, hour, minute, second, 0);
  if (isNaN(dt.getTime())) return null;

  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day ||
    dt.getHours() !== hour ||
    dt.getMinutes() !== minute ||
    dt.getSeconds() !== second
  ) {
    return null;
  }

  return dt;
}

function parseDateCellToDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  if (typeof value === "number" && isFinite(value) && value > 25000 && value < 60000) {
    const epoch = Math.round((value - 25569) * 86400 * 1000);
    const dt = new Date(epoch);
    if (!isNaN(dt.getTime())) return dt;
  }

  const text = String(value || "").trim().replace(/^'+/, "").trim();
  if (!text) return null;

  // Поддерживаем ручные ошибки формата: "2026-06-29 02:55:35.894",
  // "2026-06-29T02:55:35.894", а также опциональную таймзону в конце.
  let m = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d{1,9})?)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/);
  if (m) {
    const dt = buildSafeDateFromParts_(m[1], m[2], m[3], m[4], m[5], m[6]);
    if (dt) return dt;
  }

  m = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d{1,9})?)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/);
  if (m) {
    const yyRaw = String(m[3]);
    const yyyy = yyRaw.length === 2 ? ("20" + yyRaw) : yyRaw;
    const dt = buildSafeDateFromParts_(yyyy, m[2], m[1], m[4], m[5], m[6]);
    if (dt) return dt;
  }

  const relaxed = text
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  m = relaxed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[^\d]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d{1,9})?)?)?/);
  if (m) {
    const dt = buildSafeDateFromParts_(m[1], m[2], m[3], m[4], m[5], m[6]);
    if (dt) return dt;
  }

  m = relaxed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[^\d]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d{1,9})?)?)?/);
  if (m) {
    const yyRaw = String(m[3]);
    const yyyy = yyRaw.length === 2 ? ("20" + yyRaw) : yyRaw;
    const dt = buildSafeDateFromParts_(yyyy, m[2], m[1], m[4], m[5], m[6]);
    if (dt) return dt;
  }

  return null;
}

function isDateInPeriod_(dateKey, fromKey, toKey) {
  if (!dateKey) return false;
  if (fromKey && dateKey < fromKey) return false;
  if (toKey && dateKey > toKey) return false;
  return true;
}

function isAnalyzedValue_(value) {
  if (value === null || value === undefined) return false;

  if (typeof value === "number") {
    if (!isFinite(value)) return false;
    return value !== 0;
  }

  const text = String(value).trim();
  if (!text) return false;

  const lowered = text.toLowerCase();
  if (
    lowered === "0" ||
    lowered === "0.0" ||
    lowered === "0,0" ||
    lowered === "false" ||
    lowered === "нет"
  ) {
    return false;
  }

  const asNumber = Number(text.replace(/\s+/g, "").replace(",", "."));
  if (isFinite(asNumber)) {
    return asNumber !== 0;
  }

  return true;
}

function normalizeAnalyzerRaw_(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

function normalizeBreakdownStatus_(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!isFinite(value) || value === 0) return "";
    return String(value);
  }

  const text = String(value).trim();
  if (!text) return "";

  const lowered = text.toLowerCase();
  if (
    lowered === "0" ||
    lowered === "0.0" ||
    lowered === "0,0" ||
    lowered === "false" ||
    lowered === "нет" ||
    lowered === "-" ||
    lowered === "—"
  ) {
    return "";
  }

  return text;
}

function normalizeCommentText_(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";

  const lowered = text.toLowerCase();
  if (
    lowered === "0" ||
    lowered === "0.0" ||
    lowered === "0,0" ||
    lowered === "false" ||
    lowered === "нет" ||
    lowered === "-" ||
    lowered === "—"
  ) {
    return "";
  }

  return text;
}

function isWaitingProcessingWithoutComment_(breakdownStatus, commentText) {
  return normalizeStatusToken_(breakdownStatus) === normalizeStatusToken_("Ожидает обработки") &&
    !normalizeCommentText_(commentText);
}

function incrementCounterMap_(map, key) {
  if (!(map instanceof Map)) return;
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  map.set(normalizedKey, Number(map.get(normalizedKey) || 0) + 1);
}

function mapToSortedStatusCounts_(map) {
  if (!(map instanceof Map)) return [];
  return Array.from(map.entries())
    .map(([status, count]) => ({
      status: String(status || "").trim(),
      count: Number(count || 0)
    }))
    .filter((item) => item.status && item.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.status.localeCompare(b.status);
    });
}

function parsePriceValue_(value) {
  if (typeof value === "number" && isFinite(value)) {
    return value;
  }

  const raw = String(value || "").trim();
  if (!raw) return null;

  let normalized = raw
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");

  if (!normalized) return null;

  normalized = normalized.replace(/\.(?=.*\.)/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return isFinite(parsed) ? parsed : null;
}

function putPriceForShk_(map, shk, price) {
  if (!(map instanceof Map)) return;
  if (!shk) return;
  if (!Number.isFinite(price)) return;

  const existing = map.get(shk);
  if (!Number.isFinite(existing) || price > existing) {
    map.set(shk, price);
  }
}

function sumMapValues_(map) {
  if (!(map instanceof Map)) return 0;
  let total = 0;
  map.forEach((value) => {
    if (Number.isFinite(value)) {
      total += value;
    }
  });
  return total;
}

function isExpensivePrice_(price) {
  return Number.isFinite(price) && Number(price) > 1000;
}

function normalizeShk_(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDateInput_(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;

  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return "";

  const dd = ("0" + m[1]).slice(-2);
  const mm = ("0" + m[2]).slice(-2);
  const yyRaw = String(m[3]);
  const yyyy = yyRaw.length === 2 ? "20" + yyRaw : yyRaw;

  return `${yyyy}-${mm}-${dd}`;
}

function getOppCacheScriptProperty_(key, fallbackValue) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value === null || value === undefined || String(value).trim() === ""
    ? fallbackValue
    : String(value).trim();
}

function getOppTelegramCacheSettings_() {
  const ingestUrl = getOppCacheScriptProperty_(
    "OPP_CACHE_INGEST_URL",
    "https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/opp-cache-ingest"
  );
  const ingestSecret = getOppCacheScriptProperty_("OPP_CACHE_INGEST_SECRET", "");
  const whId = getOppCacheScriptProperty_("OPP_CACHE_WH_ID", "50144199");
  const spreadsheetId = getOppCacheScriptProperty_("OPP_CACHE_SPREADSHEET_ID", "");
  const ttlRaw = getOppCacheScriptProperty_("OPP_CACHE_TTL_MINUTES", "90");
  const ttlMinutes = Math.max(Number(ttlRaw) || 90, 5);

  if (!ingestSecret) {
    throw new Error("Не задан Script Property OPP_CACHE_INGEST_SECRET");
  }

  return {
    ingestUrl: ingestUrl,
    ingestSecret: ingestSecret,
    whId: whId,
    spreadsheetId: spreadsheetId,
    ttlMinutes: ttlMinutes
  };
}

function normalizeDeadlineListForMeta_(deadlines) {
  const entries = normalizeDeadlineEntries_(deadlines);
  return entries.map((item) => {
    const offset = Number(item.offset_days || 0);
    const adjustment = Number(item.day_adjustment || 0);
    const effectiveOffset = item.key === "WMI_BZ"
      ? normalizeDateOnlyOffsetDays_(offset + adjustment)
      : offset + adjustment;
    return {
      key: item.key,
      display_key: item.display_key || item.key,
      offset_days: offset,
      day_adjustment: effectiveOffset - offset,
      effective_offset_days: effectiveOffset
    };
  });
}

function buildOppTelegramDeadlineSettingsMeta_(deadlines) {
  const items = normalizeDeadlineListForMeta_(deadlines);
  const base = {};
  const effective = {};
  const adjustments = {};

  items.forEach((item) => {
    base[item.key] = item.offset_days;
    effective[item.key] = item.effective_offset_days;
    adjustments[item.key] = item.day_adjustment;
  });

  return {
    base: base,
    effective: effective,
    adjustments: adjustments,
    items: items
  };
}

function fetchOppTelegramCacheDeadlinesFromIngest_(settings) {
  if (!settings || !settings.ingestUrl || !settings.ingestSecret || !settings.whId) return [];

  try {
    const response = UrlFetchApp.fetch(settings.ingestUrl, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        secret: settings.ingestSecret,
        action: "get_deadlines",
        wh_id: settings.whId
      })
    });

    const status = response.getResponseCode();
    const text = response.getContentText();
    if (status < 200 || status >= 300 || !text) return [];

    const parsed = JSON.parse(text);
    if (!parsed || parsed.ok === false) return [];
    return normalizeDeadlineEntries_(parsed.deadlines || parsed.items || []);
  } catch (err) {
    return [];
  }
}

function getOppTelegramCacheDeadlines_(settings) {
  const remote = fetchOppTelegramCacheDeadlinesFromIngest_(settings);
  if (remote.length) return remote;

  const raw = getOppCacheScriptProperty_("OPP_CACHE_DEADLINES_JSON", "");
  if (!raw) return OPP_TELEGRAM_CACHE_DEFAULT_DEADLINES.slice();

  const parsed = parseDeadlinesParam_(raw);
  return parsed.length ? parsed : OPP_TELEGRAM_CACHE_DEFAULT_DEADLINES.slice();
}

function toNumberSafe_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function mergeStatusCounts_(targetMap, counts) {
  (Array.isArray(counts) ? counts : []).forEach((entry) => {
    const status = String(entry && entry.status ? entry.status : "").trim();
    if (!status) return;
    const count = toNumberSafe_(entry.count || entry.value);
    if (count <= 0) return;
    targetMap.set(status, toNumberSafe_(targetMap.get(status)) + count);
  });
}

function mergeTextArrayIntoSet_(set, values) {
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = String(value || "").trim();
    if (text) set.add(text);
  });
}

function mapStatusCountsToArray_(map) {
  const out = [];
  map.forEach((count, status) => {
    if (status && count > 0) {
      out.push({ status: status, count: count });
    }
  });
  return out.sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status));
}

function mergeTelegramDetail_(target, source) {
  const numericFields = [
    "due_total_sum_price",
    "due_total_unique_shk",
    "analyzed_due_sum_price",
    "analyzed_due_unique_shk",
    "expensive_due_total_unique_shk",
    "expensive_analyzed_due_unique_shk",
    "low_quality_without_comment_unique_shk"
  ];

  numericFields.forEach((field) => {
    target[field] = toNumberSafe_(target[field]) + toNumberSafe_(source[field]);
  });

  const sheetNames = new Set(Array.isArray(target.sheet_names) ? target.sheet_names : []);
  mergeTextArrayIntoSet_(sheetNames, source.sheet_names);
  target.sheet_names = Array.from(sheetNames).sort();

  const analyzers = new Set(Array.isArray(target.analyzer_values) ? target.analyzer_values : []);
  mergeTextArrayIntoSet_(analyzers, source.analyzer_values);
  target.analyzer_values = Array.from(analyzers).sort();

  if (!target._breakdownMap) target._breakdownMap = new Map();
  mergeStatusCounts_(target._breakdownMap, target.breakdown_status_counts);
  target.breakdown_status_counts = [];
  mergeStatusCounts_(target._breakdownMap, source.breakdown_status_counts);

  target.upload_status = toNumberSafe_(target.due_total_unique_shk) > 0 ? "Есть" : "Нет выгрузки";
  target.expensive_analyzed_percent = toNumberSafe_(target.expensive_due_total_unique_shk) > 0
    ? Math.round((toNumberSafe_(target.expensive_analyzed_due_unique_shk) / toNumberSafe_(target.expensive_due_total_unique_shk)) * 1000) / 10
    : 0;
  target.low_quality_status = target.low_quality_status || source.low_quality_status || "Ожидает обработки";
  target.day_adjustment = toNumberSafe_(source.day_adjustment || target.day_adjustment);
  target.low_quality_without_comment_percent = toNumberSafe_(target.due_total_unique_shk) > 0
    ? Math.round((toNumberSafe_(target.low_quality_without_comment_unique_shk) / toNumberSafe_(target.due_total_unique_shk)) * 1000) / 10
    : 0;

  return target;
}

function finalizeMergedTelegramDetail_(detail) {
  if (detail && detail._breakdownMap) {
    detail.breakdown_status_counts = mapStatusCountsToArray_(detail._breakdownMap);
    delete detail._breakdownMap;
  }
  detail.upload_status = toNumberSafe_(detail.due_total_unique_shk) > 0 ? "Есть" : "Нет выгрузки";
  detail.low_quality_status = detail.low_quality_status || "Ожидает обработки";
  detail.low_quality_without_comment_percent = toNumberSafe_(detail.due_total_unique_shk) > 0
    ? Math.round((toNumberSafe_(detail.low_quality_without_comment_unique_shk) / toNumberSafe_(detail.due_total_unique_shk)) * 1000) / 10
    : 0;
  return detail;
}

function mergeShiftDynamicsForTelegram_(shiftDynamics) {
  const groups = new Map();

  (Array.isArray(shiftDynamics) ? shiftDynamics : []).forEach((shift) => {
    const dateKey = String(shift.operational_date_key || shift.date || "").trim();
    if (!dateKey) return;

    if (!groups.has(dateKey)) {
      groups.set(dateKey, {
        shift_id: "shift:" + dateKey,
        shift_type: "shift",
        shift_name: "Смена",
        shift_label: formatDateKeyRu_(dateKey),
        shift_sort_ts: toNumberSafe_(shift.shift_sort_ts),
        operational_date_key: dateKey,
        operational_date_label: formatDateKeyRu_(dateKey),
        total_due_unique_shk: 0,
        analyzed_due_unique_shk: 0,
        total_due_sum_price: 0,
        analyzed_due_sum_price: 0,
        expensive_due_total_unique_shk: 0,
        expensive_analyzed_due_unique_shk: 0,
        expensive_analyzed_percent: 0,
        analyzer_values: [],
        breakdown_status_counts: [],
        analyzed_percent: 0,
        details: [],
        _detailsByKey: new Map(),
        _analyzers: new Set(),
        _breakdownMap: new Map()
      });
    }

    const group = groups.get(dateKey);
    group.shift_sort_ts = Math.min(
      group.shift_sort_ts || toNumberSafe_(shift.shift_sort_ts),
      toNumberSafe_(shift.shift_sort_ts) || group.shift_sort_ts
    );

    group.total_due_unique_shk += toNumberSafe_(shift.total_due_unique_shk);
    group.analyzed_due_unique_shk += toNumberSafe_(shift.analyzed_due_unique_shk);
    group.total_due_sum_price += toNumberSafe_(shift.total_due_sum_price);
    group.analyzed_due_sum_price += toNumberSafe_(shift.analyzed_due_sum_price);
    group.expensive_due_total_unique_shk += toNumberSafe_(shift.expensive_due_total_unique_shk);
    group.expensive_analyzed_due_unique_shk += toNumberSafe_(shift.expensive_analyzed_due_unique_shk);
    mergeTextArrayIntoSet_(group._analyzers, shift.analyzer_values);
    mergeStatusCounts_(group._breakdownMap, shift.breakdown_status_counts);

    (Array.isArray(shift.details) ? shift.details : []).forEach((detail) => {
      const detailKey = String(detail.key || detail.display_key || "").trim() || "unknown";
      if (!group._detailsByKey.has(detailKey)) {
        group._detailsByKey.set(detailKey, {
          key: detail.key || detailKey,
          display_key: detail.display_key || detailKey,
          sheet_names: [],
          day_adjustment: toNumberSafe_(detail.day_adjustment),
          due_for_date_label: detail.due_for_date_label || "",
          due_until_label: detail.due_until_label || "",
          due_total_unique_shk: 0,
          analyzed_due_unique_shk: 0,
          due_total_sum_price: 0,
          analyzed_due_sum_price: 0,
          expensive_due_total_unique_shk: 0,
          expensive_analyzed_due_unique_shk: 0,
          expensive_analyzed_percent: 0,
          low_quality_status: detail.low_quality_status || "Ожидает обработки",
          low_quality_without_comment_unique_shk: 0,
          low_quality_without_comment_percent: 0,
          analyzer_values: [],
          breakdown_status_counts: [],
          upload_status: "Нет выгрузки"
        });
      }
      mergeTelegramDetail_(group._detailsByKey.get(detailKey), detail);
    });
  });

  const result = [];
  groups.forEach((group) => {
    group.analyzer_values = Array.from(group._analyzers).sort();
    group.breakdown_status_counts = mapStatusCountsToArray_(group._breakdownMap);
    group.analyzed_percent = group.total_due_unique_shk > 0
      ? Math.round((group.analyzed_due_unique_shk / group.total_due_unique_shk) * 1000) / 10
      : 0;
    group.expensive_analyzed_percent = group.expensive_due_total_unique_shk > 0
      ? Math.round((group.expensive_analyzed_due_unique_shk / group.expensive_due_total_unique_shk) * 1000) / 10
      : 0;
    group.details = Array.from(group._detailsByKey.values())
      .map(finalizeMergedTelegramDetail_)
      .sort((a, b) => String(a.display_key || a.key || "").localeCompare(String(b.display_key || b.key || "")));

    delete group._detailsByKey;
    delete group._analyzers;
    delete group._breakdownMap;

    result.push(group);
  });

  return result.sort((a, b) => toNumberSafe_(b.shift_sort_ts) - toNumberSafe_(a.shift_sort_ts));
}

function buildOppTelegramCachePayload_(ss, tz, periodFrom, periodTo, options) {
  const opts = options || {};
  const deadlines = Array.isArray(opts.deadlines) && opts.deadlines.length
    ? opts.deadlines
    : getOppTelegramCacheDeadlines_(opts.settings);
  const report = buildUniqueShkReport_(ss, tz, {
    dateFrom: periodFrom,
    dateTo: periodTo,
    deadlines: deadlines,
    skipPeriodSheets: true,
    skipTodayDeadline: true,
    shiftCurrentOnly: Boolean(opts.shiftCurrentOnly)
  });

  const result = {
    ok: true,
    mode: "unique_shk_by_date",
    timezone: tz,
    generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    period: {
      from: report.period_from,
      to: report.period_to
    },
    sheets: PERIOD_SHEETS.map((s) => s.name),
    total_period_unique_shk: report.total_period_unique_shk,
    total_period_analyzed_unique_shk: report.total_period_analyzed_unique_shk,
    by_date: report.by_date,
    today_deadline: report.today_deadline,
    shift_dynamics: mergeShiftDynamicsForTelegram_(report.shift_dynamics),
    deadline_source_counts: report.deadline_source_counts || {},
    deadline_date_counts: report.deadline_date_counts || {},
    deadline_settings: buildOppTelegramDeadlineSettingsMeta_(deadlines),
    opp_24_export: buildOpp24ExportAnalytics_(ss, tz)
  };

  if (report.missing_sheets.length) {
    result.missing_sheets = report.missing_sheets;
  }

  return result;
}

function postOppTelegramCachePayload_(settings, cacheScope, dateFrom, dateTo, payload) {
  const response = UrlFetchApp.fetch(settings.ingestUrl, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      secret: settings.ingestSecret,
      wh_id: settings.whId,
      cache_scope: cacheScope,
      date_from: dateFrom,
      date_to: dateTo,
      ttl_minutes: settings.ttlMinutes,
      payload: payload
    })
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (err) {
    parsed = { raw: text };
  }

  if (status < 200 || status >= 300 || !parsed || parsed.ok === false) {
    throw new Error("Ошибка ingest " + cacheScope + ": HTTP " + status + " " + text);
  }

  return parsed;
}

function openOppTelegramCacheSpreadsheet_(settings) {
  return settings.spreadsheetId
    ? SpreadsheetApp.openById(settings.spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function pushOppTelegramShiftCacheToSupabase() {
  const settings = getOppTelegramCacheSettings_();
  const ss = openOppTelegramCacheSpreadsheet_(settings);
  const tz = ss.getSpreadsheetTimeZone() || "Europe/Moscow";
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const from = addDaysToDateKey_(today, -1, tz) || today;
  const deadlines = getOppTelegramCacheDeadlines_(settings);
  const payload = buildOppTelegramCachePayload_(ss, tz, from, today, {
    shiftCurrentOnly: true,
    settings: settings,
    deadlines: deadlines
  });

  return postOppTelegramCachePayload_(settings, "opp_telegram_shift", from, today, payload);
}

function pushOppTelegramRolling30CacheToSupabase() {
  const settings = getOppTelegramCacheSettings_();
  const ss = openOppTelegramCacheSpreadsheet_(settings);
  const tz = ss.getSpreadsheetTimeZone() || "Europe/Moscow";
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const from = addDaysToDateKey_(today, -29, tz) || today;
  const deadlines = getOppTelegramCacheDeadlines_(settings);
  const payload = buildOppTelegramCachePayload_(ss, tz, from, today, {
    shiftCurrentOnly: false,
    settings: settings,
    deadlines: deadlines
  });

  return postOppTelegramCachePayload_(settings, "opp_telegram_rolling30", from, today, payload);
}

function pushOppTelegramCacheToSupabase() {
  return {
    shift: pushOppTelegramShiftCacheToSupabase(),
    rolling30: pushOppTelegramRolling30CacheToSupabase()
  };
}

function setupOppTelegramCacheTriggers() {
  const handlers = [
    "pushOppTelegramShiftCacheToSupabase",
    "pushOppTelegramRolling30CacheToSupabase"
  ];

  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("pushOppTelegramShiftCacheToSupabase")
    .timeBased()
    .everyMinutes(30)
    .create();

  ScriptApp.newTrigger("pushOppTelegramRolling30CacheToSupabase")
    .timeBased()
    .atHour(5)
    .nearMinute(55)
    .everyDays(1)
    .inTimezone("Europe/Moscow")
    .create();

  ScriptApp.newTrigger("pushOppTelegramRolling30CacheToSupabase")
    .timeBased()
    .atHour(17)
    .nearMinute(20)
    .everyDays(1)
    .inTimezone("Europe/Moscow")
    .create();

  return {
    ok: true,
    handlers: handlers
  };
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
