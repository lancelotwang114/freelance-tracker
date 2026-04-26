/**
 * 外包收益與排程管理 - Google Apps Script 後端
 *
 * 部署方式：
 * 1. 在 Google Sheet 內點「擴充功能 → Apps Script」打開編輯器
 * 2. 把這整個檔案的內容貼進去（覆蓋預設的 Code.gs）
 * 3. 修改下方 API_TOKEN 為你自己想的密碼（任意字串，越亂越好）
 * 4. 點「部署 → 新增部署 → Web App」
 *    - 執行身分：「我」
 *    - 誰可以存取：「任何人」（我們靠 token 做驗證）
 * 5. 取得 Web App URL，連同 TOKEN 一起貼到前端設定頁
 *
 * API 設計：
 *   GET  ?action=ping&token=XXX                    測試連線
 *   GET  ?action=list&token=XXX                    取得全部資料
 *   POST {action:'save', token, data}              存回全部資料
 *   POST {action:'syncCalendar', token, calendarId, jobs, clients} 同步到 Google Calendar
 *   POST {action:'testCalendar', token, calendarId} 測試 Calendar 是否可存取
 */

// ====== 🔧 你要改的地方 ======
const API_TOKEN = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING';
// 建議：32 字元以上，含英數大小寫。可以用 1Password 或 bit.ly/gen-pw 產生。
// 這個 token 絕對不能外流 — 有這個 token 的人就能讀寫你全部資料。
// ================================

// v2.9.2: 加 _extra 欄位 — 任何前端送來但不在 COLS 裡的欄位
// 自動以 JSON 形式存進 _extra；pull 時自動展開
// 這樣以後前端加新欄位永遠不會丟資料
const COLS = {
  clients: [
    'id', 'name', 'color', 'note',
    'commissionRate', 'commissionTo',
    'prepaidMode', 'prepayments',
    'billingDay', 'billingRemindDays', 'unpaidRemindDaysOverride',
    '_extra'   // ← 兜底欄位
  ],
  jobs: [
    'id', 'clientId', 'date', 'title', 'details', 'amount',
    'done', 'paid', 'doneAt', 'paidAt',
    'endDate', 'tag', 'cancelled',
    'hoursWorked',
    'isEstimate', 'subtasks', 'timeSpentMs',
    'discountType', 'discountValue', 'payments', 'writeOff',
    '_extra'   // ← 兜底欄位
  ],
  config:  ['key', 'value']
};

// ============== HTTP 入口 ==============

function doGet(e) {
  return handle_(e, 'GET');
}

function doPost(e) {
  return handle_(e, 'POST');
}

function handle_(e, method) {
  try {
    let body = {};
    if (method === 'POST' && e.postData) {
      try { body = JSON.parse(e.postData.contents); } catch (_) {}
    }
    const params = Object.assign({}, e.parameter, body);
    const action = params.action || 'ping';

    // Token 驗證（ping 也要驗，避免亂 poke）
    if (params.token !== API_TOKEN) {
      return json_({ ok: false, error: 'Invalid or missing token' });
    }

    switch (action) {
      case 'ping':
        return json_({ ok: true, pong: true, time: new Date().toISOString() });
      case 'getMeta':
        return json_({ ok: true, meta: getMeta_() });
      case 'list':
        return json_({ ok: true, data: readAll_(), meta: getMeta_(), listedAt: new Date().toISOString() });
      case 'save':
        // v2.2: schema 不匹配保護 — 來源 schema 不可低於雲端
        const cloudMeta = getMeta_() || {};
        const cloudSchema = +cloudMeta.schemaVersion || 0;
        const clientSchema = +params.schemaVersion || 0;
        if (cloudSchema > 0 && clientSchema > 0 && clientSchema < cloudSchema) {
          return json_({
            ok: false,
            error: 'SCHEMA_TOO_OLD',
            message: `客戶端 schema v${clientSchema} 低於雲端 v${cloudSchema}，請重新整理網頁取得新版`,
            cloudSchema,
            clientSchema
          });
        }
        // 寫入前自動 snapshot（含冷卻判斷與分層 tier）
        snapshotCurrent_(params.snapshotNote || 'auto-save', {
          tier: 'auto',
          device: params.deviceLabel || 'unknown'
        });
        writeAll_(params.data || {});
        updateMeta_(params.deviceLabel || 'unknown', {
          schemaVersion: clientSchema,
          appVersion: params.appVersion || ''
        });
        return json_({ ok: true, savedAt: new Date().toISOString(), meta: getMeta_() });
      case 'listSnapshots':
        return json_({ ok: true, snapshots: listSnapshots_() });
      case 'getSnapshot':
        return json_({ ok: true, snapshot: getSnapshot_(params.snapshotId) });
      case 'restoreSnapshot':
        return json_({ ok: true, result: restoreSnapshot_(params.snapshotId, params.deviceLabel || 'unknown') });
      case 'manualSnapshot':
        return json_({ ok: true, result: snapshotCurrent_(params.note || '手動備份', {
          tier: 'manual',
          device: params.deviceLabel || 'unknown'
        }) });
      case 'pruneSnapshots':
        return json_({ ok: true, result: pruneSnapshots_() });
      case 'setupDailyTrigger':
        return json_({ ok: true, result: setupDailyTrigger() });
      case 'acquireLock':
        return json_({ ok: true, lock: acquireLock_(params.deviceLabel || 'unknown') });
      case 'releaseLock':
        return json_({ ok: true, result: releaseLock_(params.deviceLabel || 'unknown') });
      case 'getLock':
        return json_({ ok: true, lock: getLockStatus_() });
      case 'forceReleaseLock':
        return json_({ ok: true, result: releaseLock_(null, true) });
      case 'icalendar':
      case 'ical':
        // 直接回純文字 iCal 格式，多數行事曆客戶端會以內容判斷格式
        return ContentService
          .createTextOutput(buildICalendar_())
          .setMimeType(ContentService.MimeType.TEXT);
      case 'testCalendar':
        return json_({ ok: true, result: testCalendar_(params.calendarId) });
      case 'syncCalendar':
        return json_({ ok: true, result: syncCalendar_(params.calendarId, params.jobs, params.clients, params.reminderMinutes) });
      default:
        return json_({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err), stack: err.stack });
  }
}

