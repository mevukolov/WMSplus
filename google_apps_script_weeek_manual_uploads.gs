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
var MANUAL_UPLOADS_TASK_MASTER_BASIC_URL = 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master-basic';
var SHIFT_OPENING_DEFAULT_WH_ID = '50144199';
var SHIFT_OPENING_DEFAULT_FUNCTION_URL = 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-shift-opening';

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var view = manualUploadsNormalize_(params.view);

  var token = manualUploadsNormalize_(params.token);
  if (!manualUploadsHasAccess_(token)) {
    return HtmlService.createHtmlOutput('Доступ запрещен').setTitle('Ручные выгрузки');
  }

  if (view === 'master') {
    var masterTemplate = HtmlService.createTemplateFromFile('OppMasterFrame');
    masterTemplate.initialConfig = {
      token: token,
      wh_id: manualUploadsNormalize_(params.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
      app_url: manualUploadsServiceUrl_()
    };
    return masterTemplate
      .evaluate()
      .setTitle('Динамика ОПП')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (view === 'shift_opening') {
    var shiftTemplate = HtmlService.createTemplateFromFile('WeeekShiftOpening');
    shiftTemplate.initialConfig = {
      token: token,
      wh_id: manualUploadsNormalize_(params.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID
    };
    return shiftTemplate
      .evaluate()
      .setTitle('Открытие смены')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

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
  var afterSaleMovementCfg = manualUploadsSettingByModule_(settings, 'after_sale_movement');
  var packagingDate = manualUploadsNormalize_(req.packaging_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(packagingCfg.upload_offset_days, -7));
  var rwpDate = manualUploadsNormalize_(req.rwp_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(rwpCfg.upload_offset_days, -4));
  var pmDate = manualUploadsNormalize_(req.pm_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(pmCfg.upload_offset_days, 0));
  var presortDate = manualUploadsNormalize_(req.presort_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(presortCfg.upload_offset_days, 0));
  var marketplacePcDate = manualUploadsNormalize_(req.marketplace_pc_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(marketplacePcCfg.upload_offset_days, 0));
  var wmiMpPcDate = manualUploadsNormalize_(req.wmi_mp_pc_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(wmiMpPcCfg.upload_offset_days, 0));
  var noOrderDate = manualUploadsNormalize_(req.no_order_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(noOrderCfg.upload_offset_days, 0));
  var afterSaleMovementDate = manualUploadsNormalize_(req.after_sale_movement_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(afterSaleMovementCfg.upload_offset_days, 0));
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
    after_sale_movement_business_date: afterSaleMovementDate,
    required_uploads_count: requiredUploadsCount,
    settings: settings,
    calendar: calendar,
    packaging: manualUploadsStatusFromRuns_(runs, packagingCfg, packagingDate),
    rwp: manualUploadsStatusFromRuns_(runs, rwpCfg, rwpDate),
    pm_buffer: manualUploadsStatusFromRuns_(runs, pmCfg, pmDate),
    presort: manualUploadsStatusFromRuns_(runs, presortCfg, presortDate),
    marketplace_pc: manualUploadsStatusFromRuns_(runs, marketplacePcCfg, marketplacePcDate),
    wmi_mp_pc: manualUploadsStatusFromRuns_(runs, wmiMpPcCfg, wmiMpPcDate),
    no_order: manualUploadsStatusFromRuns_(runs, noOrderCfg, noOrderDate),
    after_sale_movement: manualUploadsStatusFromRuns_(runs, afterSaleMovementCfg, afterSaleMovementDate)
  };
}

function getShiftOpeningState(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  return shiftOpeningCallFunction_({
    action: 'get_state',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    shift_date: manualUploadsNormalize_(req.shift_date)
  });
}

function previewPureLossesUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  return shiftOpeningCallFunction_({
    action: 'preview_pure_losses_import',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    shift_date: manualUploadsNormalize_(req.shift_date),
    file_name: manualUploadsNormalize_(req.file_name),
    pure_losses_rows: Array.isArray(req.pure_losses_rows) ? req.pure_losses_rows : []
  });
}

function openWeeekShift(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  return shiftOpeningCallFunction_({
    action: 'open_shift',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    shift_date: manualUploadsNormalize_(req.shift_date),
    incoming_employee_id: manualUploadsNormalize_(req.incoming_employee_id),
    outgoing_employee_id: manualUploadsNormalize_(req.outgoing_employee_id),
    file_uploaded: req.file_uploaded === true,
    file_name: manualUploadsNormalize_(req.file_name),
    pure_losses_rows: Array.isArray(req.pure_losses_rows) ? req.pure_losses_rows : [],
    opened_by: manualUploadsNormalize_(req.opened_by),
    source: 'master_iframe',
    payload: req.payload && typeof req.payload === 'object' ? req.payload : {}
  });
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
	    is_required: req.is_required,
	    responsibility_zone: req.responsibility_zone
	  });
  manualUploadsClearSettingsCache_();
  return response;
}

