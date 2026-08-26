/**
 * Google Apps Script Web API for incoming flow requests.
 *
 * Source columns:
 * A - timestamp
 * B - sender_employee_id
 * C - sender_lo
 * D - requested_shk, unique identifier
 * E - sample_shk
 * F - tare
 * G - empty
 * H - verdict
 * I - comment
 * J - opp_employee (legacy, this API does not write it)
 * K - guilty_id (legacy, this API does not write it)
 */

var INCOMING_FLOW_DEFAULT_SPREADSHEET_ID = "1SvVyOHCaceVs0KQznXPvSMtcynMAL165_F0I_6adJB0";
var INCOMING_FLOW_DEFAULT_SHEET_NAME = "Проверка корректности вложения в тару";

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    checkSecret_(params.secret);

    var action = normalizeText_(params.action || params.mode);
    var spreadsheetId = normalizeText_(params.spreadsheet_id) || INCOMING_FLOW_DEFAULT_SPREADSHEET_ID;
    var sheetName = normalizeText_(params.sheet_name) || INCOMING_FLOW_DEFAULT_SHEET_NAME;
    var startRow = Math.max(parseInt(String(params.start_row || "2"), 10) || 2, 1);
    var markDuplicates = normalizeBoolean_(params.mark_duplicates, true);

    var ss = SpreadsheetApp.openById(spreadsheetId);
    if (!ss) throw new Error("Не удалось открыть таблицу " + spreadsheetId);

    var sheetNames = ss.getSheets().map(function (sheet) { return sheet.getName(); });
    if (action === "list_sheets") {
      return jsonResponse_({
        ok: true,
        mode: "list_sheets",
        spreadsheet_id: ss.getId(),
        spreadsheet_name: ss.getName(),
        sheets: sheetNames
      });
    }

    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Лист "' + sheetName + '" не найден. Доступные листы: ' + sheetNames.join(", "));

    var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || "Europe/Moscow";
    var lastRow = sheet.getLastRow();
    if (lastRow < startRow) {
      return jsonResponse_({
        ok: true,
        mode: "incoming_flow_requests",
        generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        spreadsheet_id: ss.getId(),
        sheet_name: sheet.getName(),
        total_rows: 0,
        duplicate_rows: [],
        skipped_rows: [],
        rows: []
      });
    }

    var rowCount = lastRow - startRow + 1;
    var rawValues = sheet.getRange(startRow, 1, rowCount, 11).getValues();
    var displayValues = sheet.getRange(startRow, 1, rowCount, 11).getDisplayValues();
    var seenShk = {};
    var rows = [];
    var skippedRows = [];
    var duplicateRows = [];

    rawValues.forEach(function (rawRow, index) {
      var displayRow = displayValues[index] || [];
      var rowNumber = startRow + index;
      var timestamp = normalizeDateTimeCell_(rawRow[0], displayRow[0], tz);
      var timestampLabel = normalizeText_(displayRow[0] || rawRow[0]);
      var senderEmployeeId = normalizeText_(displayRow[1] || rawRow[1]);
      var senderLo = normalizeText_(displayRow[2] || rawRow[2]);
      var requestedShk = normalizeText_(displayRow[3] || rawRow[3]);
      var sampleShk = normalizeText_(displayRow[4] || rawRow[4]);
      var tare = normalizeText_(displayRow[5] || rawRow[5]);
      var verdict = normalizeText_(displayRow[7] || rawRow[7]);
      var comment = normalizeText_(displayRow[8] || rawRow[8]);
      var oppEmployee = normalizeText_(displayRow[9] || rawRow[9]);
      var guiltyId = normalizeText_(displayRow[10] || rawRow[10]);

      var hasAnyValue = [timestampLabel, senderEmployeeId, senderLo, requestedShk, sampleShk, tare, verdict, comment, oppEmployee, guiltyId].some(function (value) {
        return normalizeText_(value) !== "";
      });
      if (!hasAnyValue) return;

      if (!requestedShk) {
        skippedRows.push({ row_number: rowNumber, reason: "missing_requested_shk" });
        return;
      }

      var seenKey = requestedShk.toLowerCase();
      if (verdict) {
        seenShk[seenKey] = true;
        skippedRows.push({ row_number: rowNumber, requested_shk: requestedShk, reason: "already_has_verdict" });
        return;
      }

      if (seenShk[seenKey]) {
        duplicateRows.push({ row_number: rowNumber, requested_shk: requestedShk });
        if (markDuplicates) {
          sheet.getRange(rowNumber, 8).setValue("Дубль");
        }
        return;
      }

      seenShk[seenKey] = true;
      rows.push({
        request_time: timestamp || null,
        request_time_label: timestampLabel,
        sender_employee_id: senderEmployeeId,
        sender_lo: senderLo,
        requested_shk: requestedShk,
        sample_shk: sampleShk,
        tare: tare,
        verdict: verdict,
        comment: comment,
        opp_employee: oppEmployee,
        guilty_id: guiltyId,
        source_sheet: sheet.getName(),
        source_row_number: rowNumber,
        spreadsheet_id: ss.getId()
      });
    });

    return jsonResponse_({
      ok: true,
      mode: "incoming_flow_requests",
      generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      spreadsheet_id: ss.getId(),
      spreadsheet_name: ss.getName(),
      sheet_name: sheet.getName(),
      total_rows: rows.length,
      duplicate_rows: duplicateRows,
      duplicates_marked: markDuplicates ? duplicateRows.length : 0,
      skipped_rows: skippedRows,
      rows: rows
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    var body = parsePostBody_(e);
    checkSecret_(body.secret);

    var action = normalizeText_(body.action || body.mode) || "update_result";
    if (action !== "update_result") throw new Error("Unknown action: " + action);

    var spreadsheetId = normalizeText_(body.spreadsheet_id) || INCOMING_FLOW_DEFAULT_SPREADSHEET_ID;
    var sheetName = normalizeText_(body.sheet_name) || INCOMING_FLOW_DEFAULT_SHEET_NAME;
    var rowNumber = Math.trunc(Number(body.row_number || body.source_row_number || 0));
    var requestedShk = normalizeText_(body.requested_shk || body.shk || body.source_id);
    var attachment = normalizeText_(body.attachment || body.verdict || body.inclusion);
    var comment = normalizeText_(body.comment || body.opp_comment);
    var allowOverwrite = normalizeBoolean_(body.allow_overwrite, false);

    if (!rowNumber || rowNumber < 1) throw new Error("row_number is required");
    if (!requestedShk) throw new Error("requested_shk is required");
    if (!attachment) throw new Error("attachment/verdict is required");
    if (!comment) throw new Error("comment is required");

    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Лист "' + sheetName + '" не найден');

    var rowShk = normalizeText_(sheet.getRange(rowNumber, 4).getDisplayValue());
    if (rowShk !== requestedShk) {
      throw new Error("Защита от неверной строки: в D" + rowNumber + " находится " + rowShk + ", ожидался " + requestedShk);
    }

    var existing = sheet.getRange(rowNumber, 8, 1, 2).getDisplayValues()[0] || [];
    var existingVerdict = normalizeText_(existing[0]);
    var existingComment = normalizeText_(existing[1]);
    var sameValues = existingVerdict === attachment && existingComment === comment;

    if ((existingVerdict || existingComment) && !allowOverwrite && !sameValues) {
      throw new Error("Строка " + rowNumber + " уже заполнена в столбце H: " + existingVerdict);
    }

    if (sameValues) {
      return jsonResponse_({ ok: true, action: "update_result", skipped: true, reason: "already_written", row_number: rowNumber, requested_shk: requestedShk });
    }

    sheet.getRange(rowNumber, 8, 1, 2).setValues([[
      attachment,
      comment
    ]]);
    SpreadsheetApp.flush();

    return jsonResponse_({
      ok: true,
      action: "update_result",
      row_number: rowNumber,
      requested_shk: requestedShk,
      written_range: "H" + rowNumber + ":I" + rowNumber,
      written_values: {
        verdict: attachment,
        comment: comment
      }
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function checkSecret_(providedSecret) {
  var expectedSecret = normalizeText_(PropertiesService.getScriptProperties().getProperty("INCOMING_FLOW_REQUESTS_API_SECRET"));
  if (expectedSecret && normalizeText_(providedSecret) !== expectedSecret) {
    throw new Error("Invalid Apps Script secret");
  }
}

function parsePostBody_(e) {
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    throw new Error("POST body must be JSON");
  }
}

function normalizeText_(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeBoolean_(value, fallbackValue) {
  if (value === null || value === undefined || value === "") return fallbackValue;
  if (typeof value === "boolean") return value;
  var raw = normalizeText_(value).toLowerCase();
  if (["1", "true", "yes", "y", "да"].indexOf(raw) !== -1) return true;
  if (["0", "false", "no", "n", "нет"].indexOf(raw) !== -1) return false;
  return fallbackValue;
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
    if (zonePart && /^[-+]\d{4}$/.test(zonePart)) zonePart = zonePart.slice(0, 3) + ":" + zonePart.slice(3);
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
