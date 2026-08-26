/**
 * Web App iframe для прогресса ОПП в WEEEK.
 * Развернуть как Google Apps Script Web App.
 */

const OPP_FRAME_DEFAULT_WH_ID = '50144199';
const OPP_FRAME_SUPABASE_URL = 'https://bgphllmzmlwurfnbagho.supabase.co';
const OPP_FRAME_SUPABASE_ANON_KEY = '';
const OPP_FRAME_CACHE_TABLE = 'opp_reports_cache';
const OPP_FRAME_SETTINGS_TABLE = 'opp_alert_settings';
const OPP_FRAME_SHIFT_SCOPE = 'opp_telegram_shift';
const OPP_FRAME_SHIFT_FALLBACK_SCOPE = 'opp_dashboard_shift';
const OPP_FRAME_LAG_SCOPE = 'opp_telegram_rolling30';
const OPP_FRAME_LAG_FALLBACK_SCOPE = 'opp_dashboard_rolling30';

function doGet(e) {
  const token = String((e && e.parameter && e.parameter.token) || '').trim();
  if (!oppFrameHasAccess_(token)) {
    return HtmlService.createHtmlOutput('Доступ запрещен').setTitle('Прогресс ОПП');
  }

  const view = String((e && e.parameter && e.parameter.view) || '').trim().toLowerCase();
  const templateName = view === 'strip' ? 'OppShiftStrip' : 'OppShiftIframe';
  const template = HtmlService.createTemplateFromFile(templateName);
  template.initialConfig = {
    wh_id: String((e && e.parameter && e.parameter.wh_id) || OPP_FRAME_DEFAULT_WH_ID).trim(),
    refresh: Number((e && e.parameter && e.parameter.refresh) || 60),
    date: String((e && e.parameter && e.parameter.date) || '').trim(),
    shift_id: String((e && e.parameter && e.parameter.shift_id) || '').trim(),
    view: view || 'full',
    token: token,
  };

  return template
    .evaluate()
    .setTitle(view === 'strip' ? 'Прогресс ОПП — полоска' : 'Прогресс ОПП')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getOppFrameData(request) {
  const req = request && typeof request === 'object' ? request : {};
  oppFrameAssertAccess_(String(req.token || '').trim());

  const whId = String(req.wh_id || OPP_FRAME_DEFAULT_WH_ID).trim();
  const shiftScope = String(req.scope || OPP_FRAME_SHIFT_SCOPE).trim();
  const shiftFallbackScope = String(req.fallback_scope || OPP_FRAME_SHIFT_FALLBACK_SCOPE).trim();
  const lagScope = String(req.lag_scope || OPP_FRAME_LAG_SCOPE).trim();
  const lagFallbackScope = String(req.lag_fallback_scope || OPP_FRAME_LAG_FALLBACK_SCOPE).trim();

  const shiftRow = oppFrameFetchLatestCache_([shiftScope, shiftFallbackScope], whId);
  if (!shiftRow) {
    return {
      ok: false,
      error: 'Нет кэша для wh_id=' + whId + ', scope=' + shiftScope,
    };
  }

  return {
    ok: true,
    wh_id: whId,
    cache_row: shiftRow,
    payload: oppFrameParseMaybeJson_(shiftRow.payload),
    lag_cache_row: oppFrameFetchLatestCache_([lagScope, lagFallbackScope], whId),
    options: oppFrameFetchAlertSettings_(whId),
  };
}

function oppFrameHasAccess_(token) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('OPP_IFRAME_TOKEN') || '').trim();
  return !expected || token === expected;
}

function oppFrameAssertAccess_(token) {
  if (!oppFrameHasAccess_(token)) {
    throw new Error('Доступ запрещен');
  }
}

function oppFrameSupabaseKey_() {
  return String(PropertiesService.getScriptProperties().getProperty('SUPABASE_ANON_KEY') || OPP_FRAME_SUPABASE_ANON_KEY).trim();
}

function oppFrameSupabaseUrl_() {
  return String(PropertiesService.getScriptProperties().getProperty('SUPABASE_URL') || OPP_FRAME_SUPABASE_URL).replace(/\/+$/, '');
}

function oppFrameFetchLatestCache_(scopes, whId) {
  const list = [];
  (scopes || []).forEach(function(scope) {
    const safe = String(scope || '').trim();
    if (safe && list.indexOf(safe) === -1) list.push(safe);
  });

  for (var i = 0; i < list.length; i += 1) {
    const scope = list[i];
    const query = [
      'select=' + encodeURIComponent('wh_id,cache_scope,date_from,date_to,payload,refreshed_at,source_generated_at,stale_after'),
      'wh_id=eq.' + encodeURIComponent(whId),
      'cache_scope=eq.' + encodeURIComponent(scope),
      'order=refreshed_at.desc',
      'limit=1',
    ].join('&');
    const rows = oppFrameFetchSupabase_(OPP_FRAME_CACHE_TABLE, query);
    if (rows && rows.length) return rows[0];
  }

  return null;
}

function oppFrameFetchAlertSettings_(whId) {
  const defaults = {
    min_total_percent: 70,
    warn_total_percent: 85,
    min_sum_percent: 70,
    warn_sum_percent: 85,
    min_expensive_percent: 70,
    warn_expensive_percent: 95,
    low_quality_threshold_percent: 70,
    include_warnings: true,
    lag_missing_upload_penalty_percent: 10,
  };

  try {
    const query = [
      'select=' + encodeURIComponent('alert_type,setting_key,setting_value,value_type'),
      'wh_id=eq.' + encodeURIComponent(whId),
      'alert_type=in.' + encodeURIComponent('(summary,lag_attention)'),
    ].join('&');
    const rows = oppFrameFetchSupabase_(OPP_FRAME_SETTINGS_TABLE, query);
    (rows || []).forEach(function(row) {
      const key = String(row.setting_key || '').trim();
      if (!key) return;
      let value = oppFrameParseMaybeJson_(row.setting_value);
      if (row.value_type === 'number') value = Number(value || 0);
      if (row.value_type === 'boolean') value = value === true || String(value).toLowerCase() === 'true';
      defaults[key] = value;
    });
  } catch (error) {
    console.warn('Не удалось прочитать настройки алертов:', error && error.message ? error.message : error);
  }

  return defaults;
}

function oppFrameFetchSupabase_(tableName, query) {
  const key = oppFrameSupabaseKey_();
  if (!key || key.indexOf('placeholder') !== -1) {
    throw new Error('Не задан SUPABASE_ANON_KEY в Script properties');
  }

  const url = oppFrameSupabaseUrl_() + '/rest/v1/' + encodeURIComponent(tableName) + '?' + query;
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/json',
    },
  });

  const code = response.getResponseCode();
  const body = response.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('Supabase HTTP ' + code + ': ' + body.slice(0, 500));
  }

  return body ? JSON.parse(body) : [];
}

function oppFrameParseMaybeJson_(value) {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw || (raw.charAt(0) !== '{' && raw.charAt(0) !== '[')) return value;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return value;
  }
}
