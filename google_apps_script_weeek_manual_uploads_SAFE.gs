/**
 * Google Apps Script Web App для единого iframe ручных выгрузок:
 * - Контроль зависшего товара / переупаковка
 * - Буфер ПМ / Почта
 *
 * HTML читает XLSX в браузере, а секреты Supabase хранятся в Script Properties.
 */

var MANUAL_UPLOADS_PACKAGING_URL = 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-basic-packaging-upload';
var MANUAL_UPLOADS_PM_URL = 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-pm-buffer-upload';
var MANUAL_UPLOADS_SETTINGS_URL = 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-manual-upload-settings';

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var token = manualUploadsNormalize_(params.token);
  if (!manualUploadsHasAccess_(token)) {
    return HtmlService.createHtmlOutput('Доступ запрещен').setTitle('Ручные выгрузки');
  }

  var view = manualUploadsNormalize_(params.view);
  var output = HtmlService.createHtmlOutputFromFile(view === 'settings' ? 'OppSettings' : 'WeeekManualUploads');
  output.setTitle(view === 'settings' ? 'Настройка ОПП' : 'Ручные выгрузки');
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return output;
}

function getManualUploadsStatus(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var settings = manualUploadsGetSettings_(false);
  var packagingCfg = manualUploadsSettingByModule_(settings, 'packaging');
  var rwpCfg = manualUploadsSettingByModule_(settings, 'rwp');
  var pmCfg = manualUploadsSettingByModule_(settings, 'pm');
  var presortCfg = manualUploadsSettingByModule_(settings, 'presort');
  var marketplacePcCfg = manualUploadsSettingByModule_(settings, 'marketplace_pc');
  var wmiMpPcCfg = manualUploadsSettingByModule_(settings, 'wmi_mp_pc');
  var noOrderCfg = manualUploadsSettingByModule_(settings, 'no_order');
  var packagingDate = manualUploadsNormalize_(req.packaging_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(packagingCfg.upload_offset_days, -7));
  var rwpDate = manualUploadsNormalize_(req.rwp_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(rwpCfg.upload_offset_days, -4));
  var pmDate = manualUploadsNormalize_(req.pm_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(pmCfg.upload_offset_days, 0));
  var presortDate = manualUploadsNormalize_(req.presort_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(presortCfg.upload_offset_days, 0));
  var marketplacePcDate = manualUploadsNormalize_(req.marketplace_pc_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(marketplacePcCfg.upload_offset_days, 0));
  var wmiMpPcDate = manualUploadsNormalize_(req.wmi_mp_pc_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(wmiMpPcCfg.upload_offset_days, 0));
  var noOrderDate = manualUploadsNormalize_(req.no_order_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(noOrderCfg.upload_offset_days, 0));
  var selectedDate = manualUploadsNormalize_(req.effective_date || req.business_date || req.selected_date) || packagingDate;
  var startDate = manualUploadsNormalize_(req.start_date) || manualUploadsAddDaysIso_(today, -28);
  var endDate = manualUploadsNormalize_(req.end_date) || manualUploadsAddDaysIso_(today, 7);
  var requiredUploadsCount = manualUploadsRequiredUploadsCount_(settings);
  var calendar = manualUploadsCallPackaging_({
    action: 'calendar',
    start_date: startDate,
    end_date: endDate,
    required_upload_types: requiredUploadsCount
  });
  var runs = calendar && Array.isArray(calendar.runs) ? calendar.runs : [];
  return {
    ok: true,
    upload_date: today,
    selected_date: selectedDate,
    packaging_business_date: packagingDate,
    rwp_business_date: rwpDate,
    pm_business_date: pmDate,
    presort_business_date: presortDate,
    marketplace_pc_business_date: marketplacePcDate,
    wmi_mp_pc_business_date: wmiMpPcDate,
    no_order_business_date: noOrderDate,
    required_uploads_count: requiredUploadsCount,
    settings: settings,
    calendar: calendar,
    packaging: manualUploadsStatusFromRuns_(runs, packagingCfg, packagingDate),
    rwp: manualUploadsStatusFromRuns_(runs, rwpCfg, rwpDate),
    pm_buffer: manualUploadsStatusFromRuns_(runs, pmCfg, pmDate),
    presort: manualUploadsStatusFromRuns_(runs, presortCfg, presortDate),
    marketplace_pc: manualUploadsStatusFromRuns_(runs, marketplacePcCfg, marketplacePcDate),
    wmi_mp_pc: manualUploadsStatusFromRuns_(runs, wmiMpPcCfg, wmiMpPcDate),
    no_order: manualUploadsStatusFromRuns_(runs, noOrderCfg, noOrderDate)
  };
}

