/**
 * Google Apps Script Web API for box tracker rows.
 *
 * Source columns:
 * A - empty
 * B - date
 * C - box, unique identifier
 * D - shk_qty
 * E - empty
 * F - comment
 * G - analysis
 * H - analysis_status
 * I - error
 * J - guilty_id
 */

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || params.mode || "").trim();
    const spreadsheetId = String(params.spreadsheet_id || "").trim();
    const sheetName = String(params.sheet_name || "").trim();
    const startRow = Math.max(parseInt(String(params.start_row || "2"), 10) || 2, 1);

    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();

    if (!ss) {
      throw new Error("Не удалось открыть таблицу. Передайте spreadsheet_id или используйте bound script.");
    }

    const sheetNames = ss.getSheets().map(function (sheet) {
      return sheet.getName();
    });

    if (action === "list_sheets") {
      return jsonResponse_({
        ok: true,
        mode: "list_sheets",
        spreadsheet_id: ss.getId(),
        spreadsheet_name: ss.getName(),
        sheets: sheetNames
      });
    }

    const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
    if (!sheet) {
      throw new Error(sheetName
        ? 'Лист "' + sheetName + '" не найден. Доступные листы: ' + sheetNames.join(", ")
        : "В таблице нет доступных листов");
    }

    const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || "Europe/Moscow";
    const lastRow = sheet.getLastRow();

    if (lastRow < startRow) {
      return jsonResponse_({
        ok: true,
        mode: "box_tracker",
        generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        spreadsheet_id: ss.getId(),
        sheet_name: sheet.getName(),
        total_rows: 0,
        skipped_rows: [],
        rows: []
      });
    }

    const rowCount = lastRow - startRow + 1;
    const rawValues = sheet.getRange(startRow, 1, rowCount, 10).getValues();
    const displayValues = sheet.getRange(startRow, 1, rowCount, 10).getDisplayValues();
    const rows = [];
    const skippedRows = [];

    rawValues.forEach(function (rawRow, index) {
      const displayRow = displayValues[index] || [];
      const rowNumber = startRow + index;
      const date = normalizeDateCell_(rawRow[1], displayRow[1], tz);
      const box = normalizeText_(displayRow[2] || rawRow[2]);
      const shkQty = normalizeIntegerCell_(rawRow[3], displayRow[3]);
      const comment = normalizeText_(displayRow[5] || rawRow[5]);
      const analysis = normalizeText_(displayRow[6] || rawRow[6]);
      const analysisStatus = normalizeText_(displayRow[7] || rawRow[7]);
      const error = normalizeText_(displayRow[8] || rawRow[8]);
      const guiltyId = normalizeText_(displayRow[9] || rawRow[9]);

      const hasAnyValue = [date, box, shkQty, comment, analysis, analysisStatus, error, guiltyId].some(function (value) {
        return value !== null && value !== undefined && String(value).trim() !== "";
      });
      if (!hasAnyValue) return;

      if (!box) {
        skippedRows.push({
          row_number: rowNumber,
          reason: "missing_box"
        });
        return;
      }

      rows.push({
        date: date || null,
        box: box,
        shk_qty: shkQty,
        comment: comment,
        analysis: analysis,
        analysis_status: analysisStatus,
        error: error,
        guilty_id: guiltyId,
        source_sheet: sheet.getName(),
        source_row_number: rowNumber
      });
    });

    return jsonResponse_({
      ok: true,
      mode: "box_tracker",
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

  let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s|$)/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return year + "-" + pad2_(match[2]) + "-" + pad2_(match[1]);
  }

  match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s|$)/);
  if (match) {
    return match[1] + "-" + pad2_(match[2]) + "-" + pad2_(match[3]);
  }

  return "";
}

function normalizeIntegerCell_(rawValue, displayValue) {
  if (typeof rawValue === "number" && isFinite(rawValue)) {
    return Math.trunc(rawValue);
  }

  const text = normalizeText_(displayValue || rawValue)
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");

  if (!text) return null;

  const parsed = Number(text.replace(/\.(?=.*\.)/g, ""));
  return isFinite(parsed) ? Math.trunc(parsed) : null;
}

function pad2_(value) {
  return String(value).padStart(2, "0");
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