// ============== Sheet 讀取 ==============

function readAll_() {
  return {
    clients: readTable_('clients'),
    jobs:    readTable_('jobs'),
    config:  readConfig_()
  };
}

function readTable_(name) {
  const sheet = getOrCreateSheet_(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const cols = COLS[name];
  const values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();

  return values
    .filter(row => row[0])  // 跳過沒有 id 的空列
    .map(row => {
      const obj = {};
      let extraData = null;
      cols.forEach((c, i) => {
        let v = row[i];
        // _extra 欄位 → 解 JSON 後 merge 進 obj（最後處理，不覆蓋已知欄位）
        if (c === '_extra') {
          if (v) { try { extraData = JSON.parse(v); } catch (_) {} }
          return;
        }
        // 數值
        if (c === 'amount' || c === 'commissionRate' || c === 'discountValue' ||
            c === 'writeOff' || c === 'timeSpentMs' || c === 'billingDay' ||
            c === 'billingRemindDays') {
          v = Number(v) || 0;
        }
        // 可為 null
        if (c === 'hoursWorked' || c === 'unpaidRemindDaysOverride') {
          v = (v === '' || v == null) ? null : (Number(v) || 0);
        }
        // 布林
        if (c === 'done' || c === 'paid' || c === 'cancelled' || c === 'prepaidMode' || c === 'isEstimate') {
          v = (v === true || v === 'TRUE' || v === 'true' || v === 1);
        }
        // 日期字串
        if (c === 'date' || c === 'doneAt' || c === 'paidAt' || c === 'endDate') {
          v = normalizeDate_(v);
        }
        // JSON 陣列
        if (c === 'prepayments' || c === 'payments' || c === 'subtasks') {
          try { v = v ? JSON.parse(v) : []; } catch (_) { v = []; }
        }
        // 預設字串/列舉
        if (c === 'discountType' && (!v || v === '')) v = 'none';
        obj[c] = v;
      });
      // 把 _extra 裡的所有 key 補進 obj（不覆蓋既有欄位）
      if (extraData && typeof extraData === 'object') {
        Object.keys(extraData).forEach(k => {
          if (!(k in obj)) obj[k] = extraData[k];
        });
      }
      return obj;
    });
}

function readConfig_() {
  const sheet = getOrCreateSheet_('config');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const config = {};
  values.forEach(([key, value]) => {
    if (!key) return;
    // 支援 dotted key：userInfo.name → config.userInfo.name
    const parts = String(key).split('.');
    let cur = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    // 嘗試反序列化特殊值
    if (value === 'TRUE' || value === true) value = true;
    else if (value === 'FALSE' || value === false) value = false;
    else if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    cur[parts[parts.length-1]] = value;
  });
  return config;
}

// ============== Sheet 寫入 ==============

function writeAll_(data) {
  // v2.1: 寫入前先建一個「rollback」用 snapshot；若寫入過程出錯則自動還原
  let rollbackSnapshot = null;
  try {
    rollbackSnapshot = snapshotCurrent_('pre-write rollback', { tier: 'restore', device: 'auto-rollback' });
  } catch (e) {
    Logger.log('rollback snapshot 建立失敗，繼續寫入: ' + e.message);
  }
  try {
    if (data.clients) writeTable_('clients', data.clients);
    if (data.jobs)    writeTable_('jobs',    data.jobs);
    if (data.config)  writeConfig_(data.config);
  } catch (writeErr) {
    Logger.log('writeAll_ 失敗，嘗試從 rollback snapshot 還原: ' + writeErr.message);
    if (rollbackSnapshot && rollbackSnapshot.id) {
      try {
        const sheet = ensureSnapshotSchema_();
        const lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          const values = sheet.getRange(2, 1, lastRow - 1, SNAPSHOT_COLS.length).getValues();
          const row = values.find(r => String(r[0]) === String(rollbackSnapshot.id));
          if (row) {
            const oldData = JSON.parse(joinChunks_(row.slice(SNAPSHOT_DATA_COL_INDEX)));
            if (oldData.clients) writeTable_('clients', oldData.clients);
            if (oldData.jobs)    writeTable_('jobs',    oldData.jobs);
          }
        }
      } catch (rollbackErr) {
        Logger.log('rollback 也失敗了: ' + rollbackErr.message);
      }
    }
    throw writeErr;  // 把原始錯誤往上拋，讓前端知道
  }
}