function getManualUploadSettings(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));
  var settings = manualUploadsGetSettings_(manualUploadsNormalize_(req.force_refresh) === '1' || req.force_refresh === true);
  return {
    ok: true,
    settings: settings
  };
}

function saveManualUploadSetting(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));
  var response = manualUploadsCallSettings_({
    action: 'update_setting',
    module: manualUploadsNormalize_(req.module),
    upload_offset_days: req.upload_offset_days,
    task_deadline_days: req.task_deadline_days,
    pm_deadline_days: req.pm_deadline_days,
    mail_deadline_days: req.mail_deadline_days,
    is_required: req.is_required
  });
  manualUploadsClearSettingsCache_();
  return response;
}

function runManualPackagingUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var uploadType = manualUploadsNormalize_(req.upload_type) || 'packaging';
  var isRwp = uploadType === 'rwp' || manualUploadsNormalize_(req.source_module) === 'manual_rwp_opp';
  var settings = manualUploadsGetSettings_(false);
  var cfg = manualUploadsSettingByModule_(settings, isRwp ? 'rwp' : 'packaging');
  var selectedDate = manualUploadsNormalize_(req.business_date || req.effective_date || req.selected_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(cfg.upload_offset_days, isRwp ? -4 : -7));
  return manualUploadsCallPackaging_({
    action: 'upload',
    rows: Array.isArray(req.rows) ? req.rows : [],
    file_name: manualUploadsNormalize_(req.file_name),
    source_module: isRwp ? 'manual_rwp_opp' : 'manual_packaging_opp',
    source_table: isRwp ? 'xlsx:manual_rwp_opp' : 'xlsx:manual_packaging_opp',
    task_type: isRwp ? 'Разбор ОПП // RWP' : 'Разбор ОПП // Упаковка',
    description_task_type: isRwp ? 'Разбор ОПП // RWP' : 'Разбор ОПП // Упаковка',
    board_key: isRwp ? 'manual_rwp_opp' : 'manual_packaging_opp',
    column_key: isRwp ? 'rwp' : 'packaging',
    board_column_name: isRwp ? 'RWP' : 'Упаковка',
    target_column_name: isRwp ? 'RWP' : 'Упаковка',
    deadline_days: manualUploadsNumber_(cfg.task_deadline_days, isRwp ? 4 : 7),
    single_min_price: isRwp ? 0 : 1000,
    row_filter: isRwp ? 'only_rwp' : 'exclude_rwp',
    group_by_tare: !isRwp,
    title_prefix: isRwp ? 'RWP' : 'Упаковка',
    task_type_option_id: manualUploadsNormalize_(req.task_type_option_id) || (isRwp ? manualUploadsRwpTaskTypeOptionId_() : manualUploadsPackagingTaskTypeOptionId_()),
    upload_type: isRwp ? 'rwp' : 'packaging',
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    process_queue: true,
    process_all: true,
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50
  });
}

function runManualPmBufferUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var settings = manualUploadsGetSettings_(false);
  var cfg = manualUploadsSettingByModule_(settings, 'pm');
  var selectedDate = manualUploadsNormalize_(req.business_date || req.effective_date || req.selected_date) || today;
  return manualUploadsCallPm_({
    action: 'upload',
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: Array.isArray(req.carrier_rows) ? req.carrier_rows : [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    carrier_file_name: manualUploadsNormalize_(req.carrier_file_name),
    pm_task_type_option_id: manualUploadsNormalize_(req.pm_task_type_option_id) || manualUploadsPmTaskTypeOptionId_(),
    mail_task_type_option_id: manualUploadsNormalize_(req.mail_task_type_option_id) || manualUploadsMailTaskTypeOptionId_(),
    upload_type: 'pm_buffer',
    pm_deadline_days: manualUploadsNumber_(cfg.pm_deadline_days, 2),
    mail_deadline_days: manualUploadsNumber_(cfg.mail_deadline_days, 3),
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    process_queue: true,
    process_all: true,
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50
  });
}

function runManualPresortUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var settings = manualUploadsGetSettings_(false);
  var presortCfg = manualUploadsSettingByModule_(settings, 'presort');
  var labelingCfg = manualUploadsSettingByModule_(settings, 'labeling');
  var selectedDate = manualUploadsNormalize_(req.business_date || req.effective_date || req.selected_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(presortCfg.upload_offset_days, 0));
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'presort',
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_presort_opp',
    source_table: 'xlsx:manual_presort_opp',
    upload_type: 'presort',
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    process_queue: true,
    process_all: true,
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50,
    presort_deadline_days: manualUploadsNumber_(presortCfg.task_deadline_days, 2),
    labeling_deadline_days: manualUploadsNumber_(labelingCfg.task_deadline_days, 2),
    presort_task_type_option_id: manualUploadsNormalize_(req.presort_task_type_option_id) || manualUploadsPresortTaskTypeOptionId_(),
    labeling_task_type_option_id: manualUploadsNormalize_(req.labeling_task_type_option_id) || manualUploadsLabelingTaskTypeOptionId_(),
    presort_column_name: 'Предсортировка',
    labeling_column_name: 'Другие задачи'
  });
}

function runManualMarketplacePcUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var settings = manualUploadsGetSettings_(false);
  var marketplacePcCfg = manualUploadsSettingByModule_(settings, 'marketplace_pc');
  var marketplaceCfg = manualUploadsSettingByModule_(settings, 'marketplace');
  var pcCfg = manualUploadsSettingByModule_(settings, 'pc');
  var selectedDate = manualUploadsNormalize_(req.business_date || req.effective_date || req.selected_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(marketplacePcCfg.upload_offset_days, 0));
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'marketplace_pc',
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_marketplace_pc',
    source_table: 'xlsx:manual_marketplace_pc',
    upload_type: 'marketplace_pc',
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    process_queue: true,
    process_all: true,
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50,
    marketplace_deadline_days: manualUploadsNumber_(marketplaceCfg.task_deadline_days, 2),
    pc_deadline_days: manualUploadsNumber_(pcCfg.task_deadline_days, 2),
    marketplace_task_type_option_id: manualUploadsNormalize_(req.marketplace_task_type_option_id) || manualUploadsMarketplaceTaskTypeOptionId_(),
    pc_task_type_option_id: manualUploadsNormalize_(req.pc_task_type_option_id) || manualUploadsPcTaskTypeOptionId_(),
    marketplace_column_name: 'Маркетплейс',
    pc_column_name: 'ПЦ'
  });
}

function runManualWmiMpPcUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var settings = manualUploadsGetSettings_(false);
  var wmiMpPcCfg = manualUploadsSettingByModule_(settings, 'wmi_mp_pc');
  var selectedDate = manualUploadsNormalize_(req.business_date || req.effective_date || req.selected_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(wmiMpPcCfg.upload_offset_days, 0));
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'wmi_mp_pc',
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_wmi_mp_pc',
    source_table: 'xlsx:manual_wmi_mp_pc',
    upload_type: 'wmi_mp_pc',
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    process_queue: true,
    process_all: true,
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50,
    wmi_mp_pc_deadline_days: manualUploadsNumber_(wmiMpPcCfg.task_deadline_days, 2),
    wmi_mp_pc_task_type_option_id: manualUploadsNormalize_(req.wmi_mp_pc_task_type_option_id) || manualUploadsWmiMpPcTaskTypeOptionId_(),
    wmi_mp_pc_column_name: 'Разбор ОПП // WMI (МП + ПЦ)'
  });
}

function runManualNoOrderUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var settings = manualUploadsGetSettings_(false);
  var noOrderCfg = manualUploadsSettingByModule_(settings, 'no_order');
  var selectedDate = manualUploadsNormalize_(req.business_date || req.effective_date || req.selected_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(noOrderCfg.upload_offset_days, 0));
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'no_order',
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_no_order',
    source_table: 'xlsx:manual_no_order',
    upload_type: 'no_order',
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    process_queue: true,
    process_all: true,
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50,
    no_order_deadline_days: manualUploadsNumber_(noOrderCfg.task_deadline_days, 2),
    no_order_task_type_option_id: manualUploadsNormalize_(req.no_order_task_type_option_id) || manualUploadsNoOrderTaskTypeOptionId_(),
    no_order_column_name: 'Разбор ОПП // Без заказа'
  });
}

function manualUploadsCallPackaging_(body) {
  var secret = manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_BASIC_PACKAGING_UPLOAD_SECRET'));
  if (secret) body.secret = secret;
  return manualUploadsFetchJson_(manualUploadsPackagingUrl_(), body);
}

function manualUploadsCallPm_(body) {
  var secret = manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_UPLOAD_SECRET'));
  if (secret) body.secret = secret;
  return manualUploadsFetchJson_(manualUploadsPmUrl_(), body);
}

