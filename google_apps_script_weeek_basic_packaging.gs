/**
 * Google Apps Script Web App для iframe ручной загрузки зависших ШК по упаковке.
 * HTML читает XLSX в браузере, а секреты Supabase хранятся только в Script Properties.
 */

var BASIC_PACKAGING_DEFAULT_FUNCTION_URL = 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-basic-packaging-upload';

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var token = normalizeBasicPackagingText_(params.token);
  if (!basicPackagingHasAccess_(token)) {
    return HtmlService.createHtmlOutput('Доступ запрещен').setTitle('Загрузка упаковки');
  }

  var template = HtmlService.createTemplateFromFile('WeeekBasicPackagingUpload');
  template.initialConfig = {
    token: token
  };

  return template
    .evaluate()
    .setTitle('Загрузка упаковки')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function previewBasicPackagingTasks(request) {
  var req = request && typeof request === 'object' ? request : {};
  basicPackagingAssertAccess_(normalizeBasicPackagingText_(req.token));

  return basicPackagingCallFunction_({
    action: 'preview',
    rows: Array.isArray(req.rows) ? req.rows : [],
    file_name: normalizeBasicPackagingText_(req.file_name),
    task_type_option_id: normalizeBasicPackagingText_(req.task_type_option_id) || basicPackagingTaskTypeOptionId_(),
    board_id: normalizeBasicPackagingText_(req.board_id),
    board_column_id: normalizeBasicPackagingText_(req.board_column_id),
    project_id: normalizeBasicPackagingText_(req.project_id),
    process_queue: false
  });
}

function uploadBasicPackagingTasks(request) {
  var req = request && typeof request === 'object' ? request : {};
  basicPackagingAssertAccess_(normalizeBasicPackagingText_(req.token));

  return basicPackagingCallFunction_({
    action: 'upload',
    rows: Array.isArray(req.rows) ? req.rows : [],
    file_name: normalizeBasicPackagingText_(req.file_name),
    task_type_option_id: normalizeBasicPackagingText_(req.task_type_option_id) || basicPackagingTaskTypeOptionId_(),
    board_id: normalizeBasicPackagingText_(req.board_id),
    board_column_id: normalizeBasicPackagingText_(req.board_column_id),
    project_id: normalizeBasicPackagingText_(req.project_id),
    process_queue: req.process_queue === true,
    process_limit: Number(req.process_limit || 50) || 50
  });
}

function processBasicPackagingQueue(request) {
  var req = request && typeof request === 'object' ? request : {};
  basicPackagingAssertAccess_(normalizeBasicPackagingText_(req.token));

  return basicPackagingCallFunction_({
    action: 'process_queue',
    limit: Number(req.limit || 50) || 50,
    process_all: req.process_all === true,
    max_batches: Number(req.max_batches || 20) || 20,
    dry_run: req.dry_run === true
  });
}

function basicPackagingCallFunction_(body) {
  var url = basicPackagingFunctionUrl_();
  var secret = normalizeBasicPackagingText_(PropertiesService.getScriptProperties().getProperty('WEEEK_BASIC_PACKAGING_UPLOAD_SECRET'));
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

function basicPackagingFunctionUrl_() {
  return normalizeBasicPackagingText_(PropertiesService.getScriptProperties().getProperty('WEEEK_BASIC_PACKAGING_UPLOAD_FUNCTION_URL')) || BASIC_PACKAGING_DEFAULT_FUNCTION_URL;
}

function basicPackagingTaskTypeOptionId_() {
  return normalizeBasicPackagingText_(PropertiesService.getScriptProperties().getProperty('WEEEK_MANUAL_PACKAGING_TASK_TYPE_OPTION_ID'));
}

function basicPackagingHasAccess_(token) {
  var expected = normalizeBasicPackagingText_(PropertiesService.getScriptProperties().getProperty('BASIC_PACKAGING_IFRAME_TOKEN'));
  return !expected || token === expected;
}

function basicPackagingAssertAccess_(token) {
  if (!basicPackagingHasAccess_(token)) throw new Error('Доступ запрещен');
}

function normalizeBasicPackagingText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
