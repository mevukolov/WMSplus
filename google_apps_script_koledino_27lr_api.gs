/**
 * Google Apps Script Web API for "Коледино + 27LR" requests.
 *
 * Source columns on sheet "Нижний Ларина":
 * A - shk, unique identifier
 * B - tare
 * C - layout_block
 * D - price
 * E - layout_date
 * F - writeoff_date
 * G - attachment/verdict
 * H - movement_where
 * I - status
 * J - loss_reason
 * K - link
 * L - comment
 */

var KOLEDINO_27LR_DEFAULT_SPREADSHEET_ID = "1R49a_7kcsk8cjBfv6GenN5B3e92iTvjYDpUl5wzpimE";
var KOLEDINO_27LR_DEFAULT_SHEET_NAME = "Нижний Ларина";
var KOLEDINO_27LR_NO_REVIEW_VERDICT = "Нет разбора";

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    checkSecret_(params.secret);

    var action = normalizeText_(params.action || params.mode);
    var spreadsheetId = normalizeText_(params.spreadsheet_id) || KOLEDINO_27LR_DEFAULT_SPREADSHEET_ID;
    var sheetName = normalizeText_(params.sheet_name) || KOLEDINO_27LR_DEFAULT_SHEET_NAME;
    var startRow = Math.max(parseInt(String(params.start_row || "2"), 10) || 2, 1);
    var lookbackDays = Math.max(parseInt(String(params.lookback_days || "14"), 10) || 14, 0);

    var ss = SpreadsheetApp.openById(spreadsheetId);
    if (!ss) throw new Error("Не удалось открыть таблицу " + spreadsheetId);

    var sheets = ss.getSheets();
    var sheetNames = sheets.map(function (sheet) { return sheet.getName(); });
    if (action === "list_sheets") {
      return jsonResponse_({
        ok: true,
        mode: "list_sheets",
        spreadsheet_id: ss.getId(),
        spreadsheet_name: ss.getName(),
        sheets: sheetNames
      });
    }

    var sheet = findSheetByName_(ss, sheetName);
    if (!sheet) throw new Error('Лист "' + sheetName + '" не найден. Доступные листы: ' + sheetNames.join(", "));

    var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || "Europe/Moscow";
    var minLayoutDate = addDaysToIsoDate_(todayIsoDate_(tz), -lookbackDays);
    var lastRow = sheet.getLastRow();
    if (lastRow < startRow) {
      return jsonResponse_({
        ok: true,
        mode: "koledino_27lr",
        generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        spreadsheet_id: ss.getId(),
        sheet_name: sheet.getName(),
        min_layout_date: minLayoutDate,
        total_rows: 0,
        duplicate_rows: [],
        skipped_rows: [],
        rows: []
      });
    }

    var rowCount = lastRow - startRow + 1;
    var rawValues = sheet.getRange(startRow, 1, rowCount, 12).getValues();
    var displayValues = sheet.getRange(startRow, 1, rowCount, 12).getDisplayValues();
    var seenShk = {};
    var rows = [];
    var skippedRows = [];
    var duplicateRows = [];

    rawValues.forEach(function (rawRow, index) {
      var displayRow = displayValues[index] || [];
      var rowNumber = startRow + index;
      var shk = normalizeText_(displayRow[0] || rawRow[0]);
      var tare = normalizeText_(displayRow[1] || rawRow[1]);
      var layoutBlock = normalizeText_(displayRow[2] || rawRow[2]);
      var price = normalizeNumberCell_(rawRow[3], displayRow[3]);
      var priceLabel = normalizeText_(displayRow[3] || rawRow[3]);
      var layoutDate = normalizeDateCell_(rawRow[4], displayRow[4], tz);
      var layoutDateLabel = normalizeText_(displayRow[4] || rawRow[4]);
      var writeoffDate = normalizeDateCell_(rawRow[5], displayRow[5], tz);
      var writeoffDateLabel = normalizeText_(displayRow[5] || rawRow[5]);
      var attachment = normalizeText_(displayRow[6] || rawRow[6]);
      var movementWhere = normalizeText_(displayRow[7] || rawRow[7]);
      var status = normalizeText_(displayRow[8] || rawRow[8]);
      var lossReason = normalizeText_(displayRow[9] || rawRow[9]);
      var link = normalizeText_(displayRow[10] || rawRow[10]);
      var comment = normalizeText_(displayRow[11] || rawRow[11]);

      var hasAnyValue = displayRow.some(function (value) { return normalizeText_(value) !== ""; });
      if (!hasAnyValue) return;

      if (!shk) {
        skippedRows.push({ row_number: rowNumber, reason: "missing_shk" });
        return;
      }

      if (!layoutDate) {
        skippedRows.push({ row_number: rowNumber, shk: shk, reason: "missing_layout_date" });
        return;
      }

      if (layoutDate < minLayoutDate) {
        skippedRows.push({ row_number: rowNumber, shk: shk, reason: "layout_date_before_window", layout_date: layoutDate });
        return;
      }

      var seenKey = shk.toLowerCase();
      if (seenShk[seenKey]) {
        duplicateRows.push({ row_number: rowNumber, shk: shk });
        return;
      }
      seenShk[seenKey] = true;

      if (attachment && normalizeForMatch_(attachment) !== normalizeForMatch_(KOLEDINO_27LR_NO_REVIEW_VERDICT)) {
        skippedRows.push({ row_number: rowNumber, shk: shk, reason: "already_has_attachment", attachment: attachment });
        return;
      }

      rows.push({
        shk: shk,
        tare: tare,
        layout_block: layoutBlock,
        price: price,
        price_label: priceLabel,
        layout_date: layoutDate,
        layout_date_label: layoutDateLabel,
        writeoff_date: writeoffDate,
        writeoff_date_label: writeoffDateLabel,
        attachment: attachment,
        movement_where: movementWhere,
        status: status,
        loss_reason: lossReason,
        link: link,
        comment: comment,
        source_sheet: sheet.getName(),
        source_row_number: rowNumber,
        spreadsheet_id: ss.getId()
      });
    });

    return jsonResponse_({
      ok: true,
      mode: "koledino_27lr",
      generated_at: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      spreadsheet_id: ss.getId(),
      spreadsheet_name: ss.getName(),
      sheet_name: sheet.getName(),
      lookback_days: lookbackDays,
      min_layout_date: minLayoutDate,
      total_rows: rows.length,
      duplicate_rows: duplicateRows,
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

    var spreadsheetId = normalizeText_(body.spreadsheet_id) || KOLEDINO_27LR_DEFAULT_SPREADSHEET_ID;
    var sheetName = normalizeText_(body.sheet_name) || KOLEDINO_27LR_DEFAULT_SHEET_NAME;
    var rowNumber = Math.trunc(Number(body.row_number || body.source_row_number || 0));
    var shk = normalizeText_(body.requested_shk || body.shk || body.source_id);
    var attachment = normalizeText_(body.attachment || body.verdict || body.inclusion);
    var commentWithLinks = normalizeText_(body.comment || body.opp_comment);
    var allowOverwrite = normalizeBoolean_(body.allow_overwrite, false);

    if (!rowNumber || rowNumber < 1) throw new Error("row_number is required");
    if (!shk) throw new Error("requested_shk is required");
    if (!attachment) throw new Error("attachment/verdict is required");
    if (!commentWithLinks) throw new Error("comment is required");

    var mappedAttachment = mapAttachmentForSheet_(attachment);
    var splitComment = splitCommentAndLinks_(commentWithLinks);

    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = findSheetByName_(ss, sheetName);
    if (!sheet) throw new Error('Лист "' + sheetName + '" не найден');

    var rowShk = normalizeText_(sheet.getRange(rowNumber, 1).getDisplayValue());
    if (rowShk !== shk) {
      throw new Error("Защита от неверной строки: в A" + rowNumber + " находится " + rowShk + ", ожидался " + shk);
    }

    var existingAttachment = normalizeText_(sheet.getRange(rowNumber, 7).getDisplayValue());
    var existingLink = normalizeText_(sheet.getRange(rowNumber, 11).getDisplayValue());
    var existingComment = normalizeText_(sheet.getRange(rowNumber, 12).getDisplayValue());
    var sameValues = existingAttachment === mappedAttachment && existingLink === splitComment.links && existingComment === splitComment.comment;
    var canReplaceNoReview = normalizeForMatch_(existingAttachment) === normalizeForMatch_(KOLEDINO_27LR_NO_REVIEW_VERDICT);

    if (existingAttachment && !canReplaceNoReview && !allowOverwrite && !sameValues) {
      throw new Error("Строка " + rowNumber + " уже заполнена в столбце G: " + existingAttachment);
    }

    if (sameValues) {
      return jsonResponse_({ ok: true, action: "update_result", skipped: true, reason: "already_written", row_number: rowNumber, shk: shk });
    }

    sheet.getRange(rowNumber, 7).setValue(mappedAttachment);
    sheet.getRange(rowNumber, 11, 1, 2).setValues([[splitComment.links, splitComment.comment]]);
    SpreadsheetApp.flush();

    return jsonResponse_({
      ok: true,
      action: "update_result",
      row_number: rowNumber,
      shk: shk,
      written_range: "G" + rowNumber + ",K" + rowNumber + ":L" + rowNumber,
      written_values: {
        attachment: mappedAttachment,
        link: splitComment.links,
        comment: splitComment.comment,
        source_attachment: attachment
      }
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function checkSecret_(providedSecret) {
  var expectedSecret = normalizeText_(PropertiesService.getScriptProperties().getProperty("KOLEDINO_27LR_API_SECRET"));
  if (expectedSecret && normalizeText_(providedSecret) !== expectedSecret) {
    throw new Error("Invalid Apps Script secret");
  }
}

function findSheetByName_(ss, sheetName) {
  var direct = ss.getSheetByName(sheetName);
  if (direct) return direct;
  var expected = normalizeText_(sheetName);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i += 1) {
    if (normalizeText_(sheets[i].getName()) === expected) return sheets[i];
  }
  return null;
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

function mapAttachmentForSheet_(value) {
  var normalized = normalizeForMatch_(value);
  var map = {
    "вложено верно": "Верное вложение",
    "вложено неверно": "Не верное вложение",
    "отправлен под пустым стикером": "Ошибка сотрудника",
    "некорректный запрос": "Ошибка сотрудника"
  };
  return map[normalized] || value;
}

function splitCommentAndLinks_(value) {
  var text = normalizeText_(value);
  var links = [];
  var linkRegex = /https?:\/\/[^\s,;]+/gi;
  var match;
  while ((match = linkRegex.exec(text)) !== null) {
    links.push(match[0].replace(/[.)\]]+$/g, ""));
  }
  var comment = text.replace(linkRegex, " ").replace(/\s+/g, " ").trim();
  return {
    links: unique_(links).join("\n"),
    comment: comment
  };
}

function unique_(items) {
  var seen = {};
  var result = [];
  items.forEach(function (item) {
    var key = normalizeText_(item);
    if (!key || seen[key]) return;
    seen[key] = true;
    result.push(key);
  });
  return result;
}

function normalizeText_(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeForMatch_(value) {
  return normalizeText_(value).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function normalizeBoolean_(value, fallbackValue) {
  if (value === null || value === undefined || value === "") return fallbackValue;
  if (typeof value === "boolean") return value;
  var raw = normalizeForMatch_(value);
  if (["1", "true", "yes", "y", "да"].indexOf(raw) !== -1) return true;
  if (["0", "false", "no", "n", "нет"].indexOf(raw) !== -1) return false;
  return fallbackValue;
}

function normalizeNumberCell_(rawValue, displayValue) {
  if (typeof rawValue === "number" && isFinite(rawValue)) return rawValue;

  var text = normalizeText_(displayValue || rawValue)
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");

  if (!text) return null;
  var parsed = Number(text.replace(/\.(?=.*\.)/g, ""));
  return isFinite(parsed) ? parsed : null;
}

function normalizeDateCell_(rawValue, displayValue, tz) {
  if (Object.prototype.toString.call(rawValue) === "[object Date]" && !isNaN(rawValue.getTime())) {
    return Utilities.formatDate(rawValue, tz, "yyyy-MM-dd");
  }

  var text = normalizeText_(displayValue || rawValue);
  if (!text) return "";

  var isoLike = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s|T|$)/);
  if (isoLike) return isoLike[1] + "-" + pad2_(isoLike[2]) + "-" + pad2_(isoLike[3]);

  var ruLike = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s|T|$)/);
  if (ruLike) {
    var year = Number(ruLike[3]);
    if (year < 100) year += 2000;
    return year + "-" + pad2_(ruLike[2]) + "-" + pad2_(ruLike[1]);
  }

  return "";
}

function todayIsoDate_(tz) {
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
}

function addDaysToIsoDate_(isoDate, days) {
  var parts = isoDate.split("-");
  var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  date.setDate(date.getDate() + days);
  return date.getFullYear() + "-" + pad2_(date.getMonth() + 1) + "-" + pad2_(date.getDate());
}

function pad2_(value) {
  return String(value).padStart(2, "0");
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