function manualUploadsCallSettings_(body) {
  var secret = manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_MANUAL_UPLOAD_SETTINGS_SECRET'))
    || manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_BASIC_PACKAGING_UPLOAD_SECRET'));
  if (secret) body.secret = secret;
  return manualUploadsFetchJson_(manualUploadsSettingsUrl_(), body);
}

function manualUploadsFetchJson_(url, body) {
  var anonKey = manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('SUPABASE_ANON_KEY'))
    || manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_SUPABASE_ANON_KEY'));
  var options = {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
  if (anonKey) {
    options.headers = {
      apikey: anonKey,
      Authorization: 'Bearer ' + anonKey
    };
  }

  var response = UrlFetchApp.fetch(url, {
    method: options.method,
    contentType: options.contentType,
    payload: options.payload,
    muteHttpExceptions: options.muteHttpExceptions,
    headers: options.headers || {}
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
    var message = parsed.error || parsed.message || text.slice(0, 500) || ('Edge Function HTTP ' + code);
    throw new Error('Edge Function HTTP ' + code + ': ' + message);
  }

  return parsed;
}

function manualUploadsPackagingUrl_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_BASIC_PACKAGING_UPLOAD_FUNCTION_URL')) || MANUAL_UPLOADS_PACKAGING_URL;
}

function manualUploadsPmUrl_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_UPLOAD_FUNCTION_URL')) || MANUAL_UPLOADS_PM_URL;
}

function manualUploadsSettingsUrl_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_MANUAL_UPLOAD_SETTINGS_FUNCTION_URL')) || MANUAL_UPLOADS_SETTINGS_URL;
}

function manualUploadsPackagingTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_MANUAL_PACKAGING_TASK_TYPE_OPTION_ID'));
}

function manualUploadsRwpTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_MANUAL_RWP_TASK_TYPE_OPTION_ID'));
}

function manualUploadsPmTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_PM_TASK_TYPE_OPTION_ID'));
}

function manualUploadsMailTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_MAIL_TASK_TYPE_OPTION_ID'));
}

function manualUploadsPresortTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_PRESORT_TASK_TYPE_OPTION_ID'))
    || 'a2805e55-a51a-4bad-ac3e-98f6d411874f';
}

function manualUploadsLabelingTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_LABELING_TASK_TYPE_OPTION_ID'));
}

function manualUploadsMarketplaceTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_MARKETPLACE_TASK_TYPE_OPTION_ID'));
}

function manualUploadsPcTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_PC_TASK_TYPE_OPTION_ID'));
}

function manualUploadsWmiMpPcTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_WMI_MP_PC_TASK_TYPE_OPTION_ID'))
    || 'a285bada-9b14-49b8-a1c2-cb6b344b6bec';
}

function manualUploadsNoOrderTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_NO_ORDER_TASK_TYPE_OPTION_ID'))
    || 'a285bbb5-901a-4a4e-912e-82bc6385284d';
}

function manualUploadsGetSettings_(forceRefresh) {
  var cacheKey = 'weeek_manual_upload_settings_v2';
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var cached = cache.get(cacheKey);
    if (cached) {
      try {
        var parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      } catch (_error) {
        // Ignore a broken cache entry and ask Supabase again.
      }
    }
  }

  try {
    var response = manualUploadsCallSettings_({ action: 'list_settings' });
    var settings = response && Array.isArray(response.settings) ? response.settings : manualUploadsDefaultSettings_();
    cache.put(cacheKey, JSON.stringify(settings), 300);
    return settings;
  } catch (_error) {
    return manualUploadsDefaultSettings_();
  }
}

function manualUploadsClearSettingsCache_() {
  CacheService.getScriptCache().remove('weeek_manual_upload_settings_v2');
}