function processManualUploadQueue(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var sourceModule = manualUploadsNormalize_(req.source_module);
  if (!sourceModule) throw new Error('source_module is required');

  var body = {
    action: 'process_queue',
    source_module: sourceModule,
    process_all: false,
    limit: Math.min(Math.max(Number(req.limit || req.process_limit || 20) || 20, 1), 20),
    retry_attempts: Math.min(Math.max(Number(req.retry_attempts || 4) || 4, 1), 5)
  };
  var isPackaging = sourceModule === 'manual_packaging_opp' || sourceModule === 'manual_rwp_opp';
  return isPackaging ? manualUploadsCallPackaging_(body) : manualUploadsCallPm_(body);
}

function getManualUploadQueueSummary(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var sourceModules = Array.isArray(req.source_modules)
    ? req.source_modules.map(manualUploadsNormalize_).filter(Boolean)
    : manualUploadsNormalize_(req.source_modules).split(',').map(manualUploadsNormalize_).filter(Boolean);

  return manualUploadsCallTaskMasterBasic_({
    action: 'queue_summary',
    source_modules: sourceModules,
    retry_attempts: Math.min(Math.max(Number(req.retry_attempts || 3) || 3, 1), 5)
  });
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
  var plannedUploadDate = manualUploadsPlannedUploadDate_(selectedDate, cfg, isRwp ? -4 : -7);
  return manualUploadsCallPackaging_({
    action: 'upload',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
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
	    planned_upload_date: plannedUploadDate,
	    responsibility_zone: manualUploadsResponsibilityZone_(cfg),
	    business_date: selectedDate,
    effective_date: selectedDate,
    target_system: manualUploadsWmsOnly_(req) ? 'wms' : '',
    wms_only: manualUploadsWmsOnly_(req),
    supabase_only: manualUploadsWmsOnly_(req),
    create_weeek_tasks: !manualUploadsWmsOnly_(req),
    process_queue: manualUploadsBoolean_(req.process_queue, true),
    process_all: manualUploadsBoolean_(req.process_all, true),
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
  var plannedUploadDate = manualUploadsPlannedUploadDate_(selectedDate, cfg, 0);
  return manualUploadsCallPm_({
    action: 'upload',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
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
	    planned_upload_date: plannedUploadDate,
	    responsibility_zone: manualUploadsResponsibilityZone_(cfg),
	    business_date: selectedDate,
    effective_date: selectedDate,
    target_system: manualUploadsWmsOnly_(req) ? 'wms' : '',
    wms_only: manualUploadsWmsOnly_(req),
    supabase_only: manualUploadsWmsOnly_(req),
    create_weeek_tasks: !manualUploadsWmsOnly_(req),
    process_queue: manualUploadsBoolean_(req.process_queue, true),
    process_all: manualUploadsBoolean_(req.process_all, true),
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
  var presortPlannedUploadDate = manualUploadsPlannedUploadDate_(selectedDate, presortCfg, 0);
  var labelingBusinessDate = manualUploadsNormalize_(req.labeling_business_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(labelingCfg.upload_offset_days, 0));
  var labelingPlannedUploadDate = manualUploadsPlannedUploadDate_(labelingBusinessDate, labelingCfg, 0);
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'presort',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_presort_opp',
    source_table: 'xlsx:manual_presort_opp',
	    upload_type: 'presort',
	    upload_date: today,
	    business_date: selectedDate,
	    effective_date: selectedDate,
	    planned_upload_date: presortPlannedUploadDate,
	    presort_planned_upload_date: presortPlannedUploadDate,
	    labeling_planned_upload_date: labelingPlannedUploadDate,
	    responsibility_zone: manualUploadsResponsibilityZone_(presortCfg),
	    presort_responsibility_zone: manualUploadsResponsibilityZone_(presortCfg),
	    labeling_responsibility_zone: manualUploadsResponsibilityZone_(labelingCfg),
	    target_system: manualUploadsWmsOnly_(req) ? 'wms' : '',
	    wms_only: manualUploadsWmsOnly_(req),
	    supabase_only: manualUploadsWmsOnly_(req),
	    create_weeek_tasks: !manualUploadsWmsOnly_(req),
	    process_queue: manualUploadsBoolean_(req.process_queue, true),
    process_all: manualUploadsBoolean_(req.process_all, true),
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
  var marketplaceBusinessDate = manualUploadsNormalize_(req.marketplace_business_date) || selectedDate;
  var pcBusinessDate = manualUploadsNormalize_(req.pc_business_date) || selectedDate;
  var marketplacePlannedUploadDate = manualUploadsPlannedUploadDate_(marketplaceBusinessDate, marketplaceCfg, 0);
  var pcPlannedUploadDate = manualUploadsPlannedUploadDate_(pcBusinessDate, pcCfg, 0);
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'marketplace_pc',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_marketplace_pc',
    source_table: 'xlsx:manual_marketplace_pc',
    upload_type: 'marketplace_pc',
	    upload_date: today,
	    business_date: selectedDate,
	    effective_date: selectedDate,
	    marketplace_business_date: marketplaceBusinessDate,
	    pc_business_date: pcBusinessDate,
	    planned_upload_date: manualUploadsPlannedUploadDate_(selectedDate, marketplacePcCfg, 0),
	    marketplace_planned_upload_date: marketplacePlannedUploadDate,
	    pc_planned_upload_date: pcPlannedUploadDate,
	    responsibility_zone: manualUploadsResponsibilityZone_(marketplacePcCfg),
	    marketplace_responsibility_zone: manualUploadsResponsibilityZone_(marketplaceCfg),
	    pc_responsibility_zone: manualUploadsResponsibilityZone_(pcCfg),
	    target_system: manualUploadsWmsOnly_(req) ? 'wms' : '',
	    wms_only: manualUploadsWmsOnly_(req),
	    supabase_only: manualUploadsWmsOnly_(req),
	    create_weeek_tasks: !manualUploadsWmsOnly_(req),
	    process_queue: manualUploadsBoolean_(req.process_queue, true),
    process_all: manualUploadsBoolean_(req.process_all, true),
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
  var plannedUploadDate = manualUploadsPlannedUploadDate_(selectedDate, wmiMpPcCfg, 0);
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'wmi_mp_pc',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_wmi_mp_pc',
    source_table: 'xlsx:manual_wmi_mp_pc',
    upload_type: 'wmi_mp_pc',
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    planned_upload_date: plannedUploadDate,
    wmi_mp_pc_planned_upload_date: plannedUploadDate,
    responsibility_zone: manualUploadsResponsibilityZone_(wmiMpPcCfg),
    wmi_mp_pc_responsibility_zone: manualUploadsResponsibilityZone_(wmiMpPcCfg),
    target_system: manualUploadsWmsOnly_(req) ? 'wms' : '',
    wms_only: manualUploadsWmsOnly_(req),
    supabase_only: manualUploadsWmsOnly_(req),
    create_weeek_tasks: !manualUploadsWmsOnly_(req),
    process_queue: manualUploadsBoolean_(req.process_queue, true),
    process_all: manualUploadsBoolean_(req.process_all, true),
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50,
    wmi_mp_pc_deadline_days: manualUploadsNumber_(wmiMpPcCfg.task_deadline_days, 2),
    wmi_mp_pc_task_type_option_id: manualUploadsNormalize_(req.wmi_mp_pc_task_type_option_id) || manualUploadsWmiMpPcTaskTypeOptionId_(),
    wmi_mp_pc_column_name: 'WMI (МП + ПЦ)'
  });
}

function runManualNoOrderUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var settings = manualUploadsGetSettings_(false);
  var noOrderCfg = manualUploadsSettingByModule_(settings, 'no_order');
  var usdCfg = manualUploadsSettingByModule_(settings, 'usd');
  var tmmCfg = manualUploadsSettingByModule_(settings, 'tmm');
  var selectedDate = manualUploadsNormalize_(req.business_date || req.effective_date || req.selected_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(noOrderCfg.upload_offset_days, 0));
  var plannedUploadDate = manualUploadsPlannedUploadDate_(selectedDate, noOrderCfg, 0);
  var usdPlannedUploadDate = manualUploadsPlannedUploadDate_(selectedDate, usdCfg, 0);
  var tmmPlannedUploadDate = manualUploadsPlannedUploadDate_(selectedDate, tmmCfg, 0);
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'no_order',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_no_order',
    source_table: 'xlsx:manual_no_order',
    upload_type: 'no_order',
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    planned_upload_date: plannedUploadDate,
    no_order_planned_upload_date: plannedUploadDate,
    usd_planned_upload_date: usdPlannedUploadDate,
    tmm_planned_upload_date: tmmPlannedUploadDate,
    responsibility_zone: manualUploadsResponsibilityZone_(noOrderCfg),
    no_order_responsibility_zone: manualUploadsResponsibilityZone_(noOrderCfg),
    usd_responsibility_zone: manualUploadsResponsibilityZone_(usdCfg),
    tmm_responsibility_zone: manualUploadsResponsibilityZone_(tmmCfg),
    target_system: manualUploadsWmsOnly_(req) ? 'wms' : '',
    wms_only: manualUploadsWmsOnly_(req),
    supabase_only: manualUploadsWmsOnly_(req),
    create_weeek_tasks: !manualUploadsWmsOnly_(req),
    process_queue: manualUploadsBoolean_(req.process_queue, true),
    process_all: manualUploadsBoolean_(req.process_all, true),
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50,
    no_order_deadline_days: manualUploadsNumber_(noOrderCfg.task_deadline_days, 2),
    no_order_task_type_option_id: manualUploadsNormalize_(req.no_order_task_type_option_id) || manualUploadsNoOrderTaskTypeOptionId_(),
    usd_task_type_option_id: manualUploadsNormalize_(req.usd_task_type_option_id) || manualUploadsUsdTaskTypeOptionId_(),
    tmm_task_type_option_id: manualUploadsNormalize_(req.tmm_task_type_option_id) || manualUploadsTmmTaskTypeOptionId_(),
    no_order_column_name: 'Без заказа',
    usd_column_name: 'Другие задачи',
    tmm_column_name: 'Другие задачи'
  });
}

