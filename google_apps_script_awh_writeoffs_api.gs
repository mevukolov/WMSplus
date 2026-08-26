/**
 * Google Apps Script Web API for AWH writeoff rows.
 *
 * Source spreadsheet can be external: deploy this script separately as a Web App
 * and pass spreadsheet_id in query params.
 *
 * Reads every sheet whose name starts with "Списание" and keeps only rows where
 * B (ЛО) equals "СЦ Нижний Новгород Ларина".
 *
 * Source columns:
 * A - status
 * B - LO
 * C - waybill
 * D - box, unique identifier
 * E - shk_qty
 * F - unload_time_lo
 * G - car_number
 * H - price
 * I - acceptance_time_lo
 * J - acceptance_employee_id
 * K - writeoff_reason
 * L - comment
 * M - material_link
 * N - revision_comment
 */

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var action = normalizeText_(params.action || params.mode);
    var spreadsheetId = normalizeText_(params.spreadsheet_id);
    var sheetPrefix = normalizeText_(params.sheet_prefix) || "Списание";
    var loFilter = normalizeText_(params.lo || params.lo_filter) || "СЦ Нижний Новгород Ларина";
    var startRow = Math.max(parseInt(String(params.start_row || "2"), 10) || 2, 1);
    var expectedSecret = normalizeText_(PropertiesService.getScriptProperties().getProperty("AWH_WRITEOFFS_API_SECRET"));

    if (expectedSecret && normalizeText_(params.secret) !== expectedSecret) {
      throw new Error("Invalid Apps Script secret");
    }

    var ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();

    if (!ss) {
      throw new Error("Не удалось открыть таблицу. Передайте spreadsheet_id или используйте bound script.");
    }

    var sheets = ss.getSheets();
    var sheetNames = sheets.map(function (sheet) {
      return sheet.getName();
    });
    var matchedSheets = sheets.filter(function (sheet) {
      return sheet.getName().indexOf(sheetPrefix) === 0;
    });

    if (action === "list_sheets") {
      return jsonResponse_({
        ok: true,
        mode: "list_sheets",
        spreadsheet_id: ss.getId(),
        spreadsheet_name: ss.getName(),
        sheet_prefix: sheetPrefix,
        sheets: sheetNames,
        matched_sheets: matchedSheets.map(function (sheet) { return sheet.getName(); })
      });
    }

    var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || "Europe/Moscow";
    var rows = [];
    var skippedRows = [];

    matchedSheets.forEach(function (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < startRow) return;

      var rowCount = lastRow - startRow + 1;
      var rawValues = sheet.getRange(startRow, 1, rowCount, 14).getValues();
      var displayValues = sheet.getRange(startRow, 1, rowCount, 14).getDisplayValues();

      rawValues.forEach(function (rawRow, index) {
        var displayRow = displayValues[index] || [];
        var rowNumber = startRow + index;
        var lo = normalizeText_(displayRow[1] || rawRow[1]);
        var box = normalizeText_(displayRow[3] || rawRow[3]);

        var hasAnyValue = displayRow.some(function (value) {
          return normalizeText_(value) !== "";
        });
        if (!hasAnyValue) return;

        if (lo !== loFilter) return;

        if (!box) {
          skippedRows.push({
            sheet_name: sheet.getName(),
            row_number: rowNumber,
            reason: "missing_box"
          });
          return;
        }

        rows.push({
          status: normalizeText_(displayRow[0] || rawRow[0]),
          lo: lo,
          waybill: normalizeText_(displayRow[2] || rawRow[2]),
          box: box,
          shk_qty: normalizeIntegerCell_(rawRow[4], displayRow[4]),
          unload_time_lo: normalizeDateTimeCell_(rawRow[5], displayRow[5], tz),
          unload_time_lo_label: normalizeText_(displayRow[5] || rawRow[5]),
          car_number: normalizeText_(displayRow[6] || rawRow[6]),
          price: normalizeNumberCell_(rawRow[7], displayRow[7]),
          price_label: normalizeText_(displayRow[7] || rawRow[7]),
          acceptance_time_lo: normalizeDateTimeCell_(rawRow[8], displayRow[8], tz),
          acceptance_time_lo_label: normalizeText_(displayRow[8] || rawRow[8]),
          acceptance_employee_id: normalizeText_(displayRow[9] || rawRow[9]),
          writeoff_reason: normalizeText_(displayRow[10] || rawRow[10]),
          comment: normalizeText_(displayRow[11] || rawRow[11]),
          material_link: normalizeText_(displayRow[12] || rawRow[12]),
          revision_comment: normalizeText_(displayRow[13] || rawRow[13]),
          source_sheet: sheet.getName(),
          source_row_number: rowNumber
        });
      });
    });

    return jsonResponse_({
      ok: true,
      mode: "awh_writeoffs",
      generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      spreadsheet_id: ss.getId(),
      spreadsheet_name: ss.getName(),
      sheet_prefix: sheetPrefix,
      lo_filter: loFilter,
      matched_sheets: matchedSheets.map(function (sheet) { return sheet.getName(); }),
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

function normalizeIntegerCell_(rawValue, displayValue) {
  var numberValue = normalizeNumberCell_(rawValue, displayValue);
  return numberValue === null ? null : Math.trunc(numberValue);
}

function normalizeNumberCell_(rawValue, displayValue) {
  if (typeof rawValue === "number" && isFinite(rawValue)) {
    return rawValue;
  }

  var text = normalizeText_(displayValue || rawValue)
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");

  if (!text) return null;

  var parsed = Number(text.replace(/\.(?=.*\.)/g, ""));
  return isFinite(parsed) ? parsed : null;
}

function normalizeDateTimeCell_(rawValue, displayValue, tz) {
  if (Object.prototype.toString.call(rawValue) === "[object Date]" && !isNaN(rawValue.getTime())) {
    return Utilities.formatDate(rawValue, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  var text = normalizeText_(displayValue || rawValue);
  if (!text) return "";

  var isoLike = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?)?(?:\s*([+-]\d{2}:?\d{2}|Z))?/);
  if (isoLike) {
    var timePart = isoLike[4]
      ? "T" + pad2_(isoLike[4]) + ":" + pad2_(isoLike[5]) + ":" + pad2_(isoLike[6] || "0")
      : "T00:00:00";
    var zonePart = isoLike[7] || "";
    if (zonePart && /^[-+]\d{4}$/.test(zonePart)) {
      zonePart = zonePart.slice(0, 3) + ":" + zonePart.slice(3);
    }
    return isoLike[1] + "-" + pad2_(isoLike[2]) + "-" + pad2_(isoLike[3]) + timePart + zonePart;
  }

  var ruLike = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ruLike) {
    var year = Number(ruLike[3]);
    if (year < 100) year += 2000;
    return year + "-" + pad2_(ruLike[2]) + "-" + pad2_(ruLike[1])
      + "T" + pad2_(ruLike[4] || "0") + ":" + pad2_(ruLike[5] || "0") + ":" + pad2_(ruLike[6] || "0");
  }

  return text;
}

function pad2_(value) {
  return String(value).padStart(2, "0");
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
