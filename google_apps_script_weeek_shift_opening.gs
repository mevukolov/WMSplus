/**
 * Google Apps Script Web App для iframe "Открытие смены".
 * HTML вызывает эти функции через google.script.run, а запись в Supabase идет через Edge Function.
 */

var SHIFT_OPENING_DEFAULT_WH_ID = '50144199';
var SHIFT_OPENING_DEFAULT_FUNCTION_URL = 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-shift-opening';

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var token = normalizeShiftOpeningText_(params.token);
  if (!shiftOpeningHasAccess_(token)) {
    return HtmlService.createHtmlOutput('Доступ запрещен').setTitle('Открытие смены');
  }

  var template = HtmlService.createTemplateFromFile('WeeekShiftOpening');
  template.initialConfig = {
    token: token,
    wh_id: normalizeShiftOpeningText_(params.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID
  };

  return template
    .evaluate()
    .setTitle('Открытие смены')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getShiftOpeningState(request) {
  var req = request && typeof request === 'object' ? request : {};
  shiftOpeningAssertAccess_(normalizeShiftOpeningText_(req.token));

  return shiftOpeningCallFunction_({
    action: 'get_state',
    wh_id: normalizeShiftOpeningText_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    shift_date: normalizeShiftOpeningText_(req.shift_date)
  });
}

function previewPureLossesUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  shiftOpeningAssertAccess_(normalizeShiftOpeningText_(req.token));

  return shiftOpeningCallFunction_({
    action: 'preview_pure_losses_import',
    wh_id: normalizeShiftOpeningText_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    shift_date: normalizeShiftOpeningText_(req.shift_date),
    file_name: normalizeShiftOpeningText_(req.file_name),
    pure_losses_rows: Array.isArray(req.pure_losses_rows) ? req.pure_losses_rows : []
  });
}

function openWeeekShift(request) {
  var req = request && typeof request === 'object' ? request : {};
  shiftOpeningAssertAccess_(normalizeShiftOpeningText_(req.token));

  return shiftOpeningCallFunction_({
    action: 'open_shift',
    wh_id: normalizeShiftOpeningText_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    shift_date: normalizeShiftOpeningText_(req.shift_date),
    incoming_employee_id: normalizeShiftOpeningText_(req.incoming_employee_id),
    outgoing_employee_id: normalizeShiftOpeningText_(req.outgoing_employee_id),
    file_uploaded: req.file_uploaded === true,
    file_name: normalizeShiftOpeningText_(req.file_name),
    pure_losses_rows: Array.isArray(req.pure_losses_rows) ? req.pure_losses_rows : [],
    opened_by: normalizeShiftOpeningText_(req.opened_by),
    source: 'iframe',
    payload: req.payload && typeof req.payload === 'object' ? req.payload : {}
  });
}

function shiftOpeningCallFunction_(body) {
  var url = shiftOpeningFunctionUrl_();
  var secret = normalizeShiftOpeningText_(PropertiesService.getScriptProperties().getProperty('WEEEK_SHIFT_OPENING_SECRET'));
  if (secret) body.secret = secret;

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var text = response.getContentText() || '';
  var parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error('Edge Function returned non-JSON response: HTTP ' + code + ' ' + text.slice(0, 500));
  }

  if (code < 200 || code >= 300 || parsed.ok === false) {
    throw new Error(String(parsed.error || ('Edge Function HTTP ' + code)));
  }

  return parsed;
}

function shiftOpeningFunctionUrl_() {
  return normalizeShiftOpeningText_(PropertiesService.getScriptProperties().getProperty('WEEEK_SHIFT_OPENING_FUNCTION_URL')) || SHIFT_OPENING_DEFAULT_FUNCTION_URL;
}

function shiftOpeningHasAccess_(token) {
  var expected = normalizeShiftOpeningText_(PropertiesService.getScriptProperties().getProperty('SHIFT_OPENING_IFRAME_TOKEN'));
  return !expected || token === expected;
}

function shiftOpeningAssertAccess_(token) {
  if (!shiftOpeningHasAccess_(token)) throw new Error('Доступ запрещен');
}

function normalizeShiftOpeningText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
