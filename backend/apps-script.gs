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

const COLS = {
  clients: ['id', 'name', 'color', 'note', 'commissionRate', 'commissionTo', 'prepaidMode', 'prepayments'],
  jobs:    ['id', 'clientId', 'date', 'title', 'details', 'amount', 'done', 'paid', 'doneAt', 'paidAt', 'endDate', 'tag', 'cancelled'],
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
        // 寫入前自動 snapshot，避免資料遺失
        snapshotCurrent_(params.snapshotNote || 'before save');
        writeAll_(params.data || {});
        updateMeta_(params.deviceLabel || 'unknown');
        return json_({ ok: true, savedAt: new Date().toISOString(), meta: getMeta_() });
      case 'listSnapshots':
        return json_({ ok: true, snapshots: listSnapshots_() });
      case 'getSnapshot':
        return json_({ ok: true, snapshot: getSnapshot_(params.snapshotId) });
      case 'restoreSnapshot':
        return json_({ ok: true, result: restoreSnapshot_(params.snapshotId) });
      case 'testCalendar':
        return json_({ ok: true, result: testCalendar_(params.calendarId) });
      case 'syncCalendar':
        return json_({ ok: true, result: syncCalendar_(params.calendarId, params.jobs, params.clients) });
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
      cols.forEach((c, i) => {
        let v = row[i];
        if (c === 'amount' || c === 'commissionRate') v = Number(v) || 0;
        if (c === 'done' || c === 'paid' || c === 'cancelled' || c === 'prepaidMode') {
          v = (v === true || v === 'TRUE' || v === 'true' || v === 1);
        }
        if (c === 'date' || c === 'doneAt' || c === 'paidAt' || c === 'endDate') v = normalizeDate_(v);
        if (c === 'prepayments') {
          try { v = v ? JSON.parse(v) : []; } catch (_) { v = []; }
        }
        obj[c] = v;
      });
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
  if (data.clients) writeTable_('clients', data.clients);
  if (data.jobs)    writeTable_('jobs',    data.jobs);
  if (data.config)  writeConfig_(data.config);
}

function writeTable_(name, rows) {
  const sheet = getOrCreateSheet_(name);
  const cols = COLS[name];
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, cols.length).clearContent();
  }
  if (!rows || !rows.length) return;
  const values = rows.map(r => cols.map(c => {
    const v = r[c];
    if (v === null || v === undefined) return '';
    // 陣列／物件欄位（例如 prepayments）以 JSON 字串儲存，避免拍平丟失
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

/**
 * 把目前 Sheet 的所有資料壓縮成 JSON，存到 snapshots 分頁當備份。
 * 每次 writeAll_ 前會自動呼叫。
 * 超過 20 個 snapshot 會刪最舊的（避免分頁爆滿）。
 */
function snapshotCurrent_(note) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('snapshots');
    if (!sheet) {
      sheet = ss.insertSheet('snapshots');
      sheet.getRange(1, 1, 1, 4).setValues([['id', 'timestamp', 'note', 'data']]);
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 100);
      sheet.setColumnWidth(2, 180);
      sheet.setColumnWidth(3, 200);
      sheet.setColumnWidth(4, 400);
    }

    // 讀當前資料（如果完全是空的就不備份，避免首次設定時白佔一格）
    const current = readAll_();
    const jobCount = (current.jobs || []).length;
    const clientCount = (current.clients || []).length;
    if (jobCount === 0 && clientCount === 0) return null;

    const id = Utilities.getUuid().slice(0, 8);
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const data = JSON.stringify(current);
    const finalNote = `[${clientCount} clients, ${jobCount} jobs] ${note || ''}`;

    sheet.appendRow([id, ts, finalNote, data]);

    // 保留最近 20 個
    const lastRow = sheet.getLastRow();
    if (lastRow > 21) {
      sheet.deleteRows(2, lastRow - 21);
    }

    return { id, timestamp: ts };
  } catch (err) {
    // 備份失敗不該擋主流程，但記錄錯誤
    Logger.log('Snapshot failed: ' + err.message);
    return null;
  }
}

/**
 * 列出所有 snapshot（含詳細統計：業主數、案件數、總金額）
 */
function listSnapshots_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('snapshots');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  return values.reverse().map(([id, ts, note, dataJson]) => {
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
      note: String(note || ''),
      stats
    };
  }).filter(s => s.id);
}

/**
 * 取得特定 snapshot 的完整內容（用於前端預覽）
 */
function getSnapshot_(snapshotId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('snapshots');
  if (!sheet) throw new Error('沒有 snapshots 分頁');
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const row = values.find(r => String(r[0]) === String(snapshotId));
  if (!row) throw new Error('找不到 snapshot: ' + snapshotId);
  try {
    return {
      id: String(row[0]),
      timestamp: row[1] instanceof Date ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : String(row[1]),
      note: String(row[2] || ''),
      data: JSON.parse(row[3])
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

function updateMeta_(deviceLabel) {
  try {
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
    const newRows = [
      ['version', version],
      ['lastModifiedAt', ts],
      ['lastDevice', deviceLabel || 'unknown'],
      ['clientsCount', (data.clients || []).length],
      ['jobsCount', (data.jobs || []).length]
    ];
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
    }
    sheet.getRange(2, 1, newRows.length, 2).setValues(newRows);
  } catch (err) {
    Logger.log('updateMeta failed: ' + err.message);
  }
}

/**
 * 還原某個 snapshot
 * 還原前會先 snapshot 當前狀態（以防還原錯了還能回來）
 */
function restoreSnapshot_(snapshotId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('snapshots');
  if (!sheet) throw new Error('沒有 snapshots 分頁');

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const row = values.find(r => String(r[0]) === String(snapshotId));
  if (!row) throw new Error('找不到 snapshot: ' + snapshotId);

  const data = JSON.parse(row[3]);

  // 還原前先備份當前狀態
  snapshotCurrent_(`before restore ${snapshotId}`);

  // 直接寫（避開再次 snapshot 迴圈）
  if (data.clients) writeTable_('clients', data.clients);
  if (data.jobs) writeTable_('jobs', data.jobs);
  if (data.config) writeConfig_(data.config);

  return {
    restoredFrom: snapshotId,
    restoredAt: row[1],
    clientCount: (data.clients || []).length,
    jobCount: (data.jobs || []).length
  };
}

// ============== Google Calendar 同步 ==============

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
 * @param calendarId   目標 Calendar 的 ID（可是本帳號、也可是分享來的外部 Calendar）
 * @param jobs         案件陣列（從前端傳入，不讀 Sheet，減少依賴）
 * @param clients      業主陣列
 */
function syncCalendar_(calendarId, jobs, clients) {
  if (!calendarId) throw new Error('缺少 calendarId');
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) throw new Error(`找不到 Calendar：${calendarId}`);

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