function writeTable_(name, rows) {
  const sheet = getOrCreateSheet_(name);
  const cols = COLS[name];
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, cols.length).clearContent();
  }
  if (!rows || !rows.length) return;
  // v2.9.2: 已知欄位（不含 _extra）
  const knownCols = cols.filter(c => c !== '_extra');
  const values = rows.map(r => cols.map(c => {
    if (c === '_extra') {
      // 收集所有不在 COLS 裡的 keys → 序列化存入 _extra
      const extra = {};
      Object.keys(r || {}).forEach(k => {
        if (!knownCols.includes(k) && k !== '_extra') extra[k] = r[k];
      });
      return Object.keys(extra).length ? JSON.stringify(extra) : '';
    }
    const v = r[c];
    if (v === null || v === undefined) return '';
    // 陣列／物件欄位（例如 prepayments、payments、subtasks）以 JSON 字串儲存
    if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) {
      return JSON.stringify(v);
    }
    return v;
  }));
  sheet.getRange(2, 1, values.length, cols.length).setValues(values);
}

function writeConfig_(config) {
  const sheet = getOrCreateSheet_('config');
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
  }
  const flat = [];
  flatten_(config, '', flat);
  if (!flat.length) return;
  sheet.getRange(2, 1, flat.length, 2).setValues(flat);
}

function flatten_(obj, prefix, out) {
  Object.keys(obj).forEach(k => {
    const full = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      flatten_(v, full, out);
    } else {
      out.push([full, v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v)]);
    }
  });
}

// ============== 工具 ==============

function getOrCreateSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    // 空表：補上標題列
    sheet.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]]);
    sheet.setFrozenRows(1);
  } else if (COLS[name]) {
    // schema 升級：若現有欄位數少於 COLS，自動補上新 header
    const lastCol = sheet.getLastColumn();
    if (lastCol < COLS[name].length) {
      sheet.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function normalizeDate_(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============== Snapshot 備份機制（防止資料遺失）==============
// v2: 分層保留 + 冷卻 + 每日強制 + 編輯鎖

// v2.9.3: data 欄位拆 10 份（4×45K=180K → 10×45K=450K，留 2.5x 成長空間）
const SNAPSHOT_COLS = [
  'id', 'timestamp', 'tier', 'device', 'note', 'dataSize',
  'data1', 'data2', 'data3', 'data4', 'data5',
  'data6', 'data7', 'data8', 'data9', 'data10'
];
const SNAPSHOT_DATA_COL_INDEX = 6;
const SNAPSHOT_DATA_COL_COUNT = 10;
const CELL_MAX_CHARS = 45000;
const SNAPSHOT_RETENTION = {
  cooldownMinutes: 5,        // auto tier 冷卻時間
  hourlyKeepHours: 24,       // 最近 24 小時每小時保 1
  dailyKeepDays: 30,         // 過去 30 天每天保 1
  weeklyKeepWeeks: 12        // 過去 12 週每週保 1
};
const PERMANENT_TIERS = ['force', 'manual', 'restore'];

/** 把長 JSON 字串切成最多 10 段（450K 字元上限） */
function chunkData_(jsonStr) {
  const chunks = new Array(SNAPSHOT_DATA_COL_COUNT).fill('');
  for (let i = 0; i < SNAPSHOT_DATA_COL_COUNT; i++) {
    const start = i * CELL_MAX_CHARS;
    if (start >= jsonStr.length) break;
    chunks[i] = jsonStr.substring(start, start + CELL_MAX_CHARS);
  }
  if (jsonStr.length > SNAPSHOT_DATA_COL_COUNT * CELL_MAX_CHARS) {
    // 超出 450K 才警告（極少見）
    Logger.log('⚠️ Snapshot data 超過 ' + (SNAPSHOT_DATA_COL_COUNT * CELL_MAX_CHARS) + ' 字元：' + jsonStr.length);
  }
  return chunks;
}

/** 從 N 個分塊還原回完整 JSON 字串（接受 row array 或 individual args） */
function joinChunks_() {
  let parts = [];
  if (arguments.length === 1 && Array.isArray(arguments[0])) {
    parts = arguments[0];
  } else {
    parts = Array.prototype.slice.call(arguments);
  }
  return parts.map(p => String(p || '')).join('');
}

/**
 * 確保 snapshots 分頁存在且為新 schema（6 欄）。
 * 自動偵測舊 schema（4 欄）並升級。
 */
function ensureSnapshotSchema_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('snapshots');
  if (!sheet) {
    sheet = ss.insertSheet('snapshots');
    sheet.getRange(1, 1, 1, SNAPSHOT_COLS.length).setValues([SNAPSHOT_COLS]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(3, 80);
    sheet.setColumnWidth(4, 120);
    sheet.setColumnWidth(5, 200);
    sheet.setColumnWidth(6, 80);
    return sheet;
  }
  // 偵測舊 schema 並升級到最新（16 欄：metadata 6 + data 10）
  const lastCol = sheet.getLastColumn();
  if (lastCol < SNAPSHOT_COLS.length) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const oldData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      let newRows = [];
      if (lastCol === 4) {
        // v0：[id, timestamp, note, data]
        newRows = oldData.map(r => {
          const data = String(r[3] || '');
          const chunks = chunkData_(data);
          return [r[0], r[1], 'legacy', '', r[2], data.length, ...chunks];
        });
      } else if (lastCol === 6) {
        // v1：[id, timestamp, tier, device, note, data]
        newRows = oldData.map(r => {
          const data = String(r[5] || '');
          const chunks = chunkData_(data);
          return [r[0], r[1], r[2], r[3], r[4], data.length, ...chunks];
        });
      } else if (lastCol === 10) {
        // v2.1：[..., dataSize, data1-4] → 補到 data1-10
        newRows = oldData.map(r => {
          // r[6..9] 是 data1-4；保留並補 6 個空字串
          return [r[0], r[1], r[2], r[3], r[4], r[5], r[6]||'', r[7]||'', r[8]||'', r[9]||'', '', '', '', '', '', ''];
        });
      } else {
        newRows = [];
      }
      sheet.clear();
      sheet.getRange(1, 1, 1, SNAPSHOT_COLS.length).setValues([SNAPSHOT_COLS]);
      sheet.setFrozenRows(1);
      if (newRows.length) {
        sheet.getRange(2, 1, newRows.length, SNAPSHOT_COLS.length).setValues(newRows);
      }
    } else {
      sheet.clear();
      sheet.getRange(1, 1, 1, SNAPSHOT_COLS.length).setValues([SNAPSHOT_COLS]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/**
 * 建立一個 snapshot。
 * @param note  備註文字
 * @param opts  { tier: 'auto'|'manual'|'force'|'restore', device: '...' }
 *
 * tier 規則：
 *   auto    - 一般推送，受 5 分鐘冷卻；超過保留期會被 prune 刪掉
 *   manual  - 使用者手動觸發；永久保留（最多 50 份）
 *   force   - 每日強制（Apps Script trigger）；永久保留
 *   restore - 還原前的自動備份；永久保留
 */
function snapshotCurrent_(note, opts) {
  try {
    opts = opts || {};
    const tier = opts.tier || 'auto';
    const device = opts.device || 'unknown';

    // 冷卻判斷（只對 auto tier 套用）
    if (tier === 'auto') {
      const meta = getMeta_() || {};
      const lastAt = meta.lastSnapshotAt ? new Date(meta.lastSnapshotAt) : null;
      const now = new Date();
      if (lastAt && (now - lastAt) < SNAPSHOT_RETENTION.cooldownMinutes * 60 * 1000) {
        return { skipped: true, reason: 'cooldown' };
      }
    }

    const sheet = ensureSnapshotSchema_();

    // 讀當前資料；空資料不備份
    const current = readAll_();
    const jobCount = (current.jobs || []).length;
    const clientCount = (current.clients || []).length;
    if (jobCount === 0 && clientCount === 0) return null;

    const id = Utilities.getUuid().slice(0, 8);
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const data = JSON.stringify(current);
    const finalNote = `[${clientCount}c, ${jobCount}j] ${note || ''}`;
    const chunks = chunkData_(data);

    sheet.appendRow([id, ts, tier, device, finalNote, data.length].concat(chunks));

    // 更新 meta 的 lastSnapshotAt（只 auto/force 觸發冷卻）
    if (tier === 'auto' || tier === 'force') {
      setMetaField_('lastSnapshotAt', new Date().toISOString());
    }

    // 自動 prune（async-safe，包 try/catch）
    try { pruneSnapshots_(); } catch (e) { Logger.log('prune failed: ' + e.message); }

    return { id, timestamp: ts, tier };
  } catch (err) {
    Logger.log('Snapshot failed: ' + err.message);
    return null;
  }
}

/**
 * 分層保留策略，刪除過時 auto snapshot。
 * 永久保留：force / manual / restore
 * Hourly：最近 24 小時內，每小時保 1
 * Daily：過去 30 天內，每天保 1
 * Weekly：過去 12 週內，每週保 1
 * 超過範圍的 auto/legacy 直接刪
 */
function pruneSnapshots_() {
  const sheet = ensureSnapshotSchema_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { kept: 0, deleted: 0 };

  const all = sheet.getRange(2, 1, lastRow - 1, SNAPSHOT_COLS.length).getValues();
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  const items = all.map((row, i) => {
    const ts = row[1] instanceof Date ? row[1].getTime() : new Date(row[1]).getTime();
    return {
      rowIndex: i + 2,
      id: row[0],
      timestamp: ts,
      tier: String(row[2] || 'auto'),
      ageMs: now - ts
    };
  }).filter(s => !isNaN(s.timestamp) && s.id);

  const toKeep = new Set();

  // 永久保留
  items.forEach(s => {
    if (PERMANENT_TIERS.indexOf(s.tier) >= 0) toKeep.add(s.id);
  });

  // Hourly bucket
  const buckets = { hourly: {}, daily: {}, weekly: {} };
  items.forEach(s => {
    if (toKeep.has(s.id)) return;
    if (s.ageMs < SNAPSHOT_RETENTION.hourlyKeepHours * HOUR) {
      const key = Math.floor(s.timestamp / HOUR);
      if (!buckets.hourly[key] || s.timestamp < buckets.hourly[key].timestamp) {
        buckets.hourly[key] = s;
      }
    } else if (s.ageMs < SNAPSHOT_RETENTION.dailyKeepDays * DAY) {
      const key = Math.floor(s.timestamp / DAY);
      if (!buckets.daily[key] || s.timestamp < buckets.daily[key].timestamp) {
        buckets.daily[key] = s;
      }
    } else if (s.ageMs < SNAPSHOT_RETENTION.weeklyKeepWeeks * WEEK) {
      const key = Math.floor(s.timestamp / WEEK);
      if (!buckets.weekly[key] || s.timestamp < buckets.weekly[key].timestamp) {
        buckets.weekly[key] = s;
      }
    }
  });
  Object.keys(buckets).forEach(b => {
    Object.keys(buckets[b]).forEach(k => toKeep.add(buckets[b][k].id));
  });

  // 收集要刪的 row index（從下往上刪避免 index 位移）
  const toDelete = items.filter(s => !toKeep.has(s.id))
                         .map(s => s.rowIndex)
                         .sort(function(a,b){ return b-a; });

  toDelete.forEach(r => sheet.deleteRow(r));

  Logger.log('Prune: kept ' + toKeep.size + ', deleted ' + toDelete.length);
  return { kept: toKeep.size, deleted: toDelete.length };
}

/**
 * 每日強制 snapshot（Apps Script 時間觸發器呼叫）
 */
function dailyForceSnapshot() {
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return snapshotCurrent_('daily-' + dateStr, { tier: 'force', device: 'auto-trigger' });
}

/**
 * 設定每日 trigger（部署後執行一次即可）
 * 每天凌晨 3-4 點之間 trigger 一次
 */
function setupDailyTrigger() {
  const all = ScriptApp.getProjectTriggers();
  let removed = 0;
  all.forEach(t => {
    if (t.getHandlerFunction() === 'dailyForceSnapshot') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  ScriptApp.newTrigger('dailyForceSnapshot')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();
  return { removed: removed, created: 1, runsAt: '03:00-04:00 daily' };
}

/**
 * 列出所有 snapshot（含 tier、device）
 */
function listSnapshots_() {
  const sheet = ensureSnapshotSchema_();
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SNAPSHOT_COLS.length).getValues();
  return values.reverse().map(row => {
    const id = row[0];
    const ts = row[1];
    const tier = row[2];
    const device = row[3];
    const note = row[4];
    const dataSize = +row[5] || 0;
    const dataJson = joinChunks_(row.slice(SNAPSHOT_DATA_COL_INDEX));
    let stats = { clients: 0, jobs: 0, totalAmount: 0 };
    try {
      const obj = JSON.parse(dataJson);
      stats.clients = (obj.clients || []).length;
      stats.jobs = (obj.jobs || []).length;
      stats.totalAmount = (obj.jobs || []).reduce((s, j) => s + (+j.amount || 0), 0);
    } catch (e) {}
    return {
      id: String(id),
      timestamp: ts instanceof Date ? Utilities.formatDate(ts, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : String(ts),
      tier: String(tier || 'auto'),
      device: String(device || ''),
      note: String(note || ''),
      dataSize: dataSize,
      stats
    };
  }).filter(s => s.id);
}

/**
 * 取得特定 snapshot 的完整內容（用於前端預覽）
 */
function getSnapshot_(snapshotId) {
  const sheet = ensureSnapshotSchema_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('沒有 snapshot 紀錄');
  const values = sheet.getRange(2, 1, lastRow - 1, SNAPSHOT_COLS.length).getValues();
  const row = values.find(r => String(r[0]) === String(snapshotId));
  if (!row) throw new Error('找不到 snapshot: ' + snapshotId);
  try {
    const dataJson = joinChunks_(row.slice(SNAPSHOT_DATA_COL_INDEX));
    return {
      id: String(row[0]),
      timestamp: row[1] instanceof Date ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : String(row[1]),
      tier: String(row[2] || ''),
      device: String(row[3] || ''),
      note: String(row[4] || ''),
      dataSize: +row[5] || 0,
      data: JSON.parse(dataJson)
    };
  } catch (e) {
    throw new Error('Snapshot 解析失敗：' + e.message);
  }
}

// ============== Metadata（同步衝突保護）==============

function getMeta_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('metadata');
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const meta = {};
  values.forEach(([k, v]) => {
    if (k) meta[String(k)] = (v instanceof Date ? v.toISOString() : v);
  });
  return meta;
}

function updateMeta_(deviceLabel, opts) {
  try {
    opts = opts || {};
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('metadata');
    if (!sheet) {
      sheet = ss.insertSheet('metadata');
      sheet.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 140);
      sheet.setColumnWidth(2, 280);
    }
    const existing = getMeta_() || {};
    const ts = new Date().toISOString();
    const version = (+existing.version || 0) + 1;
    const data = readAll_();
    // 保留鎖、snapshot 戳記等非每次都要更新的欄位
    const preservedKeys = ['lastSnapshotAt', 'editLockBy', 'editLockAt', 'editLockExpiresAt'];
    const preserved = {};
    preservedKeys.forEach(k => { if (existing[k]) preserved[k] = existing[k]; });

    // schemaVersion 只升不降（防止舊版客戶端覆蓋）
    const incomingSchema = +opts.schemaVersion || 0;
    const existingSchema = +existing.schemaVersion || 0;
    const finalSchema = Math.max(incomingSchema, existingSchema);

    const coreRows = [
      ['version', version],
      ['lastModifiedAt', ts],
      ['lastDevice', deviceLabel || 'unknown'],
      ['clientsCount', (data.clients || []).length],
      ['jobsCount', (data.jobs || []).length],
      ['schemaVersion', finalSchema],
      ['appVersion', opts.appVersion || existing.appVersion || '']
    ];
    const preservedRows = Object.keys(preserved).map(k => [k, preserved[k]]);
    const newRows = coreRows.concat(preservedRows);

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
    }
    sheet.getRange(2, 1, newRows.length, 2).setValues(newRows);
  } catch (err) {
    Logger.log('updateMeta failed: ' + err.message);
  }
}

/**
 * 單獨更新 metadata 中的某個 key（不影響其他 key）
 */
function setMetaField_(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('metadata');
  if (!sheet) {
    sheet = ss.insertSheet('metadata');
    sheet.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
    sheet.setFrozenRows(1);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    sheet.appendRow([key, value]);
    return;
  }
  const range = sheet.getRange(2, 1, lastRow - 1, 2);
  const values = range.getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(key)) {
      sheet.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

// ============== 編輯鎖機制（軟鎖，3 分鐘 TTL）==============
// v2.1: TTL 從 5 分鐘縮短到 3 分鐘，配合前端 60 秒 heartbeat → 過期速度更快、卡死風險更低

const LOCK_TTL_MINUTES = 3;

/**
 * 取得鎖狀態（不會嘗試取得鎖）
 */
function getLockStatus_() {
  const meta = getMeta_() || {};
  const lockBy = meta.editLockBy;
  const expiresAt = meta.editLockExpiresAt ? new Date(meta.editLockExpiresAt) : null;
  if (!lockBy || !expiresAt) return { locked: false };
  // 過期視為無鎖
  if (expiresAt.getTime() < Date.now()) return { locked: false, expired: true };
  return {
    locked: true,
    by: lockBy,
    expiresAt: expiresAt.toISOString(),
    remainingMs: expiresAt.getTime() - Date.now()
  };
}

/**
 * 嘗試取得鎖（同一裝置呼叫會 heartbeat 延長）
 */
function acquireLock_(deviceLabel) {
  const status = getLockStatus_();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);

  // 沒鎖 OR 鎖已過期 OR 是自己 → 可取得/延長
  if (!status.locked || status.by === deviceLabel) {
    setMetaField_('editLockBy', deviceLabel);
    setMetaField_('editLockAt', now.toISOString());
    setMetaField_('editLockExpiresAt', expiresAt.toISOString());
    return {
      acquired: true,
      by: deviceLabel,
      expiresAt: expiresAt.toISOString(),
      remainingMs: LOCK_TTL_MINUTES * 60 * 1000
    };
  }
  // 別人持有鎖
  return {
    acquired: false,
    by: status.by,
    expiresAt: status.expiresAt,
    remainingMs: status.remainingMs
  };
}

/**
 * 釋放鎖。force=true 可強制清除（即使不是自己持有）
 */
function releaseLock_(deviceLabel, force) {
  const status = getLockStatus_();
  if (!status.locked) return { released: false, reason: 'not-locked' };
  if (!force && status.by !== deviceLabel) {
    return { released: false, reason: 'not-owner', currentOwner: status.by };
  }
  setMetaField_('editLockBy', '');
  setMetaField_('editLockAt', '');
  setMetaField_('editLockExpiresAt', '');
  return { released: true };
}

/**
 * 還原某個 snapshot
 * 還原前會先用 'restore' tier 自動 snapshot 當前狀態（永久保留）
 */
function restoreSnapshot_(snapshotId, deviceLabel) {
  const sheet = ensureSnapshotSchema_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('沒有 snapshot 紀錄');
  const values = sheet.getRange(2, 1, lastRow - 1, SNAPSHOT_COLS.length).getValues();
  const row = values.find(r => String(r[0]) === String(snapshotId));
  if (!row) throw new Error('找不到 snapshot: ' + snapshotId);

  const dataJson = joinChunks_(row.slice(SNAPSHOT_DATA_COL_INDEX));
  const data = JSON.parse(dataJson);

  // 還原前先用 'restore' tier 備份（永久保留）
  snapshotCurrent_('before restore ' + snapshotId, {
    tier: 'restore',
    device: deviceLabel || 'unknown'
  });

  if (data.clients) writeTable_('clients', data.clients);
  if (data.jobs) writeTable_('jobs', data.jobs);
  if (data.config) writeConfig_(data.config);

  // 還原後 bump version
  updateMeta_(deviceLabel || 'restore-op');

  return {
    restoredFrom: snapshotId,
    restoredAt: row[1] instanceof Date ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : row[1],
    clientCount: (data.clients || []).length,
    jobCount: (data.jobs || []).length
  };
}

// ============== iCal 訂閱輸出（v2.5）==============
/**
 * 把所有未取消的案件轉成 iCal VCALENDAR 字串，供 Google Calendar / iPhone 訂閱。
 * 訂閱後行事曆會自動每 15-30 分鐘拉一次更新（各家客戶端不同）。
 *
 * 規則：
 *   - 截止日（endDate）→ 全天事件，提前 1 天提醒
 *   - 沒 endDate 的用 date（執行日）
 *   - 已收款的案件不出現（已結束）
 *   - 已取消的不出現
 */
function buildICalendar_() {
  const data = readAll_();
  const jobs = (data.jobs || []).filter(j => !j.cancelled && !j.paid && (j.date || j.endDate));
  const clientMap = {};
  (data.clients || []).forEach(c => clientMap[c.id] = c);

  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyyMMdd\'T\'HHmmss');

  // v2.10.0：讀取使用者在前端設定的提醒分鐘數（由 syncCalendar_ 寫入 ScriptProperties）
  // 沒設過則用 16 小時（預設）。0 表示不提醒。
  let reminderMin = 16 * 60;
  try {
    const stored = PropertiesService.getScriptProperties().getProperty('CAL_REMINDER_MINUTES');
    if (stored !== null && stored !== '') {
      const n = +stored;
      if (!isNaN(n) && n >= 0) reminderMin = n;
    }
  } catch(e) {}
  // 把分鐘數轉成 iCal TRIGGER 格式：0 表不加 alarm；< 60 用 PTnM；< 1440 用 PTnH；其餘用 PnD
  function buildTrigger(min) {
    if (min <= 0) return null;
    if (min % 1440 === 0) return '-P' + (min / 1440) + 'D';
    if (min % 60 === 0) return '-PT' + (min / 60) + 'H';
    return '-PT' + min + 'M';
  }
  const trigger = buildTrigger(reminderMin);

  function escapeIcal(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function fmtDate(s) {
    // YYYY-MM-DD → YYYYMMDD
    return String(s || '').replace(/-/g, '').slice(0, 8);
  }

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FreelanceTracker//ZH-TW//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:外包案件截止日',
    'X-WR-TIMEZONE:' + tz,
    'X-WR-CALDESC:Freelance Tracker 自動產生'
  ];

  jobs.forEach(j => {
    const c = clientMap[j.clientId];
    const cname = c ? c.name : '?';
    const due = j.endDate || j.date;
    if (!due) return;
    const dt = fmtDate(due);
    const tomorrow = new Date(due + 'T00:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dtEnd = Utilities.formatDate(tomorrow, tz, 'yyyyMMdd');
    const summary = `${j.done ? '✓ ' : ''}${cname}：${j.title || '(無標題)'}`;
    const desc = [
      `業主：${cname}`,
      `金額：NT$ ${(+j.amount || 0).toLocaleString()}`,
      j.tag ? `類型：${j.tag}` : null,
      j.details ? `說明：${j.details}` : null,
      j.done ? '狀態：已完成' : '狀態：進行中',
      j.endDate && j.date && j.endDate !== j.date ? `執行日：${j.date}` : null
    ].filter(Boolean).join('\\n');

    ics.push('BEGIN:VEVENT');
    ics.push('UID:job-' + j.id + '@freelance-tracker');
    ics.push('DTSTAMP:' + now);
    ics.push('DTSTART;VALUE=DATE:' + dt);
    ics.push('DTEND;VALUE=DATE:' + dtEnd);
    ics.push('SUMMARY:' + escapeIcal(summary));
    ics.push('DESCRIPTION:' + escapeIcal(desc));
    if (c && c.color) ics.push('COLOR:' + c.color);
    // 提醒（依使用者設定；trigger 為 null 代表「不提醒」）
    if (trigger) {
      ics.push('BEGIN:VALARM');
      ics.push('ACTION:DISPLAY');
      ics.push('DESCRIPTION:' + escapeIcal('截止提醒：' + summary));
      ics.push('TRIGGER:' + trigger);
      ics.push('END:VALARM');
    }
    ics.push('END:VEVENT');
  });

  ics.push('END:VCALENDAR');
  return ics.join('\r\n');
}

// ============== Google Calendar 同步 ==============

/**
 * 【公開函式 — 第一次部署時用】觸發 Calendar API 授權對話框
 * 用途：Apps Script 函式選單看不到結尾有底線的私有函式（testCalendar_、syncCalendar_）
 *      所以提供這個沒有底線的公開包裝，讓使用者可以從編輯器的「執行」選單呼叫，
 *      觸發 Google 跳出 Calendar 權限授權對話框，按「允許」一次後永久生效。
 *
 * 使用步驟：
 *   1. Apps Script 編輯器 → 上方函式選單選 authorizeCalendar
 *   2. 按「執行」
 *   3. 跳出「需要授權」→ 按「審查權限」→ 選 Google 帳號 → 進階 → 前往（不安全）→ 允許
 *   4. 執行紀錄看到 "✓ Calendar 授權成功" 即完成
 *   5. 之後前端「測試連線」就能正常呼叫了
 */
function authorizeCalendar() {
  const cal = CalendarApp.getDefaultCalendar();
  const name = cal.getName();
  const tz = cal.getTimeZone();
  Logger.log('✓ Calendar 授權成功');
  Logger.log('  預設日曆：' + name);
  Logger.log('  時區：' + tz);
  Logger.log('  之後前端的「測試連線 / 同步到 Google 行事曆」就能正常使用了。');
  return { ok: true, calendar: name, timezone: tz };
}

/**
 * 測試 Calendar 是否可存取
 * 用途：使用者按「測試連線」時，檢查 Calendar ID 是否有效、是否有權限
 */
function testCalendar_(calendarId) {
  if (!calendarId) throw new Error('缺少 calendarId');
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) {
    throw new Error(`找不到此 Calendar：${calendarId}\n\n可能原因：\n1. Calendar ID 錯誤\n2. 該 Calendar 沒有分享給本 Apps Script 所屬帳號（需要編輯權限）`);
  }
  return {
    name: cal.getName(),
    timezone: cal.getTimeZone(),
    ownedBy: cal.isOwnedByMe() ? '本帳號' : '外部共享',
    canEdit: true
  };
}

/**
 * 同步全部案件到 Google Calendar
 * 策略：刪除所有由本工具建立的舊事件（依 TAG 搜尋），再重新建立最新的
 *
 * @param calendarId        目標 Calendar 的 ID（可是本帳號、也可是分享來的外部 Calendar）
 * @param jobs              案件陣列（從前端傳入，不讀 Sheet，減少依賴）
 * @param clients           業主陣列
 * @param reminderMinutes   提醒提前分鐘數（v2.10.0）：
 *                          0 = 不提醒；undefined = 預設 16 小時前；正數 = 那麼多分鐘前
 *                          會被存到 ScriptProperties 給 iCal 用
 */
function syncCalendar_(calendarId, jobs, clients, reminderMinutes) {
  if (!calendarId) throw new Error('缺少 calendarId');
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) throw new Error(`找不到 Calendar：${calendarId}`);

  // v2.10.0：解析提醒分鐘數，並把它存到 ScriptProperties，讓 iCal 也能讀到
  let effectiveReminder;
  if (reminderMinutes === 0 || reminderMinutes === '0') {
    effectiveReminder = 0;
  } else if (typeof reminderMinutes === 'number' && reminderMinutes > 0) {
    effectiveReminder = Math.round(reminderMinutes);
  } else if (typeof reminderMinutes === 'string' && +reminderMinutes > 0) {
    effectiveReminder = Math.round(+reminderMinutes);
  } else {
    effectiveReminder = 16 * 60;  // 沒傳就用預設 16 小時
  }
  try {
    PropertiesService.getScriptProperties().setProperty('CAL_REMINDER_MINUTES', String(effectiveReminder));
  } catch(e) {}

  jobs = jobs || [];
  clients = clients || [];
  const clientMap = {};
  clients.forEach(c => { clientMap[c.id] = c; });

  const TAG = '[ftracker]';  // 用來辨識「由本工具建立」的事件

  // 1. 刪除舊的同步事件（-5 年 ~ +2 年區間）
  const start = new Date();
  start.setFullYear(start.getFullYear() - 5);
  const end = new Date();
  end.setFullYear(end.getFullYear() + 2);

  let deleted = 0;
  const oldEvents = cal.getEvents(start, end, { search: TAG });
  oldEvents.forEach(e => {
    try { e.deleteEvent(); deleted++; } catch (err) {}
  });

  // 2. 業主顏色對應到 Google Calendar 的 11 種預設顏色
  const colorMap = {
    '#ef4444': CalendarApp.EventColor.RED,
    '#f59e0b': CalendarApp.EventColor.ORANGE,
    '#eab308': CalendarApp.EventColor.YELLOW,
    '#10b981': CalendarApp.EventColor.GREEN,
    '#14b8a6': CalendarApp.EventColor.TURQOISE || CalendarApp.EventColor.GREEN,
    '#0891b2': CalendarApp.EventColor.CYAN || CalendarApp.EventColor.GREEN,
    '#2563eb': CalendarApp.EventColor.BLUE,
    '#3b82f6': CalendarApp.EventColor.BLUE,
    '#8b5cf6': CalendarApp.EventColor.MAUVE,
    '#7c3aed': CalendarApp.EventColor.MAUVE,
    '#ec4899': CalendarApp.EventColor.PALE_RED || CalendarApp.EventColor.RED,
    '#e11d48': CalendarApp.EventColor.RED,
    '#92400e': CalendarApp.EventColor.ORANGE
  };

  // 3. 建立新事件
  let created = 0;
  const errors = [];

  jobs.forEach(j => {
    try {
      if (!j.date) return;
      const client = clientMap[j.clientId];
      const clientName = client ? client.name : '未指定';

      const statusTags = [];
      if (j.done) statusTags.push('✓完成');
      else statusTags.push('進行中');
      if (j.paid) statusTags.push('$已收');
      else if (j.done) statusTags.push('待收款');

      const title = `${TAG} ${clientName} - ${j.title} [${statusTags.join(' ')}]`;

      const descLines = [
        `💼 業主：${clientName}`,
        `💰 金額：NT$${(j.amount || 0).toLocaleString()}`
      ];
      if (j.details) descLines.push(`📝 細項：${j.details}`);
      descLines.push(`📌 狀態：${statusTags.join(' / ')}`);
      if (j.doneAt) descLines.push(`✅ 完成日：${j.doneAt}`);
      if (j.paidAt) descLines.push(`💵 收款日：${j.paidAt}`);
      descLines.push('', '— 由外包收益管理工具同步 —');

      const dateObj = new Date(j.date);
      const evt = cal.createAllDayEvent(title, dateObj, {
        description: descLines.join('\n')
      });

      if (client && client.color && colorMap[client.color]) {
        try { evt.setColor(colorMap[client.color]); } catch(e) {}
      }

      // 加入提醒（v2.10.0：提前分鐘數可由前端傳入）
      // 全日事件起點是該日 00:00，所以 960 分鐘前 = 前一天早上 8:00 提醒
      try {
        evt.removeAllReminders();           // 先清掉預設提醒
        if (effectiveReminder > 0) {
          evt.addPopupReminder(effectiveReminder);
        }
      } catch(e) {}

      created++;
    } catch (err) {
      errors.push(`${j.title || '(無標題)'}：${err.message}`);
    }
  });

  return {
    calendarName: cal.getName(),
    deleted: deleted,
    created: created,
    errors: errors,
    syncedAt: new Date().toISOString()
  };
}

// ============== 初始化（從 Apps Script 編輯器執行一次） ==============

/**
 * 第一次部署前手動執行這個函式，會自動建立 clients / jobs / config 三個分頁並填上標題列。
 * 執行方式：在 Apps Script 編輯器上方下拉選 initSheets，按執行鈕（▶）。
 * 第一次會跳權限授權，按同意即可。
 */
function initSheets() {
  getOrCreateSheet_('clients');
  getOrCreateSheet_('jobs');
  getOrCreateSheet_('config');
  Logger.log('✓ 已建立 clients / jobs / config 三個分頁');
}

/**
 * 測試函式：讀出目前 Sheet 所有資料（會印在執行紀錄）
 */
function testRead() {
  Logger.log(JSON.stringify(readAll_(), null, 2));
}

/**
 * 測試函式：模擬前端送進來一筆範例資料（執行後檢查 Sheet 有沒有資料進來）
 */
function testWrite() {
  writeAll_({
    clients: [
      { id: 'c1', name: 'A 公司', color: '#ef4444', note: '月結' }
    ],
    jobs: [
      { id: 'j1', clientId: 'c1', date: '2026-04-15', title: '首頁改版', details: '首頁+3 內頁', amount: 18000, done: true, paid: false, doneAt: '2026-04-20', paidAt: null }
    ],
    config: {
      userInfo: { name: '王小明', bank: '玉山銀行 (808)' }
    }
  });
  Logger.log('✓ 測試資料已寫入');
}