function runManualAfterSaleMovementUpload(request) {
  var req = request && typeof request === 'object' ? request : {};
  manualUploadsAssertAccess_(manualUploadsNormalize_(req.token));

  var today = manualUploadsNormalize_(req.upload_date) || manualUploadsTodayIso_();
  var settings = manualUploadsGetSettings_(false);
  var cfg = manualUploadsSettingByModule_(settings, 'after_sale_movement');
  var selectedDate = manualUploadsNormalize_(req.business_date || req.effective_date || req.selected_date) || manualUploadsAddDaysIso_(today, manualUploadsNumber_(cfg.upload_offset_days, 0));
  var plannedUploadDate = manualUploadsPlannedUploadDate_(selectedDate, cfg, 0);
  return manualUploadsCallPm_({
    action: 'upload',
    mode: 'after_sale_movement',
    wh_id: manualUploadsNormalize_(req.wh_id) || SHIFT_OPENING_DEFAULT_WH_ID,
    primary_rows: Array.isArray(req.primary_rows) ? req.primary_rows : [],
    carrier_rows: [],
    primary_file_name: manualUploadsNormalize_(req.primary_file_name),
    source_module: 'manual_after_sale_movement',
    source_table: 'xlsx:manual_after_sale_movement',
    upload_type: 'after_sale_movement',
    upload_date: today,
    business_date: selectedDate,
    effective_date: selectedDate,
    planned_upload_date: plannedUploadDate,
    after_sale_movement_planned_upload_date: plannedUploadDate,
    responsibility_zone: manualUploadsResponsibilityZone_(cfg),
    after_sale_movement_responsibility_zone: manualUploadsResponsibilityZone_(cfg),
    target_system: manualUploadsWmsOnly_(req) ? 'wms' : '',
    wms_only: manualUploadsWmsOnly_(req),
    supabase_only: manualUploadsWmsOnly_(req),
    create_weeek_tasks: !manualUploadsWmsOnly_(req),
    process_queue: manualUploadsBoolean_(req.process_queue, true),
    process_all: manualUploadsBoolean_(req.process_all, true),
    process_limit: Number(req.process_limit || 50) || 50,
    max_batches: Number(req.max_batches || 50) || 50,
    after_sale_movement_deadline_days: manualUploadsNumber_(cfg.task_deadline_days, 2),
    after_sale_movement_task_type_option_id: manualUploadsNormalize_(req.after_sale_movement_task_type_option_id) || manualUploadsAfterSaleMovementTaskTypeOptionId_(),
    after_sale_movement_column_name: 'Движение после продажи'
  });
}

