/**
 * Google Apps Script Web API for PM mistakes.
 *
 * Source columns:
 * A - date_logged
 * B - shk
 * C - route number
 * D - date
 * E - emp
 *
 * Output rows are already normalized for public.mistakes_rep.
 */

const PM_DEFAULTS = {
  emp_workplace: "ПМ",
  mistake: "Бессистемная отгрузка передачи ПМ",
  emp_logger: "2405"
};

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const spreadsheetId = String(params.spreadsheet_id || "").trim();
    const sheetName = String(params.sheet_name || "").trim();
    const startRow = Math.max(parseInt(String(params.start_row || "2"), 10) || 2, 1);

    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();

    if (!ss) {
      throw new Error("Не удалось открыть таблицу. Передайте spreadsheet_id или используйте bound script.");
    }

    const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
    if (!sheet) {
      throw new Error(sheetName ? `Лист "${sheetName}" не найден` : "В таблице нет доступных листов");
    }

    const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || "Europe/Moscow";
    const lastRow = sheet.getLastRow();

    if (lastRow < startRow) {
      return jsonResponse_({
        ok: true,
        mode: "mistakes_pm",
        generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        spreadsheet_id: ss.getId(),
        sheet_name: sheet.getName(),
        total_rows: 0,
        skipped_rows: [],
        rows: []
      });
    }

    const rowCount = lastRow - startRow + 1;
    const rawValues = sheet.getRange(startRow, 1, rowCount, 5).getValues();
    const displayValues = sheet.getRange(startRow, 1, rowCount, 5).getDisplayValues();

    const rows = [];
    const skippedRows = [];

    rawValues.forEach((rawRow, index) => {
      const displayRow = displayValues[index] || [];
      const rowNumber = startRow + index;

      const dateLogged = normalizeDateCell_(rawRow[0], displayRow[0], tz);
      const shk = normalizeText_(displayRow[1]);
      const route = normalizeText_(displayRow[2]);
      const mistakeDate = normalizeDateCell_(rawRow[3], displayRow[3], tz);
      const emp = normalizeText_(displayRow[4]);

      const hasAnyValue = [dateLogged, shk, route, mistakeDate, emp].some(Boolean);
      if (!hasAnyValue) return;

      if (!dateLogged || !shk || !route || !mistakeDate || !emp) {
        skippedRows.push({
          row_number: rowNumber,
          reason: "missing_required_value"
        });
        return;
      }

      rows.push({
        emp: emp,
        emp_workplace: PM_DEFAULTS.emp_workplace,
        mistake: PM_DEFAULTS.mistake,
        date: mistakeDate,
        shk: shk,
        emp_logger: PM_DEFAULTS.emp_logger,
        logger_comment: `Маршрут: ${route}`,
        date_logged: dateLogged,
        source_sheet: sheet.getName(),
        source_row_number: rowNumber
      });
    });

    return jsonResponse_({
      ok: true,
      mode: "mistakes_pm",
      generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      spreadsheet_id: ss.getId(),
      sheet_name: sheet.getName(),
      total_rows: rows.length,
      skipped_rows: skippedRows,
      rows: rows
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function normalizeText_(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDateCell_(rawValue, displayValue, tz) {
  if (Object.prototype.toString.call(rawValue) === "[object Date]" && !isNaN(rawValue.getTime())) {
    return Utilities.formatDate(rawValue, tz, "yyyy-MM-dd");
  }

  const text = normalizeText_(displayValue || rawValue);
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s|$)/);
  if (match) {
    const day = pad2_(match[1]);
    const month = pad2_(match[2]);
    return `${match[3]}-${month}-${day}`;
  }

  match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s|$)/);
  if (match) {
    const month = pad2_(match[2]);
    const day = pad2_(match[3]);
    return `${match[1]}-${month}-${day}`;
  }

  return "";
}

function pad2_(value) {
  return String(value).padStart(2, "0");
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
