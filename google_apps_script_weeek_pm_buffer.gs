/**
 * Google Apps Script Web App для iframe ручной загрузки буфера ПМ/Почты.
 * HTML читает XLSX в браузере, а секреты Supabase хранятся только в Script Properties.
 */

var PM_BUFFER_DEFAULT_FUNCTION_URL = 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-pm-buffer-upload';

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var token = normalizePmBufferText_(params.token);
  if (!pmBufferHasAccess_(token)) {
    return HtmlService.createHtmlOutput('Доступ запрещен').setTitle('Буфер ПМ');
  }

  var template = HtmlService.createTemplateFromFile('WeeekPmBufferUpload');
  template.initialConfig = {
    token: token
  };

  return template
    .evaluate()
    .setTitle('Буфер ПМ')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function previewPmBufferTasks(request) {
  var req = request && typeof request === 'object' ? request : {};
  pmBufferAssertAccess_(normalizePmBufferText_(req.token));

  return pmBufferCallFunction_({
    action: 'preview',
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: Array.isArray(req.carrier_rows) ? req.carrier_rows : [],
    primary_file_name: normalizePmBufferText_(req.primary_file_name),
    carrier_file_name: normalizePmBufferText_(req.carrier_file_name),
    pm_task_type_option_id: normalizePmBufferText_(req.pm_task_type_option_id) || pmBufferPmTaskTypeOptionId_(),
    mail_task_type_option_id: normalizePmBufferText_(req.mail_task_type_option_id) || pmBufferMailTaskTypeOptionId_(),
    board_id: normalizePmBufferText_(req.board_id),
    project_id: normalizePmBufferText_(req.project_id),
    process_queue: false
  });
}

function uploadPmBufferTasks(request) {
  var req = request && typeof request === 'object' ? request : {};
  pmBufferAssertAccess_(normalizePmBufferText_(req.token));

  return pmBufferCallFunction_({
    action: 'upload',
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: Array.isArray(req.carrier_rows) ? req.carrier_rows : [],
    primary_file_name: normalizePmBufferText_(req.primary_file_name),
    carrier_file_name: normalizePmBufferText_(req.carrier_file_name),
    pm_task_type_option_id: normalizePmBufferText_(req.pm_task_type_option_id) || pmBufferPmTaskTypeOptionId_(),
    mail_task_type_option_id: normalizePmBufferText_(req.mail_task_type_option_id) || pmBufferMailTaskTypeOptionId_(),
    board_id: normalizePmBufferText_(req.board_id),
    project_id: normalizePmBufferText_(req.project_id),
    process_queue: req.process_queue === true,
    process_limit: Number(req.process_limit || 50) || 50
  });
}

function processPmBufferQueue(request) {
  var req = request && typeof request === 'object' ? request : {};
  pmBufferAssertAccess_(normalizePmBufferText_(req.token));

  return pmBufferCallFunction_({
    action: 'process_queue',
    limit: Number(req.limit || 50) || 50,
    process_all: req.process_all !== false,
    max_batches: Number(req.max_batches || 20) || 20,
    dry_run: req.dry_run === true
  });
}

function pmBufferCallFunction_(body) {
  var url = pmBufferFunctionUrl_();
  var secret = normalizePmBufferText_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_UPLOAD_SECRET'));
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

function pmBufferFunctionUrl_() {
  return normalizePmBufferText_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_UPLOAD_FUNCTION_URL')) || PM_BUFFER_DEFAULT_FUNCTION_URL;
}

function pmBufferPmTaskTypeOptionId_() {
  return normalizePmBufferText_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_PM_TASK_TYPE_OPTION_ID'));
}

function pmBufferMailTaskTypeOptionId_() {
  return normalizePmBufferText_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_MAIL_TASK_TYPE_OPTION_ID'));
}

function pmBufferHasAccess_(token) {
  var expected = normalizePmBufferText_(PropertiesService.getScriptProperties().getProperty('PM_BUFFER_IFRAME_TOKEN'));
  return !expected || token === expected;
}

function pmBufferAssertAccess_(token) {
  if (!pmBufferHasAccess_(token)) throw new Error('Доступ запрещен');
}

function normalizePmBufferText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