function manualUploadsCallPackaging_(body) {
  if (!manualUploadsNormalize_(body.wh_id)) body.wh_id = SHIFT_OPENING_DEFAULT_WH_ID;
  var secret = manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_BASIC_PACKAGING_UPLOAD_SECRET'));
  if (secret) body.secret = secret;
  return manualUploadsFetchJson_(manualUploadsPackagingUrl_(), body);
}

function manualUploadsCallPm_(body) {
  if (!manualUploadsNormalize_(body.wh_id)) body.wh_id = SHIFT_OPENING_DEFAULT_WH_ID;
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

function manualUploadsCallTaskMasterBasic_(body) {
  var secret = manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_TASK_MASTER_SECRET'))
    || manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_BASIC_TASK_MASTER_SECRET'))
    || manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_BASIC_PACKAGING_UPLOAD_SECRET'))
    || manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_PM_BUFFER_UPLOAD_SECRET'))
    || manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('MANUAL_UPLOADS_IFRAME_TOKEN'));
  if (secret) body.secret = secret;
  return manualUploadsFetchJson_(manualUploadsTaskMasterBasicUrl_(), body);
}

function shiftOpeningCallFunction_(body) {
  var props = PropertiesService.getScriptProperties();
  var secret = manualUploadsNormalize_(props.getProperty('WEEEK_SHIFT_OPENING_SECRET'))
    || manualUploadsNormalize_(props.getProperty('SHIFT_OPENING_IFRAME_TOKEN'))
    || manualUploadsNormalize_(props.getProperty('MANUAL_UPLOADS_IFRAME_TOKEN'));
  if (secret) body.secret = secret;
  return manualUploadsFetchJson_(shiftOpeningFunctionUrl_(), body);
}