function manualUploadsDefaultSettings_() {
  return [
    {
      module: 'packaging',
      label: 'Переупаковка',
      source_module: 'manual_packaging_opp',
      upload_type: 'packaging',
      upload_offset_days: -7,
      task_deadline_days: 7,
      is_required: true,
      sort_order: 10
    },
    {
      module: 'rwp',
      label: 'RWP',
      source_module: 'manual_rwp_opp',
      upload_type: 'rwp',
      upload_offset_days: -4,
      task_deadline_days: 4,
      is_required: true,
      sort_order: 20
    },
    {
      module: 'pm',
      label: 'ПМ / Почта',
      source_module: 'manual_pm_buffer',
      upload_type: 'pm_buffer',
      upload_offset_days: 0,
      pm_deadline_days: 2,
      mail_deadline_days: 3,
      is_required: true,
      sort_order: 30
    },
    {
      module: 'presort',
      label: 'Предсортировка',
      source_module: 'manual_presort_opp',
      upload_type: 'presort',
      upload_offset_days: 0,
      task_deadline_days: 2,
      is_required: true,
      sort_order: 40
    },
    {
      module: 'labeling',
      label: 'Оклейка',
      source_module: 'manual_presort_opp',
      upload_type: 'presort',
      upload_offset_days: 0,
      task_deadline_days: 2,
      is_required: false,
      sort_order: 50
    },
    {
      module: 'marketplace_pc',
      label: 'Маркетплейс + ПЦ',
      source_module: 'manual_marketplace_pc',
      upload_type: 'marketplace_pc',
      upload_offset_days: 0,
      task_deadline_days: 2,
      is_required: true,
      sort_order: 60
    },
    {
      module: 'marketplace',
      label: 'Маркетплейс',
      source_module: 'manual_marketplace_pc',
      upload_type: 'marketplace_pc',
      upload_offset_days: 0,
      task_deadline_days: 2,
      is_required: false,
      sort_order: 70
    },
    {
      module: 'pc',
      label: 'ПЦ',
      source_module: 'manual_marketplace_pc',
      upload_type: 'marketplace_pc',
      upload_offset_days: 0,
      task_deadline_days: 2,
      is_required: false,
      sort_order: 80
    },
    {
      module: 'wmi_mp_pc',
      label: 'WMI (МП + ПЦ)',
      source_module: 'manual_wmi_mp_pc',
      upload_type: 'wmi_mp_pc',
      upload_offset_days: 0,
      task_deadline_days: 2,
      is_required: true,
      sort_order: 90
    },
    {
      module: 'no_order',
      label: 'Без заказа',
      source_module: 'manual_no_order',
      upload_type: 'no_order',
      upload_offset_days: 0,
      task_deadline_days: 2,
      is_required: true,
      sort_order: 100
    }
  ];
}

function manualUploadsSettingByModule_(settings, moduleName) {
  var list = Array.isArray(settings) && settings.length ? settings : manualUploadsDefaultSettings_();
  for (var i = 0; i < list.length; i += 1) {
    if (manualUploadsNormalize_(list[i].module) === moduleName) return list[i];
  }
  var fallback = manualUploadsDefaultSettings_();
  for (var j = 0; j < fallback.length; j += 1) {
    if (fallback[j].module === moduleName) return fallback[j];
  }
  return {};
}

function manualUploadsStatusFromRuns_(runs, cfg, effectiveDate) {
  var run = manualUploadsFindRun_(runs, cfg, effectiveDate);
  return {
    ok: true,
    action: 'status',
    source_module: manualUploadsNormalize_(cfg.source_module),
    upload_type: manualUploadsNormalize_(cfg.upload_type),
    effective_date: effectiveDate,
    exists: Boolean(run),
    run: run
  };
}

function manualUploadsFindRun_(runs, cfg, effectiveDate) {
  var uploadType = manualUploadsNormalize_(cfg.upload_type);
  var sourceModule = manualUploadsNormalize_(cfg.source_module);
  var date = manualUploadsNormalize_(effectiveDate);
  var list = Array.isArray(runs) ? runs : [];
  for (var i = 0; i < list.length; i += 1) {
    var run = list[i] || {};
    var runDate = manualUploadsNormalize_(run.effective_date || run.business_date || run.upload_date);
    var runType = manualUploadsNormalize_(run.upload_type || run.source_module);
    var runSource = manualUploadsNormalize_(run.source_module);
    if (runDate === date && (runType === uploadType || runSource === sourceModule)) return run;
  }
  return null;
}

function manualUploadsRequiredUploadsCount_(settings) {
  var list = Array.isArray(settings) && settings.length ? settings : manualUploadsDefaultSettings_();
  var count = 0;
  list.forEach(function (item) {
    if (item && item.is_required !== false) count += 1;
  });
  return count || 3;
}

function manualUploadsNumber_(value, fallback) {
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function manualUploadsHasAccess_(token) {
  var expected = manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('MANUAL_UPLOADS_IFRAME_TOKEN'));
  return !expected || token === expected;
}

function manualUploadsAssertAccess_(token) {
  if (!token) return;
  if (!manualUploadsHasAccess_(token)) throw new Error('Доступ запрещен');
}

function manualUploadsNormalize_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function manualUploadsTodayIso_() {
  return Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
}

function manualUploadsAddDaysIso_(isoDate, days) {
  var match = manualUploadsNormalize_(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}