function manualUploadsFetchJson_(url, body) {
  var anonKey = manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('SUPABASE_ANON_KEY'))
    || manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_SUPABASE_ANON_KEY'));
  var requestBody = {};
  body = body || {};
  for (var key in body) {
    if (Object.prototype.hasOwnProperty.call(body, key)) requestBody[key] = body[key];
  }
  var maxAttempts = Math.min(Math.max(Number(body.retry_attempts || body._retry_attempts || 3) || 3, 1), 5);
  delete requestBody.retry_attempts;
  delete requestBody._retry_attempts;
  var options = {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };
  var requestBytes = options.payload.length;
  if (anonKey) {
    options.headers = {
      apikey: anonKey,
      Authorization: 'Bearer ' + anonKey
    };
  }

  var lastError = null;
  for (var attempt = 1; attempt <= maxAttempts; attempt += 1) {
    var attemptStartedAt = Date.now();
    try {
      var response = UrlFetchApp.fetch(url, {
        method: options.method,
        contentType: options.contentType,
        payload: options.payload,
        muteHttpExceptions: options.muteHttpExceptions,
        headers: options.headers || {}
      });

      var code = response.getResponseCode();
      var text = response.getContentText() || '';
      var fetchTrace = {
        status_code: code,
        attempt: attempt,
        max_attempts: maxAttempts,
        duration_ms: Date.now() - attemptStartedAt,
        request_bytes: requestBytes,
        response_bytes: text.length,
        url: url
      };
      try {
        console.log(JSON.stringify(Object.assign({ event: 'manual_uploads_fetch_trace' }, fetchTrace)));
      } catch (logError) {}
      var parsed;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch (parseError) {
        if (attempt < maxAttempts && manualUploadsIsRetryableCode_(code)) {
          Utilities.sleep(manualUploadsRetryDelayMs_(attempt));
          continue;
        }
        throw new Error('Edge Function returned non-JSON response: HTTP ' + code + ' ' + text.slice(0, 500));
      }

      if (code < 200 || code >= 300 || parsed.ok === false) {
        var message = parsed.error || parsed.message || text.slice(0, 500) || ('Edge Function HTTP ' + code);
        if (attempt < maxAttempts && manualUploadsIsRetryableCode_(code)) {
          Utilities.sleep(manualUploadsRetryDelayMs_(attempt));
          continue;
        }
        if (parsed && typeof parsed === 'object') parsed.apps_script_trace = fetchTrace;
        throw new Error('Edge Function HTTP ' + code + ': ' + message);
      }

      if (parsed && typeof parsed === 'object') parsed.apps_script_trace = fetchTrace;
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && manualUploadsIsRetryableFetchError_(error)) {
        Utilities.sleep(manualUploadsRetryDelayMs_(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Edge Function request failed');
}

function manualUploadsIsRetryableCode_(code) {
  return [408, 429, 500, 502, 503, 504].indexOf(Number(code)) !== -1;
}

function manualUploadsRetryDelayMs_(attempt) {
  return Math.min(8000, 1000 * Number(attempt || 1) * Number(attempt || 1));
}

function manualUploadsIsRetryableFetchError_(error) {
  var message = String(error && error.message ? error.message : error || '').toLowerCase();
  return message.indexOf('address unavailable') !== -1
    || message.indexOf('dns') !== -1
    || message.indexOf('timed out') !== -1
    || message.indexOf('timeout') !== -1
    || message.indexOf('service invoked too many') !== -1
    || message.indexOf('request failed') !== -1
    || message.indexOf('network') !== -1;
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

function manualUploadsTaskMasterBasicUrl_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_TASK_MASTER_BASIC_FUNCTION_URL')) || MANUAL_UPLOADS_TASK_MASTER_BASIC_URL;
}

function shiftOpeningFunctionUrl_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_SHIFT_OPENING_FUNCTION_URL')) || SHIFT_OPENING_DEFAULT_FUNCTION_URL;
}

function manualUploadsServiceUrl_() {
  try {
    return manualUploadsNormalize_(ScriptApp.getService().getUrl());
  } catch (_error) {
    return '';
  }
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

function manualUploadsUsdTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_USD_TASK_TYPE_OPTION_ID'));
}

function manualUploadsTmmTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_TMM_TASK_TYPE_OPTION_ID'));
}

function manualUploadsAfterSaleMovementTaskTypeOptionId_() {
  return manualUploadsNormalize_(PropertiesService.getScriptProperties().getProperty('WEEEK_AFTER_SALE_MOVEMENT_TASK_TYPE_OPTION_ID'))
    || 'a285cb92-1279-45e1-88a5-972c40bd76e7';
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
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
	      responsibility_zone: 'Исходящий поток',
	      sort_order: 100
	    },
	    {
	      module: 'usd',
	      label: 'USD',
	      source_module: 'manual_no_order',
	      upload_type: 'no_order',
	      upload_offset_days: 0,
	      task_deadline_days: 2,
	      is_required: false,
	      responsibility_zone: 'Исходящий поток',
	      sort_order: 105
	    },
	    {
	      module: 'tmm',
	      label: 'TMM',
	      source_module: 'manual_no_order',
	      upload_type: 'no_order',
	      upload_offset_days: 0,
	      task_deadline_days: 2,
	      is_required: false,
	      responsibility_zone: 'Исходящий поток',
	      sort_order: 106
	    },
	    {
	      module: 'after_sale_movement',
	      label: 'Движение после продажи',
      source_module: 'manual_after_sale_movement',
      upload_type: 'after_sale_movement',
	      upload_offset_days: 0,
	      task_deadline_days: 2,
	      is_required: true,
	      responsibility_zone: 'Исходящий поток',
	      sort_order: 110
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

function manualUploadsBoolean_(value, fallback) {
  if (value === true || value === false) return value;
  var normalized = manualUploadsNormalize_(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'да'].indexOf(normalized) !== -1) return true;
  if (['0', 'false', 'no', 'нет'].indexOf(normalized) !== -1) return false;
  return fallback;
}

function manualUploadsWmsOnly_(req) {
  req = req && typeof req === 'object' ? req : {};
  var targetSystem = manualUploadsNormalize_(req.target_system || req.targetSystem).toLowerCase();
  return targetSystem === 'wms'
    || manualUploadsBoolean_(req.wms_only, false)
    || manualUploadsBoolean_(req.supabase_only, false)
    || manualUploadsBoolean_(req.create_weeek_tasks, true) === false;
}

function manualUploadsResponsibilityZone_(cfg, fallback) {
  var value = manualUploadsNormalize_(cfg && cfg.responsibility_zone) || manualUploadsNormalize_(fallback);
  if (value === 'Входящий поток' || value === 'Исходящий поток' || value === 'Нет привязки') return value;
  var normalized = value.toLowerCase();
  if (normalized.indexOf('вход') !== -1) return 'Входящий поток';
  if (normalized.indexOf('исход') !== -1) return 'Исходящий поток';
  return 'Нет привязки';
}

function manualUploadsPlannedUploadDate_(businessDate, cfg, fallbackOffset) {
  var offset = manualUploadsNumber_(cfg && cfg.upload_offset_days, fallbackOffset || 0);
  return manualUploadsAddDaysIso_(businessDate, -offset);
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
