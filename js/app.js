/* =========================================
   外包收益與排程管理 - 主程式 v2.2
   ========================================= */

// ============== Data Layer ==============
const STORAGE_KEY = 'freelance-tracker-v1';
const CONFIG_KEY = 'freelance-tracker-config';
const APP_VERSION = '2026-04-27-v2.10.15';  // 與 index.html 的 meta 同步

// 版本比較（v2.10.1）
// 修正 v2.9.7 vs v2.10.0 的字串比較 bug（'1' < '9' 字元碼，導致大版號被判舊）
// 格式：YYYY-MM-DD-vX.Y.Z → 拆成數字陣列逐位比
// 回傳：-1=a 較舊、0=相同、1=a 較新
function compareAppVersion(a, b) {
  if (!a || !b) return 0;
  const parse = (s) => {
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})-v(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m) return null;
    return [+m[1], +m[2], +m[3], +m[4], +(m[5] || 0), +(m[6] || 0)];
  };
  const va = parse(a), vb = parse(b);
  if (!va || !vb) {
    // 格式對不上 → 退回字串比較
    return a < b ? -1 : a > b ? 1 : 0;
  }
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return va[i] < vb[i] ? -1 : 1;
  }
  return 0;
}

// ============== 操作日誌（v2.9.5）==============
const ACTION_LOG_KEY = 'ftActionLog_v1';
const ACTION_LOG_MAX = 500;
let actionLog = [];

function loadActionLog() {
  try { actionLog = JSON.parse(localStorage.getItem(ACTION_LOG_KEY) || '[]'); }
  catch (_) { actionLog = []; }
}

function saveActionLog() {
  if (actionLog.length > ACTION_LOG_MAX) actionLog = actionLog.slice(-ACTION_LOG_MAX);
  try { localStorage.setItem(ACTION_LOG_KEY, JSON.stringify(actionLog)); } catch (_) {}
}

function logAction(type, details) {
  actionLog.push({
    ts: Date.now(),
    type: type,
    details: details || {}
  });
  saveActionLog();
}

const ACTION_LABELS = {
  'job-create':       { icon: '🆕',   label: '新增案件' },
  'job-edit':         { icon: '✏️',   label: '編輯案件' },
  'job-delete':       { icon: '🗑️',   label: '刪除案件' },
  'job-done':         { icon: '✓',    label: '標完成' },
  'job-undo-done':    { icon: '↩',    label: '取消完成' },
  'job-paid':         { icon: '💰',   label: '標收款' },
  'job-undo-paid':    { icon: '↩',    label: '取消收款' },
  'client-create':    { icon: '🆕',   label: '新增業主' },
  'client-edit':      { icon: '✏️',   label: '編輯業主' },
  'client-delete':    { icon: '🗑️',   label: '刪除業主' },
  'bulk-done':        { icon: '✓',    label: '批次標完成' },
  'bulk-paid':        { icon: '💰',   label: '批次標收款' },
  'bulk-cancel':      { icon: '🚫',   label: '批次取消' },
  'bulk-discount':    { icon: '🏷️',   label: '批次設折扣' },
  'data-import':      { icon: '📥',   label: '匯入資料' },
  'data-clear':       { icon: '⚠️',   label: '清空資料' },
  'data-load-demo':   { icon: '🎲',   label: '載入範例' },
  'snapshot-restore': { icon: '↩',    label: '還原 snapshot' },
  'sync-pull':        { icon: '⬇️',   label: '從雲端拉取' },
  'sync-push':        { icon: '⬆️',   label: '推送到雲端' },
  'invoice-copy':     { icon: '📋',   label: '複製請款單' }
};
const COLORS = ['#ef4444','#f59e0b','#10b981','#2563eb','#8b5cf6','#ec4899','#14b8a6','#64748b'];

let state = {
  clients: [],
  jobs: [],
  filters: { clientId: 'all', month: 'current', status: 'all', tag: 'all', expandedYear: null, jobIdsOnly: null, jobIdsOnlyLabel: '' }
};

let config = {
  // 全域提醒參數（v2.7.9 起每個都個別可調，業主層級可覆寫 unpaidRemindDays）
  unpaidRemindDays: 7,           // 完成超過幾天未收款就提醒（全域預設）
  dueSoonDays: 3,                // 「即將到期」前幾天就提醒
  monthEndReminderDay: 25,       // 從每月第幾天開始顯示「月底提醒」
  enableOverdueAlert: true,      // 是否啟用「逾期未完成」提醒
  enableDueSoonAlert: true,      // 是否啟用「即將到期」提醒
  enableUnpaidLongAlert: true,   // 是否啟用「完成超過 N 天未收款」提醒
  enableMonthEndAlert: true,     // 是否啟用「月底提醒」
  enableBillingDayAlert: true,   // 是否啟用「業主固定請款日」提醒
  enableSlowPayAlert: true,      // 是否啟用「智慧拖款警告」

  // 我的收款資訊（顯示在請款單）
  // v2.10.13: bank / account 從單筆改成 paymentAccounts 陣列；舊欄位保留作為 fallback
  userInfo: {
    name: '',
    phone: '',
    email: '',
    invoiceTitle: '',
    bank: '',                          // 舊欄位（migration 後不再使用，但保留向下相容）
    account: '',                       // 舊欄位（同上）
    note: '',
    paymentAccounts: [],               // [{id, label, bank, account, note}]
    selectedPaymentAccountId: ''       // 預設使用哪一筆（請款單帶入）
  },

  // Google Sheet 雙向同步
  sheetConfig: {
    sheetUrl: '',
    apiUrl: '',
    apiToken: '',
    lastSyncAt: null,
    lastPullAt: null,
    cloudVersion: 0,        // 雲端版本（每次 pull/push 後更新）
    cloudLastModifiedAt: null  // 雲端最後修改時間
  },
  sheetSyncEnabled: false,
  sheetPendingPush: false,  // 有待同步但離線時為 true
  cloudFirstMode: false,    // 雲端優先：啟動必須 pull 成功，操作前必檢查
  autoPollEnabled: true,    // 自動偵測雲端（預設啟用）
  autoPollInterval: 30,     // 固定 30 秒（不對外開放設定）

  // 請款單篩選狀態（v2.10.4）
  invStatusMode: 'pending',                                       // pending/reconcile/progress/all/custom
  invCustomStatuses: ['done-unpaid', 'partial'],                  // mode='custom' 時生效

  // Google Calendar 同步
  calEnabled: false,
  calId: '',
  calAutoSync: false,
  calLastSyncAt: null,
  calLastSyncCount: 0,
  // 提醒模式（v2.10.0）：
  //   'follow' = 跟隨 dueSoonDays（預設）
  //   字串數字 = 該分鐘數的提前量；'0' = 不提醒
  calReminderMode: 'follow',

  // 備份追蹤
  lastExportAt: null,
  lastModifiedAt: null,    // 最後一次資料變動時間，用於匯入差異比對
  backupRemindDays: 14,

  // 初次使用引導
  onboardingDone: false
};

// 行事曆當前月份
let calCursor = new Date();
calCursor.setDate(1);

// 業主清單展開狀態（哪些業主展開）
let expandedClients = new Set();

// 收益頁模式
let revenueState = {
  mode: 'month',        // 'month' | 'year'
  clientId: 'all',
  range: 12
};

// ============== Schema 版本化框架（v2.1+）==============
// 每升一版資料模型就 +1，並新增對應的 migration 函式
const CURRENT_SCHEMA_VERSION = 7;

const SCHEMA_MIGRATIONS = {
  // v1 → v2：加入 paid/doneAt/paidAt 欄位
  1: function(state) {
    state.jobs = (state.jobs || []).map(j => ({
      ...j,
      paid: j.paid ?? false,
      doneAt: j.doneAt ?? (j.done ? (j.date || todayStr()) : null),
      paidAt: j.paidAt ?? (j.paid ? (j.date || todayStr()) : null)
    }));
  },
  // v2 → v3：加入 cancelled / endDate / tag / commission / prepaid
  2: function(state) {
    state.jobs = (state.jobs || []).map(j => ({
      ...j,
      cancelled: j.cancelled ?? false,
      endDate: j.endDate ?? null,
      tag: j.tag ?? ''
    }));
    state.clients = (state.clients || []).map(c => ({
      ...c,
      commissionRate: c.commissionRate ?? 0,
      commissionTo: c.commissionTo ?? '',
      prepaidMode: c.prepaidMode ?? false,
      prepayments: c.prepayments ?? []
    }));
  },
  // v3 → v4：工時 + 時薪欄位（v2.1 新增）
  3: function(state) {
    state.jobs = (state.jobs || []).map(j => ({
      ...j,
      hoursWorked: j.hoursWorked ?? null  // 選填
    }));
  },
  // v4 → v5：估價、子任務、累計工時（v2.6 新增）
  4: function(state) {
    state.jobs = (state.jobs || []).map(j => ({
      ...j,
      isEstimate: j.isEstimate ?? false,    // 草稿/估價單模式
      subtasks: j.subtasks ?? [],            // [{id, text, done}]
      timeSpentMs: j.timeSpentMs ?? 0        // 計時器累計毫秒
    }));
  },
  // v5 → v6：業主固定請款日 + 個別覆寫提醒天數（v2.7.9 新增）
  5: function(state) {
    state.clients = (state.clients || []).map(c => ({
      ...c,
      billingDay: c.billingDay ?? 0,                       // 0 = 不固定 / 1-31 = 該月第幾天
      billingRemindDays: c.billingRemindDays ?? 3,         // 提前幾天提醒
      unpaidRemindDaysOverride: c.unpaidRemindDaysOverride ?? null  // null = 走全域設定
    }));
  },
  // v6 → v7：折扣 + 多筆收款紀錄 + 呆帳（v2.8.0 新增）
  6: function(state) {
    state.jobs = (state.jobs || []).map(j => {
      const next = {
        ...j,
        discountType: j.discountType ?? 'none',   // 'none' | 'fixed' | 'percent'
        discountValue: j.discountValue ?? 0,       // 折扣金額或百分比（正數）
        payments: j.payments ?? [],                // [{id, date, amount, note}]
        writeOff: j.writeOff ?? 0                  // 呆帳金額（不再追討）
      };
      // 自動 migrate：既有 paid+paidAt → 自動產生一筆 payment
      if (next.paid && next.paidAt && !next.payments.length) {
        const finalAmt = +next.amount || 0;  // 此時還沒折扣，原價就是應收
        next.payments = [{
          id: uid(),
          date: next.paidAt,
          amount: finalAmt,
          note: '自動轉換（v2.8.0 升級）'
        }];
      }
      return next;
    });
  }
};

function runMigrations(state) {
  let v = state.schemaVersion || 1;
  let migratedCount = 0;
  while (v < CURRENT_SCHEMA_VERSION) {
    const fn = SCHEMA_MIGRATIONS[v];
    if (fn) {
      try { fn(state); migratedCount++; }
      catch (err) { console.error(`Migration v${v} 失敗:`, err); }
    }
    v++;
  }
  state.schemaVersion = CURRENT_SCHEMA_VERSION;
  if (migratedCount > 0) {
    console.log(`✓ Schema migrated to v${CURRENT_SCHEMA_VERSION} (ran ${migratedCount} migrations)`);
  }
  return state;
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = Object.assign(state, JSON.parse(raw)); } catch(e) {}
  }
  const cfgRaw = localStorage.getItem(CONFIG_KEY);
  if (cfgRaw) {
    try { config = Object.assign(config, JSON.parse(cfgRaw)); } catch(e) {}
  }
  // 強制：雲端優先 + 自動偵測永遠 ON
  config.cloudFirstMode = true;
  config.autoPollEnabled = true;

  // 跑 schema migrations
  runMigrations(state);

  // v2.10.13: 收款帳號從單筆轉多筆（idempotent，舊欄位有值就轉成「預設帳號」）
  ensurePaymentAccounts();

  // 早期版本一次性 migration（業主從備註模式轉儲值制 + 補入儲值紀錄）。
  // 所有裝置同步到雲端後此分支已不會觸發；僅保留結構，名稱與資料皆為 placeholder。
  state.clients.forEach(c => {
    if (c.name === '__LEGACY_PREPAID_MIGRATION__' && !c.prepaidMode && (c.note || '').includes('儲值')) {
      c.prepaidMode = true;
      c.prepayments = [
        { id: uid(), date: '0000-00-00', amount: 0, note: '' }
      ];
      c.note = '';
      state.jobs.forEach(j => {
        if (j.clientId === c.id && !j.paid) {
          j.paid = true;
          j.paidAt = j.paidAt || j.date;
        }
      });
    }
  });

  // 若網址帶 ?client=xxx，進入業主唯讀模式
  const params = new URLSearchParams(location.search);
  const cid = params.get('client');
  if (cid) enterClientMode(cid);
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    clients: state.clients,
    jobs: state.jobs
  }));
  // 記錄最後變動時間（給匯入差異比對用）
  config.lastModifiedAt = new Date().toISOString();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  // 若啟用 Sheet 同步 → debounce 觸發推送
  if (config.sheetSyncEnabled) {
    schedulePush();
  }
}

function saveConfig() {
  const g = (id) => document.getElementById(id);
  config.unpaidRemindDays = Math.max(1, Math.min(120, +g('cfg-unpaid-days-input').value || 7));
  config.dueSoonDays = Math.max(1, Math.min(30, +g('cfg-due-soon-days')?.value || 3));
  config.monthEndReminderDay = Math.max(20, Math.min(31, +g('cfg-month-end-day')?.value || 25));
  config.backupRemindDays = Math.max(1, Math.min(90, +g('cfg-backup-days-input')?.value || 14));
  config.enableOverdueAlert = g('cfg-alert-overdue')?.checked !== false;
  config.enableDueSoonAlert = g('cfg-alert-due-soon')?.checked !== false;
  config.enableUnpaidLongAlert = g('cfg-alert-unpaid-long')?.checked !== false;
  config.enableMonthEndAlert = g('cfg-alert-month-end')?.checked !== false;
  config.enableBillingDayAlert = g('cfg-alert-billing-day')?.checked !== false;
  config.enableSlowPayAlert = g('cfg-alert-slow-pay')?.checked !== false;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  render();
  // Calendar 提醒提示文字（如果是 follow 模式，會跟著 dueSoonDays 變動）
  if (typeof updateCalendarReminderHint === 'function') updateCalendarReminderHint();
  toast('✓ 已儲存設定');
}

// 載入提醒設定 UI
function loadReminderConfigUI() {
  const g = (id) => document.getElementById(id);
  if (g('cfg-unpaid-days-input')) g('cfg-unpaid-days-input').value = config.unpaidRemindDays || 7;
  if (g('cfg-due-soon-days')) g('cfg-due-soon-days').value = config.dueSoonDays || 3;
  if (g('cfg-month-end-day')) g('cfg-month-end-day').value = config.monthEndReminderDay || 25;
  if (g('cfg-backup-days-input')) g('cfg-backup-days-input').value = config.backupRemindDays || 14;
  if (g('cfg-alert-overdue')) g('cfg-alert-overdue').checked = config.enableOverdueAlert !== false;
  if (g('cfg-alert-due-soon')) g('cfg-alert-due-soon').checked = config.enableDueSoonAlert !== false;
  if (g('cfg-alert-unpaid-long')) g('cfg-alert-unpaid-long').checked = config.enableUnpaidLongAlert !== false;
  if (g('cfg-alert-month-end')) g('cfg-alert-month-end').checked = config.enableMonthEndAlert !== false;
  if (g('cfg-alert-billing-day')) g('cfg-alert-billing-day').checked = config.enableBillingDayAlert !== false;
  if (g('cfg-alert-slow-pay')) g('cfg-alert-slow-pay').checked = config.enableSlowPayAlert !== false;
}

// ============== Utilities ==============
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt(n) { return 'NT$' + (n || 0).toLocaleString(); }
function thisMonth() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); }
function getMonth(dateStr) { return dateStr ? dateStr.slice(0,7) : ''; }
function todayStr() { const d = new Date(); return d.toISOString().slice(0,10); }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  return Math.floor((db - da) / 86400000);
}

let toastTimer = null;
function toast(msg, durationMs) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), durationMs || 2500);
}
// 顯示一個「進行中」訊息（例如「同步中...」）
// v2.10.3：加上安全保險超時 — 即使沒有後續 toast()，也最多顯示 maxMs 毫秒就自動消失
//         避免函式結尾用 alert/confirm 而忘了關 toast 導致訊息卡住
function toastProgress(msg, maxMs) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  // 預設 15 秒上限（網路請求基本都比這短）
  toastTimer = setTimeout(() => t.classList.remove('show'), maxMs || 15000);
}

// v2.10.3：明確關閉目前的 toast（用於 alert/confirm 跳出前先把 progress 收掉）
function toastDismiss() {
  const t = document.getElementById('toast');
  if (t) t.classList.remove('show');
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function jobStatus(j) {
  if (j.cancelled) return 'cancelled';
  if (j.paid && j.done) return 'paid';
  if (j.paid && !j.done) return 'prepaid';   // 已收款但未完成（儲值制常見）
  if (j.done) return 'done-unpaid';
  return 'pending';
}

// 用於統計：取消的案件不計入
function activeJobs() {
  // v2.6: 估價單不算正式案件，排除在統計外
  return state.jobs.filter(j => !j.cancelled && !j.isEstimate);
}
function estimateJobs() {
  return state.jobs.filter(j => j.isEstimate && !j.cancelled);
}

// ============== 金額計算 helpers（v2.8.0）==============
// 折扣後的應收金額
function jobFinalAmount(j) {
  const base = +j.amount || 0;
  if (j.discountType === 'fixed') return Math.max(0, base - (+j.discountValue || 0));
  if (j.discountType === 'percent') return Math.max(0, Math.round(base * (1 - (+j.discountValue || 0) / 100)));
  return base;
}

// 折扣金額（正數，純呈現用）
function jobDiscountAmount(j) {
  const base = +j.amount || 0;
  if (j.discountType === 'fixed') return Math.min(base, +j.discountValue || 0);
  if (j.discountType === 'percent') return Math.round(base * (+j.discountValue || 0) / 100);
  return 0;
}

// 已收金額（payments 加總）
function jobPaidTotal(j) {
  return (j.payments || []).reduce((s, p) => s + (+p.amount || 0), 0);
}

// 待收金額（應收 - 已收 - 呆帳）
function jobUnpaidAmount(j) {
  return Math.max(0, jobFinalAmount(j) - jobPaidTotal(j) - (+j.writeOff || 0));
}

// 是否視同結清（已收 + 呆帳 >= 應收）
function jobIsFullyPaid(j) {
  return jobPaidTotal(j) + (+j.writeOff || 0) >= jobFinalAmount(j) && jobFinalAmount(j) > 0;
}

// 同步 paid / paidAt 與 payments（每次 payments 變動後呼叫）
function recomputePaidStatus(j) {
  if (jobIsFullyPaid(j)) {
    j.paid = true;
    // paidAt 取最後一筆 payment 的日期
    const last = [...(j.payments || [])].sort((a,b) => (a.date||'').localeCompare(b.date||'')).slice(-1)[0];
    j.paidAt = last ? last.date : (j.paidAt || todayStr());
  } else {
    j.paid = false;
    j.paidAt = null;
  }
}

// 案件的「歸屬月」：endDate 優先，沒有就用 date
function jobBelongMonth(j) {
  return getMonth(j.endDate || j.date);
}

// 案件的「實收金額」：扣掉業主分潤（給介紹人的部分）
function jobNetAmount(j) {
  const c = getClient(j.clientId);
  const rate = (c && c.commissionRate) || 0;
  if (rate <= 0) return +j.amount || 0;
  return Math.round((+j.amount || 0) * (1 - rate / 100));
}

// 案件的分潤金額（給介紹人的）
function jobCommission(j) {
  const c = getClient(j.clientId);
  const rate = (c && c.commissionRate) || 0;
  if (rate <= 0) return 0;
  return (+j.amount || 0) - jobNetAmount(j);
}

// 已用過的標籤清單（補全用）
function getUsedTags() {
  const tags = new Set();
  state.jobs.forEach(j => { if (j.tag) tags.add(j.tag); });
  return [...tags].sort();
}

// 儲值制業主餘額計算
function clientBalance(clientId) {
  const c = getClient(clientId);
  if (!c?.prepaidMode) return null;
  const total = (c.prepayments || []).reduce((s,p) => s + (+p.amount||0), 0);
  const used = activeJobs().filter(j => j.clientId === clientId).reduce((s,j) => s + (+j.amount||0), 0);
  return { total, used, balance: total - used };
}

function getClient(cid) { return state.clients.find(c => c.id === cid); }

// ============== Tabs ==============
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// v2.3 效能優化：記住目前分頁，只渲染當前可見的內容
let currentTab = 'dashboard';

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['dashboard','jobs','calendar','revenue','clients','invoice','settings'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('hidden', t !== tab);
  });
  const fab = document.getElementById('fab-add');
  if (tab === 'settings' || tab === 'invoice' || tab === 'revenue') {
    fab.style.display = 'none';
  } else {
    fab.style.display = 'inline-flex';
    fab.onclick = (tab === 'clients') ? openClientModal : openJobModal;
    fab.textContent = (tab === 'clients') ? '＋ 新增業主' : '＋ 新增案件';
  }
  // 切到該分頁時才重畫該分頁
  renderActiveTab();
}

// ============== Render (main) ==============
// v2.3：只重畫「當前可見分頁」+ 永遠需要的小元素（徽章、提醒）
// 大幅減少 462 案件 + 13 業主下的 reflow / repaint 成本

let renderRafId = null;

function render() {
  // 用 requestAnimationFrame 合併連續多次 render 呼叫成一次
  if (renderRafId) return;
  renderRafId = requestAnimationFrame(() => {
    renderRafId = null;
    renderActiveTab();
    // 永遠都要更新（徽章、提醒、備份狀態都很輕）
    renderAlerts();
    renderBadge();
    renderBackupStatus();
  });
}

function renderActiveTab() {
  switch (currentTab) {
    case 'dashboard': renderDashboard(); break;
    case 'jobs':      renderJobs();      break;
    case 'calendar':  renderCalendar();  break;
    case 'revenue':   renderRevenue();   break;
    case 'clients':   renderClients();   break;
    case 'invoice':   renderInvoice();   break;
    // settings 不需要 render（純靜態）
  }
}

// 強制全部重畫（特殊場景：例如 import / restore / 切換主題）
function renderAll() {
  renderAlerts();
  renderDashboard();
  renderJobs();
  renderCalendar();
  renderRevenue();
  renderClients();
  renderInvoice();
  renderBadge();
  renderBackupStatus();
}

// ============== 批次操作 ==============
let bulkMode = false;
let bulkSelected = new Set();

// v2.7.10: Dashboard 近期案件專屬批次（與 jobs 分頁的 bulkMode 獨立）
let dashBulkMode = false;
let dashBulkSelected = new Set();

function toggleDashBulkMode() {
  dashBulkMode = !dashBulkMode;
  dashBulkSelected.clear();
  renderDashboard();
}

function toggleDashBulkSelect(id) {
  if (dashBulkSelected.has(id)) dashBulkSelected.delete(id);
  else dashBulkSelected.add(id);
  renderDashboard();
}

function dashBulkSelectAll() {
  const recent = [...state.jobs].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 10);
  recent.forEach(j => { if (!j.cancelled) dashBulkSelected.add(j.id); });
  renderDashboard();
}

function dashBulkClear() {
  dashBulkSelected.clear();
  renderDashboard();
}

function dashBulkExit() {
  dashBulkMode = false;
  dashBulkSelected.clear();
}

function dashBulkMarkDone() {
  if (!dashBulkSelected.size) return;
  const ids = Array.from(dashBulkSelected);
  let count = 0;
  let totalAmt = 0;
  ids.forEach(id => {
    const j = state.jobs.find(x => x.id === id);
    if (!j || j.cancelled) return;
    if (!j.done) {
      j.done = true;
      j.doneAt = j.doneAt || todayStr();
      count++;
      totalAmt += jobFinalAmount(j);
    }
  });
  save();
  if (count > 0) logAction('bulk-done', { count, amount: totalAmt });
  toast(`✓ 已標記 ${count} 筆完成`);
  dashBulkExit();
  render();
}

function dashBulkMarkPaid() {
  if (!dashBulkSelected.size) return;
  // 用既有的收款日期 modal，並讓 confirmPaidDate 完成後清除 dashBulk 狀態
  const ids = Array.from(dashBulkSelected).filter(id => {
    const j = state.jobs.find(x => x.id === id);
    return j && !j.cancelled;
  });
  if (!ids.length) { toast('沒有可收款的案件'); return; }
  openPaidDateModal(ids);
  // 旗標：modal 確認後要清除 dashBulk
  paidDateContext._fromDashBulk = true;
}

// v2.9.4: 批次設定折扣
function openBulkDiscountModal() {
  if (!dashBulkSelected.size) return;
  const ids = Array.from(dashBulkSelected);
  const total = state.jobs.filter(j => ids.includes(j.id)).reduce((s,j) => s + (+j.amount || 0), 0);
  document.getElementById('bulk-discount-info').textContent = `將套用到 ${ids.length} 筆案件（原價合計 ${fmt(total)}）`;
  document.getElementById('bulk-discount-value').value = '';
  document.querySelectorAll('input[name="bulk-discount-type"]').forEach(r => r.checked = (r.value === 'none'));
  document.getElementById('bulk-discount-modal').classList.add('open');
}

function confirmBulkDiscount() {
  const type = document.querySelector('input[name="bulk-discount-type"]:checked')?.value || 'none';
  const value = +document.getElementById('bulk-discount-value').value || 0;
  if (type !== 'none' && value <= 0) {
    toast('請輸入折扣值');
    return;
  }
  if (type === 'percent' && value > 100) {
    toast('百分比不能超過 100');
    return;
  }
  const ids = Array.from(dashBulkSelected);
  let count = 0;
  ids.forEach(id => {
    const j = state.jobs.find(x => x.id === id);
    if (!j || j.cancelled) return;
    j.discountType = type;
    j.discountValue = type === 'none' ? 0 : value;
    // 折扣變動後，已收款狀態可能改變（應收金額變了）
    recomputePaidStatus(j);
    count++;
  });
  save();
  if (count > 0) logAction('bulk-discount', { count, type, value });
  document.getElementById('bulk-discount-modal').classList.remove('open');
  toast(`✓ 已套用折扣到 ${count} 筆`);
  dashBulkExit();
  render();
}

function dashBulkMarkCancelled() {
  if (!dashBulkSelected.size) return;
  if (!confirm(`確定要把 ${dashBulkSelected.size} 筆案件標記為已取消？\n\n（取消的案件不計入收益統計，但保留紀錄）`)) return;
  const ids = Array.from(dashBulkSelected);
  ids.forEach(id => {
    const j = state.jobs.find(x => x.id === id);
    if (j) j.cancelled = true;
  });
  save();
  logAction('bulk-cancel', { count: ids.length });
  toast(`✓ 已取消 ${ids.length} 筆`);
  dashBulkExit();
  render();
}

function toggleBulkMode() {
  bulkMode = !bulkMode;
  bulkSelected.clear();
  document.getElementById('bulk-toggle').textContent = bulkMode ? '✕ 退出批次' : '☑️ 批次操作';
  document.getElementById('bulk-bar').classList.toggle('hidden', !bulkMode);
  renderJobs();
}

function toggleBulkSelect(id) {
  if (bulkSelected.has(id)) bulkSelected.delete(id);
  else bulkSelected.add(id);
  document.getElementById('bulk-count').textContent = `已選 ${bulkSelected.size} 筆`;
  renderJobs();
}

function bulkSelectAll() {
  document.querySelectorAll('#jobs-list .row[data-job-id]').forEach(el => {
    bulkSelected.add(el.getAttribute('data-job-id'));
  });
  document.getElementById('bulk-count').textContent = `已選 ${bulkSelected.size} 筆`;
  renderJobs();
}

function bulkInvert() {
  document.querySelectorAll('#jobs-list .row[data-job-id]').forEach(el => {
    const id = el.getAttribute('data-job-id');
    if (bulkSelected.has(id)) bulkSelected.delete(id);
    else bulkSelected.add(id);
  });
  document.getElementById('bulk-count').textContent = `已選 ${bulkSelected.size} 筆`;
  renderJobs();
}

function bulkMarkDone() {
  if (!bulkSelected.size) { toast('沒有選任何案件'); return; }
  if (!confirm(`將選中的 ${bulkSelected.size} 筆案件標記為「已完成」（如果已是完成不變）？`)) return;
  let n = 0;
  state.jobs.forEach(j => {
    if (bulkSelected.has(j.id) && !j.done) {
      j.done = true;
      j.doneAt = todayStr();
      n++;
    }
  });
  bulkSelected.clear();
  save(); render();
  toast(`✓ ${n} 筆已標記完成`);
}

function bulkMarkPaid() {
  if (!bulkSelected.size) { toast('沒有選任何案件'); return; }
  // 用收款日期 modal（取代 prompt）
  openPaidDateModal([...bulkSelected]);
}

function bulkDelete() {
  if (!bulkSelected.size) { toast('沒有選任何案件'); return; }
  if (!confirm(`⚠️ 即將刪除 ${bulkSelected.size} 筆案件！\n\n此操作不可復原（除非從 Sheet 還原）。確定？`)) return;
  const verify = prompt('最後確認：請輸入「確認刪除」四個字');
  if (verify !== '確認刪除') { toast('已取消'); return; }
  const cnt = bulkSelected.size;
  state.jobs = state.jobs.filter(j => !bulkSelected.has(j.id));
  bulkSelected.clear();
  save(); render();
  toast(`已刪除 ${cnt} 筆`);
}

// ============== Reminders / Alerts ==============
let highlightJobIds = new Set();   // 提醒卡片點擊後要 highlight 的案件 id

function setHighlightJobs(ids) {
  highlightJobIds = new Set(ids);
  setTimeout(() => { highlightJobIds = new Set(); }, 2600);
}

// 鎖定只顯示這些案件 id（用於提醒卡片點擊後精確篩選）
function lockJobsToIds(ids, label) {
  state.filters.jobIdsOnly = new Set(ids);
  state.filters.jobIdsOnlyLabel = label || '提醒篩選';
  state.filters.month = 'all';
  state.filters.status = 'all';
  state.filters.clientId = 'all';
  state.filters.tag = 'all';
}

function clearJobsLock() {
  state.filters.jobIdsOnly = null;
  state.filters.jobIdsOnlyLabel = '';
  render();
}

// v2.5: 業主健康度指標
function computeClientHealth(clientId) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return null;
  const jobs = state.jobs.filter(j => j.clientId === clientId && !j.cancelled);

  // 1. 平均收款週期
  let cycleSum = 0, cycleCount = 0;
  jobs.forEach(j => {
    if (j.doneAt && j.paidAt) {
      const d = daysBetween(j.doneAt, j.paidAt);
      if (d >= 0 && d <= 365) { cycleSum += d; cycleCount++; }
    }
  });
  const avgPayCycle = cycleCount > 0 ? Math.round(cycleSum / cycleCount) : null;

  // 2. 最近活動：最後一筆有日期的案件
  const dated = jobs.filter(j => j.date).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const lastJobDate = dated[0]?.date || null;
  const daysSinceLastJob = lastJobDate ? daysBetween(lastJobDate, todayStr()) : null;

  // 3. 單價趨勢：最近 6 個月 vs 之前 6 個月平均
  const now = new Date();
  const sixMoAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const twelveMoAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const recent = [], prev = [];
  jobs.forEach(j => {
    if (!j.date || !(+j.amount)) return;
    const d = new Date(j.date);
    if (d >= sixMoAgo) recent.push(+j.amount);
    else if (d >= twelveMoAgo) prev.push(+j.amount);
  });
  const recentAvg = recent.length ? Math.round(recent.reduce((a,b)=>a+b,0) / recent.length) : 0;
  const prevAvg = prev.length ? Math.round(prev.reduce((a,b)=>a+b,0) / prev.length) : 0;
  let trend = 'flat';
  if (prevAvg > 0 && recent.length >= 2) {
    const change = (recentAvg - prevAvg) / prevAvg;
    if (change > 0.15) trend = 'up';
    else if (change < -0.15) trend = 'down';
  }

  // 4. 計分：100 起扣
  let score = 100;
  // 流失：> 90 天沒接案 -30 / > 180 天 -50
  if (daysSinceLastJob !== null) {
    if (daysSinceLastJob > 180) score -= 50;
    else if (daysSinceLastJob > 90) score -= 30;
    else if (daysSinceLastJob > 60) score -= 15;
  } else {
    score -= 20;  // 完全沒接過
  }
  // 拖款：平均 > 60 天 -25 / > 30 天 -10
  if (avgPayCycle !== null) {
    if (avgPayCycle > 60) score -= 25;
    else if (avgPayCycle > 30) score -= 10;
  }
  // 單價：跌 -15 / 升 +5
  if (trend === 'down') score -= 15;
  if (trend === 'up') score += 5;

  score = Math.max(0, Math.min(100, score));

  let label, color;
  if (score >= 75) { label = '健康'; color = 'var(--success)'; }
  else if (score >= 50) { label = '注意'; color = 'var(--warning)'; }
  else { label = '流失中'; color = 'var(--danger)'; }

  return { score, label, color, avgPayCycle, daysSinceLastJob, trend, recentAvg, prevAvg, lastJobDate };
}

// v2.2 智慧待收款：依各業主的歷史平均收款週期判斷異常
// v2.8.1: 改用 payments 第一筆日期計算（更精確；payments 為空才退回 paidAt）
function computeSlowPayJobs(active) {
  const cycleByClient = {};
  state.jobs.forEach(j => {
    if (!j.doneAt || j.cancelled) return;
    if (!jobIsFullyPaid(j)) return;
    // 取該案件最早的 payment 日期當作「實際收款日」
    const firstPay = (j.payments || []).map(p => p.date).filter(Boolean).sort()[0] || j.paidAt;
    if (!firstPay) return;
    const days = daysBetween(j.doneAt, firstPay);
    if (days < 0 || days > 365) return;
    if (!cycleByClient[j.clientId]) cycleByClient[j.clientId] = { sum: 0, count: 0 };
    cycleByClient[j.clientId].sum += days;
    cycleByClient[j.clientId].count++;
  });
  const today = todayStr();
  const slow = [];
  active.forEach(j => {
    if (!j.done || jobIsFullyPaid(j)) return;
    if (!j.doneAt) return;
    const stat = cycleByClient[j.clientId];
    if (!stat || stat.count < 3) return;
    const avg = Math.round(stat.sum / stat.count);
    const daysSince = daysBetween(j.doneAt, today);
    if (daysSince > avg * 1.5 && daysSince > 14) {
      slow.push({ ...j, avgDays: avg, daysSince });
    }
  });
  return slow.sort((a,b) => b.daysSince - a.daysSince);
}

function computeAlerts() {
  const today = todayStr();
  const in3 = addDays(new Date(), config.dueSoonDays || 3);
  const alerts = [];
  const active = activeJobs();  // 排除取消的案件

  // 1. 逾期未完成
  if (config.enableOverdueAlert !== false) {
    const overdue = active.filter(j => !j.done && j.date && j.date < today);
    if (overdue.length) {
      const amt = overdue.reduce((s,j) => s + (+j.amount||0), 0);
      alerts.push({
        type: 'overdue',
        icon: '🔴',
        title: `${overdue.length} 筆逾期未完成`,
        desc: `最早日期 ${overdue.map(j=>j.date).sort()[0]}　涉及金額 ${fmt(amt)}`,
        onClick: () => { lockJobsToIds(overdue.map(j=>j.id), `🔴 逾期未完成（${overdue.length} 筆）`); switchTab('jobs'); }
      });
    }
  }

  // 2. 未來 N 天內到期（含今天）
  if (config.enableDueSoonAlert !== false) {
    const days = config.dueSoonDays || 3;
    const dueSoon = active.filter(j => !j.done && j.date && j.date >= today && j.date <= in3);
    if (dueSoon.length) {
      alerts.push({
        type: 'due-soon',
        icon: '🟡',
        title: `${dueSoon.length} 筆即將到期`,
        desc: `未來 ${days} 天內要交件：${dueSoon.slice(0,2).map(j=>j.title).join('、')}${dueSoon.length>2?'…':''}`,
        onClick: () => { lockJobsToIds(dueSoon.map(j=>j.id), `🟡 未來 ${days} 天到期（${dueSoon.length} 筆）`); switchTab('jobs'); }
      });
    }
  }

  // 3. 已完成但超過 N 天未收款（每筆 job 用該業主的設定，沒設則用全域）
  if (config.enableUnpaidLongAlert !== false) {
    const unpaidLong = active.filter(j => {
      if (!j.done || j.paid || !j.doneAt) return false;
      const c = getClient(j.clientId);
      const days = (c?.unpaidRemindDaysOverride != null) ? c.unpaidRemindDaysOverride : (config.unpaidRemindDays || 7);
      const threshold = addDays(new Date(), -days);
      return j.doneAt <= threshold;
    });
    if (unpaidLong.length) {
      const amt = unpaidLong.reduce((s,j) => s + (+j.amount||0), 0);
      const byClient = {};
      unpaidLong.forEach(j => {
        const c = getClient(j.clientId);
        const name = c ? c.name : '未指定';
        byClient[name] = (byClient[name]||0) + (+j.amount||0);
      });
      const clientsStr = Object.entries(byClient).map(([n,a]) => `${n} ${fmt(a)}`).join('、');
      alerts.push({
        type: 'unpaid-long',
        icon: '🟠',
        title: `${unpaidLong.length} 筆完成已久未收款`,
        desc: clientsStr,
        amt: fmt(amt),
        onClick: () => { lockJobsToIds(unpaidLong.map(j=>j.id), `🟠 完成已久未收款（${unpaidLong.length} 筆）`); switchTab('jobs'); }
      });
    }
  }

  // 4. 月底提醒（從每月第 N 天起）
  if (config.enableMonthEndAlert !== false) {
    const dom = new Date().getDate();
    const startDay = config.monthEndReminderDay || 25;
    if (dom >= startDay) {
      const thisMonthUnpaid = active.filter(j => j.done && !jobIsFullyPaid(j) && getMonth(j.date) === thisMonth());
      if (thisMonthUnpaid.length) {
        const amt = thisMonthUnpaid.reduce((s,j) => s + (+j.amount||0), 0);
        alerts.push({
          type: 'month-end',
          icon: '📅',
          title: `月底將至，本月有 ${thisMonthUnpaid.length} 筆可請款`,
          desc: `可產生請款單寄給業主　共 ${fmt(amt)}`,
          onClick: () => { lockJobsToIds(thisMonthUnpaid.map(j=>j.id), `📅 本月可請款（${thisMonthUnpaid.length} 筆）`); switchTab('jobs'); }
        });
      }
    }
  }

  // 4b. 業主固定請款日提醒（v2.7.9 新增）
  if (config.enableBillingDayAlert !== false) {
    const now = new Date();
    state.clients.forEach(c => {
      if (!c.billingDay || c.billingDay < 1 || c.billingDay > 31) return;
      const remindDays = +c.billingRemindDays || 3;
      // 計算下一個請款日：先試本月，過了則用下月
      let billingDate = new Date(now.getFullYear(), now.getMonth(), c.billingDay);
      // 處理月份天數不足（e.g. 2 月沒 31 號 → 月底）
      if (billingDate.getMonth() !== now.getMonth()) {
        billingDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      }
      if (billingDate < now) {
        billingDate = new Date(now.getFullYear(), now.getMonth() + 1, c.billingDay);
        if (billingDate.getMonth() !== ((now.getMonth() + 1) % 12)) {
          billingDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        }
      }
      const daysUntil = Math.ceil((billingDate - now) / (1000 * 60 * 60 * 24));
      if (daysUntil < 0 || daysUntil > remindDays) return;
      // 該業主有沒有未收款的案件可請？
      const billable = active.filter(j => j.clientId === c.id && j.done && !jobIsFullyPaid(j));
      if (!billable.length) return;
      const amt = billable.reduce((s,j) => s + (+j.amount||0), 0);
      const dateStr = `${billingDate.getMonth()+1}/${billingDate.getDate()}`;
      alerts.push({
        type: 'billing-day-' + c.id,
        icon: '💼',
        title: `${c.name} 請款日 ${daysUntil === 0 ? '就是今天' : `還有 ${daysUntil} 天`}（${dateStr}）`,
        desc: `${billable.length} 筆可請款　共 ${fmt(amt)}`,
        onClick: () => { lockJobsToIds(billable.map(j=>j.id), `💼 ${c.name} 請款日（${billable.length} 筆）`); switchTab('jobs'); }
      });
    });
  }

  // 5. 儲值餘額不足提醒
  state.clients.forEach(c => {
    const bal = clientBalance(c.id);
    if (bal && bal.balance < 1000) {
      alerts.push({
        type: 'low-balance',
        icon: '💰',
        title: `${c.name} 儲值餘額剩 ${fmt(bal.balance)}`,
        desc: bal.balance < 0 ? '已超支，建議盡快請業主儲值' : '建議提醒業主再儲值',
        onClick: () => { setFilter('clientId', c.id); switchTab('clients'); }
      });
    }
  });

  // 5c. v2.9: 部分收款尾款提醒 — 收過訂金但尾款超過 N 天沒收
  if (config.enableUnpaidLongAlert !== false) {
    const tailDays = +config.unpaidRemindDays || 7;
    const tailThreshold = addDays(new Date(), -tailDays);
    const tailPending = active.filter(j => {
      if (jobIsFullyPaid(j)) return false;
      const pTotal = jobPaidTotal(j);
      if (pTotal <= 0) return false;  // 完全沒收 → 由其他規則處理
      // 最後一筆 payment 的日期
      const lastPay = (j.payments || []).map(p => p.date).filter(Boolean).sort().slice(-1)[0];
      if (!lastPay) return false;
      return lastPay <= tailThreshold;
    });
    if (tailPending.length) {
      const amt = tailPending.reduce((s,j) => s + jobUnpaidAmount(j), 0);
      const sample = tailPending.slice(0, 2).map(j => {
        const c = getClient(j.clientId);
        return `${c?.name || '?'} 尾款 ${fmt(jobUnpaidAmount(j)).replace('NT$','').trim()}`;
      }).join('、');
      alerts.push({
        type: 'tail-pending',
        icon: '🟣',
        title: `${tailPending.length} 筆部分收款的尾款拖款`,
        desc: sample + (tailPending.length > 2 ? '…' : '') + ` · 共待收 ${fmt(amt)}`,
        onClick: () => { lockJobsToIds(tailPending.map(j=>j.id), `🟣 尾款拖款（${tailPending.length} 筆）`); switchTab('jobs'); }
      });
    }
  }

  // 5b. 智慧待收款警告（v2.2）：每個業主的歷史平均收款週期，超過該週期 1.5 倍的案件
  const slowJobs = config.enableSlowPayAlert !== false ? computeSlowPayJobs(active) : [];
  if (slowJobs.length) {
    const amt = slowJobs.reduce((s,j) => s + (+j.amount||0), 0);
    const samples = slowJobs.slice(0, 2).map(s => `${getClient(s.clientId)?.name || '?'} 拖了 ${s.daysSince} 天（平均 ${s.avgDays} 天）`).join('、');
    alerts.push({
      type: 'slow-pay',
      icon: '⏱️',
      title: `${slowJobs.length} 筆異常拖款`,
      desc: samples + (slowJobs.length > 2 ? '…' : '') + ` · 共 ${fmt(amt)}`,
      onClick: () => { lockJobsToIds(slowJobs.map(j=>j.id), `⏱️ 異常拖款（${slowJobs.length} 筆）`); switchTab('jobs'); }
    });
  }

  // 6. 備份提醒（> N 天沒匯出備份 + 有資料時才提示）
  if (state.jobs.length > 0) {
    const last = config.lastExportAt;
    const daysAgo = last ? daysBetween(last, today) : Infinity;
    if (daysAgo >= config.backupRemindDays) {
      alerts.push({
        type: 'backup',
        icon: '💾',
        title: last ? `已超過 ${daysAgo} 天沒備份資料` : '尚未匯出任何備份',
        desc: '資料只存在瀏覽器，建議立刻匯出 JSON 存雲端硬碟',
        onClick: () => switchTab('settings')
      });
    }
  }

  return alerts;
}

function renderAlerts() {
  const alerts = computeAlerts();
  const box = document.getElementById('alerts');
  if (!alerts.length) { box.innerHTML = ''; return; }
  box.innerHTML = alerts.map((a, i) => `
    <div class="alert type-${a.type}" data-idx="${i}">
      <div class="alert-icon">${a.icon}</div>
      <div class="alert-content">
        <div class="alert-title">${escapeHtml(a.title)}</div>
        <div class="alert-desc">${escapeHtml(a.desc)}</div>
        ${a.amt ? `<div class="alert-amt">${a.amt}</div>` : ''}
      </div>
    </div>
  `).join('');
  // 綁點擊事件
  box.querySelectorAll('.alert').forEach((el, i) => {
    el.addEventListener('click', alerts[i].onClick);
  });
}

function renderBadge() {
  const count = computeAlerts().length;
  const badge = document.getElementById('dash-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ============== Dashboard ==============
function renderDashboard() {
  const m = thisMonth();
  const active = activeJobs();
  const monthJobs = active.filter(j => getMonth(j.date) === m);
  // v2.8.1: 改用 finalAmount 與 payment 計算
  // 「本月已收」= 本月所有 payment 加總（用 payment 的 date 歸月）
  const paidAmt = active.reduce((s, j) => {
    return s + (j.payments || []).filter(p => getMonth(p.date) === m).reduce((ss, p) => ss + (+p.amount || 0), 0);
  }, 0);
  // 「本月待收」= 本月案件（已完成）的 unpaid 加總
  const unpaidAmt = monthJobs.filter(j => j.done).reduce((s, j) => s + jobUnpaidAmount(j), 0);
  const pendingAmt = monthJobs.filter(j => !j.done).reduce((s, j) => s + jobUnpaidAmount(j), 0);
  const year = new Date().getFullYear();
  // 年度已收款：所有 payment 中 date 為今年的加總
  const yearAmt = active.reduce((s, j) => {
    return s + (j.payments || []).filter(p => p.date && p.date.startsWith(year+'')).reduce((ss, p) => ss + (+p.amount || 0), 0);
  }, 0);

  // 計數：本月已有任何 payment 的案件數
  const paidJobCount = active.filter(j => (j.payments || []).some(p => getMonth(p.date) === m)).length;
  document.getElementById('stat-paid').textContent = fmt(paidAmt);
  document.getElementById('stat-paid-sub').textContent = paidJobCount + ' 筆';
  document.getElementById('stat-unpaid').textContent = fmt(unpaidAmt);
  document.getElementById('stat-unpaid-sub').textContent = monthJobs.filter(j=>j.done && !jobIsFullyPaid(j)).length + ' 筆';
  document.getElementById('stat-pending').textContent = fmt(pendingAmt);
  document.getElementById('stat-pending-sub').textContent = monthJobs.filter(j=>!j.done).length + ' 筆';
  document.getElementById('stat-year').textContent = fmt(yearAmt);
  document.getElementById('stat-year-sub').textContent = year + ' 年已收款';

  // 近期案件（v2.7.10：擴大到 10 筆 + 支援 dashboard 批次模式）
  const recent = [...state.jobs].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 10);
  const recentBox = document.getElementById('recent-jobs');
  if (!recent.length) {
    recentBox.innerHTML = emptyState('還沒有案件', '點右下角 + 新增第一筆');
  } else {
    let html = '';
    if (dashBulkMode) {
      const total = recent.filter(j => dashBulkSelected.has(j.id)).reduce((s,j) => s + (+j.amount || 0), 0);
      const count = recent.filter(j => dashBulkSelected.has(j.id)).length;
      html += `<div style="background: var(--primary-light); border-radius: 8px; padding: 10px; margin-bottom: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px;">
        <span style="flex: 1; min-width: 120px; font-weight: 600;">已選 ${count} 筆 ${count ? `· ${fmt(total)}` : ''}</span>
        <button class="btn btn-ghost btn-sm" onclick="dashBulkSelectAll()">全選</button>
        <button class="btn btn-ghost btn-sm" onclick="dashBulkClear()">清除</button>
        <button class="btn btn-success btn-sm" onclick="dashBulkMarkDone()" ${!count?'disabled':''}>✓ 標完成</button>
        <button class="btn btn-primary btn-sm" onclick="dashBulkMarkPaid()" ${!count?'disabled':''}>$ 標收款（選日期）</button>
        <button class="btn btn-outline btn-sm" onclick="openBulkDiscountModal()" ${!count?'disabled':''}>🏷️ 設折扣</button>
        <button class="btn btn-outline btn-sm" onclick="dashBulkMarkCancelled()" ${!count?'disabled':''}>🚫 取消</button>
        <button class="btn btn-outline btn-sm" onclick="toggleDashBulkMode()">✕ 退出</button>
      </div>`;
    }
    html += recent.map(j => jobRow(j, 'dash')).join('');
    recentBox.innerHTML = html;
  }
  // 標題旁的批次按鈕（render 後再更新文字）
  const dashBulkBtn = document.getElementById('dash-bulk-btn');
  if (dashBulkBtn) dashBulkBtn.textContent = dashBulkMode ? '✕ 退出批次' : '☑️ 批次操作';

  // 月度圖：最近 6 個「日曆月份」（v2.10.14：改成由近到遠，當月在最上面）
  const byMonth = {};
  active.forEach(j => {
    if (!j.date) return;
    const mm = getMonth(j.date);
    if (!byMonth[mm]) byMonth[mm] = { paid: 0, pending: 0 };
    if (j.paid) byMonth[mm].paid += (+j.amount||0);
    else if (j.done) byMonth[mm].pending += (+j.amount||0);
  });
  const months = [];
  const nowRef = new Date();
  nowRef.setDate(1);
  for (let i = 0; i <= 5; i++) {
    const dd = new Date(nowRef);
    dd.setMonth(dd.getMonth() - i);
    const mmKey = dd.getFullYear() + '-' + String(dd.getMonth()+1).padStart(2,'0');
    months.push(mmKey);
    if (!byMonth[mmKey]) byMonth[mmKey] = { paid: 0, pending: 0 };
  }
  const max = Math.max(...months.map(mm => byMonth[mm].paid + byMonth[mm].pending), 1);
  document.getElementById('month-chart').innerHTML = months.length
    ? months.map(mm => {
        const d = byMonth[mm];
        const paidPct = (d.paid/max*100).toFixed(1);
        const pendingPct = (d.pending/max*100).toFixed(1);
        return `<div style="margin: 10px 0;">
          <div style="display:flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-bottom: 4px;">
            <span>${mm}</span>
            <span style="font-variant-numeric: tabular-nums; color: var(--text);">
              ${fmt(d.paid)}${d.pending ? ` <span style="color: var(--warning);">+待收 ${fmt(d.pending)}</span>` : ''}
            </span>
          </div>
          <div style="background: var(--bg); border-radius: 6px; height: 10px; overflow: hidden; display: flex;">
            <div style="background: var(--success); width: ${paidPct}%; height: 100%;"></div>
            <div style="background: var(--warning); width: ${pendingPct}%; height: 100%;"></div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty"><div style="font-size: 13px;">尚無統計資料</div></div>';

  // 年度對比
  renderYearComparison();
}

// ============== Year Comparison (Dashboard) ==============
function renderYearComparison() {
  const box = document.getElementById('year-comparison');
  if (!box) return;

  const thisYear = new Date().getFullYear();
  const today = todayStr();
  const sameMonthDay = today.slice(5);  // 'MM-DD'

  // 依年度統計已收款金額 + 去年同期金額
  const byYear = {};
  let lastYearSamePeriod = 0;

  // v2.9: 改用 payment 日期歸年（更精確）
  activeJobs().forEach(j => {
    (j.payments || []).forEach(p => {
      if (!p.date) return;
      const y = p.date.slice(0, 4);
      byYear[y] = (byYear[y] || 0) + (+p.amount || 0);
      if (+y === thisYear - 1 && p.date.slice(5) <= sameMonthDay) {
        lastYearSamePeriod += (+p.amount || 0);
      }
    });
  });

  if (Object.keys(byYear).length === 0) {
    box.innerHTML = '<div class="empty" style="padding: 20px;"><div style="font-size: 13px;">尚無已收款資料</div></div>';
    return;
  }

  const thisYearAmt = byYear[thisYear] || 0;
  const years = Object.keys(byYear).sort().reverse();
  const maxAmt = Math.max(...Object.values(byYear), 1);

  let html = '';

  // 今年 vs 去年同期
  if (lastYearSamePeriod > 0 || thisYearAmt > 0) {
    const delta = lastYearSamePeriod > 0
      ? ((thisYearAmt - lastYearSamePeriod) / lastYearSamePeriod * 100)
      : null;
    const up = thisYearAmt >= lastYearSamePeriod;
    const deltaHtml = delta !== null
      ? `<div class="delta ${up?'up':'down'}">${up?'↑':'↓'} ${Math.abs(delta).toFixed(0)}%</div>`
      : '<div class="delta" style="color: var(--muted);">—</div>';

    html += `<div class="year-compare-summary">
      <div class="side">
        <div class="label">${thisYear} 年累計（至今）</div>
        <div class="value">${fmt(thisYearAmt)}</div>
      </div>
      ${deltaHtml}
      <div class="side" style="text-align: right;">
        <div class="label">${thisYear-1} 年同期</div>
        <div class="value muted">${fmt(lastYearSamePeriod)}</div>
      </div>
    </div>`;
  }

  // 各年度橫條比較
  html += '<div style="margin-top: 6px;">';
  html += years.map(y => {
    const amt = byYear[y];
    const pct = amt / maxAmt * 100;
    const isThisYear = +y === thisYear;
    const barColor = isThisYear ? 'var(--primary)' : 'var(--success)';
    return `<div class="year-compare-row">
      <div class="year-compare-label">
        ${y} 年${isThisYear ? '<span style="color: var(--primary); font-size: 11px; margin-left: 2px;">（至今）</span>' : ''}
      </div>
      <div class="year-compare-bar-box">
        <div class="year-compare-bar" style="width: ${pct}%; background: ${barColor};"></div>
      </div>
      <div class="year-compare-amt">${fmt(amt)}</div>
    </div>`;
  }).join('');
  html += '</div>';

  box.innerHTML = html;
}

// ============== Job Row ==============
function jobRow(j, ctx) {
  // v2.7.10: ctx === 'dash' 用 Dashboard 專屬批次狀態；undefined 用全域 jobs 分頁狀態
  const isDash = ctx === 'dash';
  const inBulk = isDash ? dashBulkMode : bulkMode;
  const selectedSet = isDash ? dashBulkSelected : bulkSelected;
  const toggleFn = isDash ? 'toggleDashBulkSelect' : 'toggleBulkSelect';
  const c = getClient(j.clientId);
  const color = c ? c.color : '#ccc';
  const name = c ? c.name : '未指定';
  const status = jobStatus(j);
  const cancelBadge = j.cancelled ? '<span class="cancelled-badge">已取消</span>' : '';
  // 截止日 badge
  let dueBadge = '';
  if (j.endDate && j.endDate !== j.date) {
    const today = todayStr();
    const isUrgent = !j.done && j.endDate < addDays(new Date(), 3);
    const isOverdue = !j.done && j.endDate < today;
    const cls = isOverdue || isUrgent ? 'urgent' : '';
    dueBadge = `<span class="due-badge ${cls}">截止 ${j.endDate.slice(5)}</span>`;
  }
  const tagBadge = j.tag ? `<span class="tag-badge">${escapeHtml(j.tag)}</span>` : '';
  // v2.6: 估價單與子任務 badge
  const estimateBadge = j.isEstimate ? '<span class="due-badge urgent" style="background: var(--warning); color: white;">📄 估價</span>' : '';
  const subDone = (j.subtasks || []).filter(s => s.done).length;
  const subTotal = (j.subtasks || []).length;
  const subBadge = subTotal > 0 ? `<span class="tag-badge">☑️ ${subDone}/${subTotal}</span>` : '';
  // v2.8.0: 折扣 + 部分收款 badge
  const discAmt = jobDiscountAmount(j);
  const discountBadge = discAmt > 0 ? `<span class="tag-badge" style="background: var(--warning-light); color: var(--warning);">折扣 ${fmt(discAmt).replace('NT$','').trim()}</span>` : '';
  const paidTotal = jobPaidTotal(j);
  const finalAmt = jobFinalAmount(j);
  const partialBadge = (paidTotal > 0 && !jobIsFullyPaid(j))
    ? `<span class="tag-badge" style="background: var(--warning-light); color: var(--warning);">已收 ${fmt(paidTotal).replace('NT$','').trim()}/${fmt(finalAmt).replace('NT$','').trim()}</span>`
    : '';
  const writeOffBadge = (+j.writeOff > 0) ? `<span class="tag-badge" style="background: var(--muted); color: white;">呆帳 ${fmt(j.writeOff).replace('NT$','').trim()}</span>` : '';
  const hl = highlightJobIds.has(j.id) ? ' highlight' : '';
  const isSelected = selectedSet.has(j.id);
  const selCls = isSelected ? ' selected' : '';

  // 批次模式：顯示批次 checkbox 取代雙勾，整個 row 點擊變成 toggle 選取
  if (inBulk) {
    return `<div class="row state-${status}${hl}${selCls}" data-job-id="${j.id}" onclick="${toggleFn}('${j.id}')">
      <div class="bulk-checkbox ${isSelected?'checked':''}"></div>
      <div class="dot" style="background:${color}"></div>
      <div class="info">
        <div class="title">${escapeHtml(j.title || '（無標題）')}${estimateBadge}${tagBadge}${dueBadge}${subBadge}${discountBadge}${partialBadge}${writeOffBadge}${cancelBadge}</div>
        <div class="meta">${name} · ${j.date || '無日期'}</div>
      </div>
      <div class="amount">${fmt(jobFinalAmount(j))}</div>
    </div>`;
  }

  return `<div class="row state-${status}${hl}" data-job-id="${j.id}" onclick="editJob('${j.id}')">
    <div class="check-group" onclick="event.stopPropagation();">
      <div class="check-with-label" onclick="toggleDone('${j.id}')">
        <div class="check ${j.done?'done':''}" title="點一下標記「案件完成」"></div>
        <div class="check-label ${j.done?'done':''}">完成</div>
      </div>
      <div class="check-with-label" onclick="togglePaid('${j.id}')">
        <div class="check paid-check ${j.paid?'done':''}" title="點一下標記「已收款」"></div>
        <div class="check-label ${j.paid?'paid':''}">收款</div>
      </div>
    </div>
    <div class="dot" style="background:${color}"></div>
    <div class="info">
      <div class="title">${escapeHtml(j.title || '（無標題）')}${estimateBadge}${tagBadge}${dueBadge}${subBadge}${discountBadge}${partialBadge}${writeOffBadge}${cancelBadge}</div>
      <div class="meta">${name} · ${j.date || '無日期'}</div>
    </div>
    <div class="amount">${fmt(finalAmt)}</div>
  </div>`;
}

// ============== Jobs Tab ==============
function renderJobs() {
  const fb = document.getElementById('job-filter');
  // 年/月階層式篩選：列出最近 5 年，點開後展開該年的月份
  const allMonths = [...new Set(state.jobs.map(j => getMonth(j.date)).filter(Boolean))].sort().reverse();
  const allYears = [...new Set(allMonths.map(m => m.slice(0,4)))].sort().reverse();
  const recentYears = allYears.slice(0, 5);  // 最近 5 年
  const expandedY = state.filters.expandedYear;
  // 月份篩選 chips（依展開年份顯示）
  const monthChips = expandedY ? allMonths.filter(m => m.startsWith(expandedY + '-')) : [];

  const statusOptions = [
    { v: 'all', label: '全部狀態' },
    { v: 'pending', label: '未完成' },
    { v: 'prepaid', label: '已收·待做' },
    { v: 'done-unpaid', label: '完成待收款' },
    { v: 'partial', label: '🔶 部分收款' },   // v2.9
    { v: 'paid', label: '已完成已收款' },
    { v: 'cancelled', label: '🚫 已取消' },
    { v: 'estimate', label: '📄 估價單' }
  ];
  const usedTags = getUsedTags();
  // 第一排：本月、全部、各年份
  const yearChips = `<button class="chip ${state.filters.month==='current'?'active':''}" onclick="setFilter('month','current')">本月</button>` +
    `<button class="chip ${state.filters.month==='all'?'active':''}" onclick="setFilter('month','all')">全部</button>` +
    recentYears.map(y => {
      const isExpanded = expandedY === y;
      const isActive = state.filters.month?.startsWith(y);
      return `<button class="chip ${isActive?'active':''}" onclick="toggleYearExpand('${y}')">${y} ${isExpanded?'▼':'▶'}</button>`;
    }).join('') +
    `<button class="chip ${state.filters.month==='custom-range'?'active':''}" onclick="openCustomMonthFilter()">📌 自訂範圍</button>`;

  // 第二排：展開的年份顯示其月份
  const monthSubChips = expandedY
    ? '<div style="display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 0 0 24px;">' +
      monthChips.map(m => `<button class="chip ${state.filters.month===m?'active':''}" onclick="setFilter('month','${m}')">${m.slice(5)}月</button>`).join('') +
      '</div>'
    : '';

  // 自訂範圍 inline picker
  const customRangeUI = state.filters.month === 'custom-range'
    ? '<div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 6px 0 0 24px; font-size: 13px;">' +
      '<span style="color: var(--muted);">範圍：</span>' +
      `<input type="month" id="filter-month-from" value="${state.filters.monthFrom || ''}" onchange="applyMonthRangeFromInputs()" style="max-width: 140px;">` +
      '<span style="color: var(--muted);">~</span>' +
      `<input type="month" id="filter-month-to" value="${state.filters.monthTo || ''}" onchange="applyMonthRangeFromInputs()" style="max-width: 140px;">` +
      '</div>'
    : '';

  fb.innerHTML =
    '<div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">' +
      '<div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">' +
        '<span class="filter-bar-label">月份</span>' + yearChips +
      '</div>' +
      monthSubChips +
      customRangeUI +
      '<div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px;">' +
        '<span class="filter-bar-label">狀態</span>' +
        statusOptions.map(s => `<button class="chip ${state.filters.status===s.v?'active':''}" onclick="setFilter('status','${s.v}')">${s.label}</button>`).join('') +
      '</div>' +
      '<div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px;">' +
        '<span class="filter-bar-label">業主</span>' +
        `<button class="chip ${state.filters.clientId==='all'?'active':''}" onclick="setFilter('clientId','all')">全部</button>` +
        state.clients.map(c => `<button class="chip ${state.filters.clientId===c.id?'active':''}" onclick="setFilter('clientId','${c.id}')" style="${state.filters.clientId===c.id?'':'border-left: 3px solid '+c.color+';'}">${escapeHtml(c.name)}</button>`).join('') +
      '</div>' +
      (usedTags.length
        ? '<div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px;">' +
          '<span class="filter-bar-label">類型</span>' +
          `<button class="chip ${state.filters.tag==='all'?'active':''}" onclick="setFilter('tag','all')">全部</button>` +
          usedTags.map(t => `<button class="chip ${state.filters.tag===t?'active':''}" onclick="setFilter('tag','${escapeHtml(t)}')">${escapeHtml(t)}</button>`).join('') +
          '</div>'
        : '') +
    '</div>';

  // v2.6: 估價單模式單獨檢視；其他狀態自動排除估價單
  let jobs;
  if (state.filters.status === 'estimate') {
    jobs = state.jobs.filter(j => j.isEstimate && !j.cancelled);
  } else {
    jobs = state.jobs.filter(j => !j.isEstimate);
  }

  // 提醒卡片帶來的鎖定篩選（最高優先）
  if (state.filters.jobIdsOnly) {
    jobs = jobs.filter(j => state.filters.jobIdsOnly.has(j.id));
  }

  const fm = state.filters.month;
  if (fm === 'current') jobs = jobs.filter(j => jobBelongMonth(j) === thisMonth());
  else if (fm === 'all') {/* 不過濾 */}
  else if (fm === 'custom-range' && state.filters.monthFrom && state.filters.monthTo) {
    const lo = state.filters.monthFrom, hi = state.filters.monthTo;
    jobs = jobs.filter(j => {
      const m = jobBelongMonth(j);
      return m >= lo && m <= hi;
    });
  }
  else if (fm && /^\d{4}$/.test(fm)) {
    // 整年
    jobs = jobs.filter(j => jobBelongMonth(j).startsWith(fm + '-'));
  }
  else if (fm) jobs = jobs.filter(j => jobBelongMonth(j) === fm);
  if (state.filters.clientId !== 'all') jobs = jobs.filter(j => j.clientId === state.filters.clientId);
  // 'estimate' 狀態已在前面用 isEstimate 篩過了，'partial' 用 paymentTotal 判斷
  if (state.filters.status === 'partial') {
    jobs = jobs.filter(j => !j.cancelled && !j.isEstimate && jobPaidTotal(j) > 0 && !jobIsFullyPaid(j));
  } else if (state.filters.status !== 'all' && state.filters.status !== 'estimate') {
    jobs = jobs.filter(j => jobStatus(j) === state.filters.status);
  }
  if (state.filters.tag && state.filters.tag !== 'all') jobs = jobs.filter(j => j.tag === state.filters.tag);
  jobs.sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const container = document.getElementById('jobs-list');
  if (!jobs.length) { container.innerHTML = emptyState('沒有符合條件的案件', '換個篩選或新增一筆'); return; }
  // 計算合計時排除取消案件
  const activeInList = jobs.filter(j => !j.cancelled);
  // v2.9: 用 finalAmount + paymentTotal 計算
  const total = activeInList.reduce((s,j) => s + jobFinalAmount(j), 0);
  const paidTotal = activeInList.reduce((s,j) => s + jobPaidTotal(j), 0);
  const unpaidTotal = activeInList.filter(j => j.done).reduce((s,j) => s + jobUnpaidAmount(j), 0);
  const cancelledCount = jobs.filter(j => j.cancelled).length;
  // 鎖定篩選 banner
  const lockBanner = state.filters.jobIdsOnly
    ? `<div style="padding: 8px 12px; background: var(--warning-light); border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; font-size: 13px;">
        <span style="flex: 1;">📌 ${escapeHtml(state.filters.jobIdsOnlyLabel || '篩選中')}</span>
        <button class="btn btn-outline btn-sm" onclick="clearJobsLock()">✕ 清除</button>
       </div>`
    : '';

  container.innerHTML = lockBanner +
    `<div style="padding: 8px 0 12px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted);">
       共 ${jobs.length} 筆${cancelledCount ? `（含 ${cancelledCount} 筆已取消）` : ''}　已收 <b style="color:var(--success)">${fmt(paidTotal)}</b>
       ${unpaidTotal ? `· 待收 <b style="color:var(--warning)">${fmt(unpaidTotal)}</b>` : ''}
       · 計入統計 ${fmt(total)}
     </div>` +
    jobs.map(jobRow).join('');
}

// ============== Calendar Tab ==============
function calPrev() { calCursor.setMonth(calCursor.getMonth()-1); renderCalendar(); }
function calNext() { calCursor.setMonth(calCursor.getMonth()+1); renderCalendar(); }
function calToday() { calCursor = new Date(); calCursor.setDate(1); renderCalendar(); }

function renderCalendar() {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  document.getElementById('cal-title').textContent = `${y} 年 ${m+1} 月`;

  const first = new Date(y, m, 1);
  const firstDow = first.getDay(); // 0=日
  const lastDay = new Date(y, m+1, 0).getDate();
  const prevLast = new Date(y, m, 0).getDate();

  const cells = [];
  // 週標題
  ['日','一','二','三','四','五','六'].forEach((d,i) => {
    const cls = i===0?'sun':(i===6?'sat':'');
    cells.push(`<div class="cal-dow ${cls}">${d}</div>`);
  });

  // 前月填充
  for (let i = firstDow-1; i >= 0; i--) {
    cells.push(cellHtml(y, m-1, prevLast-i, true));
  }
  // 當月
  for (let d = 1; d <= lastDay; d++) {
    cells.push(cellHtml(y, m, d, false));
  }
  // 後月填充到 6 週
  const total = firstDow + lastDay;
  const need = Math.ceil(total/7)*7 - total;
  for (let d = 1; d <= need; d++) {
    cells.push(cellHtml(y, m+1, d, true));
  }

  document.getElementById('cal-grid').innerHTML = cells.join('');

  // 本月列表
  const mm = `${y}-${String(m+1).padStart(2,'0')}`;
  const monthJobs = state.jobs
    .filter(j => getMonth(j.date) === mm)
    .sort((a,b) => (a.date||'').localeCompare(b.date||''));
  // 未來 30 天清單
  const today = todayStr();
  const in30 = addDays(new Date(), 30);
  const upcoming = activeJobs()
    .filter(j => j.date && j.date >= today && j.date <= in30)
    .sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const upBox = document.getElementById('cal-upcoming');
  if (upBox) {
    if (!upcoming.length) {
      upBox.innerHTML = '<div class="empty" style="padding: 24px;"><div style="font-size: 13px;">未來 30 天沒有排程</div></div>';
    } else {
      upBox.innerHTML = upcoming.map(j => {
        const c = getClient(j.clientId);
        const color = c ? c.color : '#ccc';
        const status = jobStatus(j);
        const badge = status === 'paid' ? '<span class="badge-status paid">✓ 已收款</span>' :
                      status === 'done-unpaid' ? '<span class="badge-status done-unpaid">$ 待收款</span>' :
                      '<span class="badge-status pending">進行中</span>';
        const dayDelta = daysBetween(today, j.date);
        const dayLabel = dayDelta === 0 ? '今天' : dayDelta === 1 ? '明天' : `${dayDelta}天後`;
        return `<div class="cal-list-row" onclick="editJob('${j.id}')">
          <div class="cal-list-date" style="font-weight: 600; color: ${dayDelta <= 3 ? 'var(--warning)' : 'var(--muted)'};">${j.date.slice(5)} (${dayLabel})</div>
          <div class="dot" style="background:${color}; width: 8px; height: 8px;"></div>
          <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(j.title)}</div>
          ${badge}
          <div style="font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px;">${fmt(+j.amount||0)}</div>
        </div>`;
      }).join('');
    }
  }

  document.getElementById('cal-list-title').textContent = `${mm} 排程列表（${monthJobs.length} 筆）`;
  const listBox = document.getElementById('cal-list');
  if (!monthJobs.length) {
    listBox.innerHTML = emptyState('本月沒有案件', '');
  } else {
    listBox.innerHTML = monthJobs.map(j => {
      const c = getClient(j.clientId);
      const color = c ? c.color : '#ccc';
      const status = jobStatus(j);
      const badge = status === 'paid' ? '<span class="badge-status paid">✓ 已收款</span>' :
                    status === 'done-unpaid' ? '<span class="badge-status done-unpaid">$ 待收款</span>' :
                    '<span class="badge-status pending">進行中</span>';
      return `<div class="cal-list-row" onclick="editJob('${j.id}')">
        <div class="cal-list-date">${(j.date||'').slice(5)}</div>
        <div class="dot" style="background:${color}; width: 8px; height: 8px;"></div>
        <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(j.title)}</div>
        ${badge}
        <div style="font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px;">${fmt(+j.amount||0)}</div>
      </div>`;
    }).join('');
  }
}

function cellHtml(y, m, d, isOther) {
  const dateNorm = new Date(y, m, d);
  // 用 local 日期格式而非 toISOString（避免時區問題）
  const ds = `${dateNorm.getFullYear()}-${String(dateNorm.getMonth()+1).padStart(2,'0')}-${String(dateNorm.getDate()).padStart(2,'0')}`;
  const isToday = ds === todayStr();
  const dow = dateNorm.getDay();
  const dowCls = dow===0?'sun':(dow===6?'sat':'');
  // 該天案件：startDate == ds，或 startDate <= ds <= endDate（跨天）
  const jobs = state.jobs.filter(j => {
    if (j.cancelled) return false;
    if (j.date === ds) return true;
    if (j.endDate && j.date && j.date <= ds && ds <= j.endDate) return true;
    return false;
  });
  const maxShow = 3;
  const chips = jobs.slice(0, maxShow).map(j => {
    const c = getClient(j.clientId);
    const bg = c ? c.color : '#999';
    const status = jobStatus(j);
    let cls = status === 'paid' ? 'paid' : (status === 'done-unpaid' ? 'done-unpaid' : (status === 'prepaid' ? 'prepaid' : ''));
    // 跨天案件加 spans class
    const isSpan = j.endDate && j.date && j.endDate !== j.date && ds !== j.date;
    if (isSpan) cls += ' spans';
    return `<div class="cal-chip ${cls}" style="background:${bg}" onclick="event.stopPropagation(); editJob('${j.id}')" title="${escapeHtml(j.title)} · ${fmt(+j.amount||0)}${j.endDate?' · '+j.date+' ~ '+j.endDate:''}">${escapeHtml(j.title)}</div>`;
  }).join('');
  const more = jobs.length > maxShow ? `<div class="cal-more">+${jobs.length-maxShow}</div>` : '';
  const classes = ['cal-cell', dowCls, isOther?'other-month':'', isToday?'today':''].filter(Boolean).join(' ');
  return `<div class="${classes}" onclick="quickAddOnDate('${ds}')"><div class="cal-date">${d}</div>${chips}${more}</div>`;
}

function quickAddOnDate(ds) {
  // 點空白格子：快速在那天新增案件
  if (!state.clients.length) { toast('請先新增業主'); switchTab('clients'); openClientModal(); return; }
  openJobModal();
  document.getElementById('job-date').value = ds;
}

// ============== Clients Tab ==============
function toggleClientExpand(cid) {
  if (expandedClients.has(cid)) expandedClients.delete(cid);
  else expandedClients.add(cid);
  renderClients();
}

// 案件分頁年度展開
function toggleYearExpand(y) {
  // 清除提醒/業主排行帶來的鎖定篩選
  state.filters.jobIdsOnly = null;
  state.filters.jobIdsOnlyLabel = '';
  if (state.filters.expandedYear === y) {
    state.filters.expandedYear = null;
    if (state.filters.month?.startsWith(y)) state.filters.month = 'all';
  } else {
    state.filters.expandedYear = y;
    state.filters.month = y;  // 預設選整年
  }
  render();
}

function openCustomMonthFilter() {
  // 清除提醒/業主排行帶來的鎖定篩選
  state.filters.jobIdsOnly = null;
  state.filters.jobIdsOnlyLabel = '';
  // 切換顯示 inline picker
  state.filters.month = 'custom-range';
  state.filters.expandedYear = null;
  // 預設值
  if (!state.filters.monthFrom) state.filters.monthFrom = thisMonth();
  if (!state.filters.monthTo) state.filters.monthTo = thisMonth();
  render();
  // 等 render 後 focus 到 from
  setTimeout(() => document.getElementById('filter-month-from')?.focus(), 50);
}

function applyMonthRangeFromInputs() {
  const from = document.getElementById('filter-month-from')?.value;
  const to = document.getElementById('filter-month-to')?.value;
  if (!from || !to) return;
  // 清除提醒/業主排行帶來的鎖定篩選
  state.filters.jobIdsOnly = null;
  state.filters.jobIdsOnlyLabel = '';
  state.filters.monthFrom = from <= to ? from : to;
  state.filters.monthTo = from <= to ? to : from;
  render();
}

function renderClients() {
  const container = document.getElementById('clients-list');
  if (!state.clients.length) { container.innerHTML = emptyState('還沒有業主', '點右下角 + 新增第一個業主'); return; }

  // 搜尋詞
  const searchEl = document.getElementById('client-search');
  const q = (searchEl?.value || '').trim().toLowerCase();
  // 排序模式
  const sortEl = document.getElementById('client-sort');
  const sortMode = sortEl?.value || 'recent';

  // 為每個業主計算統計與排序鍵
  let list = state.clients.map(c => {
    const clientJobs = activeJobs().filter(j => j.clientId === c.id);
    const totalAmt = clientJobs.reduce((s,j) => s + jobFinalAmount(j), 0);
    const unpaidAmt = clientJobs.filter(j => j.done).reduce((s,j) => s + jobUnpaidAmount(j), 0);
    const lastDate = clientJobs.map(j => j.date || '').sort().reverse()[0] || '';
    return { client: c, totalAmt, unpaidAmt, lastDate };
  });

  // 搜尋過濾
  if (q) list = list.filter(x => x.client.name.toLowerCase().includes(q) || (x.client.note||'').toLowerCase().includes(q));

  // 排序
  if (sortMode === 'name') list.sort((a,b) => a.client.name.localeCompare(b.client.name, 'zh-TW'));
  else if (sortMode === 'total') list.sort((a,b) => b.totalAmt - a.totalAmt);
  else if (sortMode === 'unpaid') list.sort((a,b) => b.unpaidAmt - a.unpaidAmt);
  else list.sort((a,b) => (b.lastDate || '').localeCompare(a.lastDate || ''));  // recent

  if (!list.length) {
    container.innerHTML = emptyState('沒有符合條件的業主', '換個搜尋詞');
    return;
  }

  container.innerHTML = list.map(({client: c}) => {
    const clientJobs = activeJobs().filter(j => j.clientId === c.id);
    const m = thisMonth();
    const mJobs = clientJobs.filter(j => jobBelongMonth(j) === m);
    // v2.9: 已收用 payment.date 在本月的金額；待收用 jobUnpaidAmount
    const mPaid = clientJobs.reduce((s,j) => s + (j.payments || []).filter(p => getMonth(p.date) === m).reduce((ss,p) => ss + (+p.amount||0), 0), 0);
    const mUnpaid = mJobs.filter(j => j.done).reduce((s,j) => s + jobUnpaidAmount(j), 0);
    const allUnpaid = clientJobs.filter(j => j.done).reduce((s,j) => s + jobUnpaidAmount(j), 0);
    // 分潤資訊
    const introducer = c.commissionTo ? state.clients.find(x => x.id === c.commissionTo) : null;
    const commissionInfo = (c.commissionRate > 0 && introducer)
      ? `<span class="commission-info">介紹人 ${escapeHtml(introducer.name)} · 抽成 ${c.commissionRate}%</span>`
      : '';

    // 儲值制餘額
    const bal = clientBalance(c.id);
    let balanceBadge = '';
    if (bal) {
      const cls = bal.balance < 0 ? 'empty' : (bal.balance < 1000 ? 'low' : '');
      balanceBadge = `<span class="prepaid-badge ${cls}" title="累計儲值 ${fmt(bal.total)} - 已用 ${fmt(bal.used)}">💰 餘額 ${fmt(bal.balance)}</span>`;
    }
    // 活躍度時間軸（v2.10.3 隱藏）
    const timelineHtml = '';

    const isExpanded = expandedClients.has(c.id);
    const expandIcon = isExpanded ? '▼' : '▶';

    // 健康度指標（v2.10.3 隱藏）
    const healthBadge = '';

    // 展開時顯示該業主的案件清單（最近 50 筆，健康度詳情已隱藏）
    let expandedJobsHtml = '';
    if (isExpanded) {
      expandedJobsHtml = `<div style="margin-top: 10px; padding: 12px; background: var(--bg); border-radius: 8px;">`;
      const recent = clientJobs.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 50);
      expandedJobsHtml += `
        <div style="font-size: 12px; color: var(--muted); margin-bottom: 6px;">
          最近 ${recent.length} 筆（共 ${clientJobs.length} 筆）
        </div>
        ${recent.map(j => {
          const status = jobStatus(j);
          const statusBadge = status === 'paid' ? '<span class="badge-status paid">✓已收</span>' :
                              status === 'prepaid' ? '<span class="badge-status paid">已收·待做</span>' :
                              status === 'done-unpaid' ? '<span class="badge-status done-unpaid">$待收</span>' :
                              '<span class="badge-status pending">進行中</span>';
          return `<div style="display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;" onclick="event.stopPropagation(); editJob('${j.id}')">
            <span style="color: var(--muted); min-width: 80px; font-size: 12px;">${j.date || '-'}</span>
            <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;">${escapeHtml(j.title || '')}</span>
            ${statusBadge}
            <span style="font-variant-numeric: tabular-nums; font-weight: 600;">${fmt(+j.amount||0)}</span>
          </div>`;
        }).join('')}
      </div>`;
    }

    return `<div style="padding: 14px 0; border-bottom: 1px solid var(--border);">
      <div class="client-header" style="cursor: pointer;" onclick="toggleClientExpand('${c.id}')">
        <span style="color: var(--muted); font-size: 12px; min-width: 16px;">${expandIcon}</span>
        <div class="dot" style="background:${c.color}; width: 12px; height: 12px;"></div>
        <div style="font-weight: 600; flex: 1;">
          ${escapeHtml(c.name)}
          ${healthBadge}
          ${balanceBadge}
          ${allUnpaid > 0 && !c.prepaidMode ? `<span class="client-owes">待收 ${fmt(allUnpaid)}</span>` : ''}
          ${commissionInfo}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); editClient('${c.id}')">編輯</button>
      </div>
      <div style="font-size: 13px; color: var(--muted); margin-bottom: 4px; padding-left: 24px;">
        本月已收 ${fmt(mPaid)} · 待收 ${fmt(mUnpaid)} · 累計 ${clientJobs.length} 筆
      </div>
      ${timelineHtml}
      ${expandedJobsHtml}
      <div style="display:flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
        <button class="btn btn-outline btn-sm" onclick="setFilter('clientId','${c.id}'); switchTab('jobs')">查看案件</button>
        <button class="btn btn-outline btn-sm" onclick="gotoInvoice('${c.id}')">產生請款單</button>
        <button class="btn btn-outline btn-sm" onclick="copyShareLink('${c.id}')">複製分享連結</button>
      </div>
    </div>`;
  }).join('');
}

// ============== Revenue Tab ==============
function setRevenueMode(mode) {
  revenueState.mode = mode;
  document.getElementById('rev-mode-month').classList.toggle('active', mode==='month');
  document.getElementById('rev-mode-year').classList.toggle('active', mode==='year');
  buildRangeOptions();
  renderRevenue();
}

// 動態產生範圍選單
function buildRangeOptions() {
  const rangeSel = document.getElementById('rev-range');
  if (!rangeSel) return;
  let html = '';
  if (revenueState.mode === 'year') {
    const thisY = new Date().getFullYear();
    const startY = thisY - 4;
    html += `<option value="5" selected>📅 近五年</option>`;
    html += '<option disabled>── 單一年度 ──</option>';
    for (let y = thisY; y >= startY; y--) {
      html += `<option value="year-${y}">${y}</option>`;
    }
    html += '<option disabled>──────────</option>';
    html += `<option value="ytd">📅 ${thisY} 至今</option>`;
    html += '<option value="all">全部歷史</option>';
    html += '<option value="custom">📌 自訂年份範圍</option>';
    revenueState.range = '5';
  } else {
    html += '<option value="3">最近 3 個月</option>';
    html += '<option value="6">最近 6 個月</option>';
    html += '<option value="12" selected>最近 12 個月</option>';
    html += '<option value="24">最近 24 個月</option>';
    html += '<option value="all">全部</option>';
    html += '<option disabled>──────────</option>';
    html += '<option value="custom">📌 自訂月份範圍</option>';
    revenueState.range = '12';
  }
  rangeSel.innerHTML = html;
  document.getElementById('rev-custom-month')?.classList.add('hidden');
  document.getElementById('rev-custom-year')?.classList.add('hidden');
}

function onRangeChange() {
  const v = document.getElementById('rev-range').value;
  revenueState.range = v;
  // 顯示/隱藏自訂欄位
  const cm = document.getElementById('rev-custom-month');
  const cy = document.getElementById('rev-custom-year');
  cm?.classList.add('hidden');
  cy?.classList.add('hidden');
  if (v === 'custom') {
    if (revenueState.mode === 'month') {
      cm?.classList.remove('hidden');
      // 預設值
      const fromEl = document.getElementById('rev-from-month');
      const toEl = document.getElementById('rev-to-month');
      if (!fromEl.value) {
        const allMonths = [...new Set(state.jobs.map(j => getMonth(j.date)).filter(Boolean))].sort();
        if (allMonths.length) fromEl.value = allMonths[0];
        else fromEl.value = thisMonth();
      }
      if (!toEl.value) toEl.value = thisMonth();
    } else {
      cy?.classList.remove('hidden');
      const fromEl = document.getElementById('rev-from-year');
      const toEl = document.getElementById('rev-to-year');
      if (!fromEl.value) {
        const allYears = [...new Set(state.jobs.map(j => (j.date||'').slice(0,4)).filter(Boolean))].sort();
        if (allYears.length) fromEl.value = allYears[0];
        else fromEl.value = new Date().getFullYear();
      }
      if (!toEl.value) toEl.value = new Date().getFullYear();
    }
  }
  renderRevenue();
}

function renderRevenue() {
  // 填充業主下拉
  const cSel = document.getElementById('rev-client');
  if (cSel) {
    const cur = cSel.value || 'all';
    cSel.innerHTML =
      '<option value="all">全部業主</option>' +
      state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    cSel.value = state.clients.find(c => c.id === cur) ? cur : 'all';
    revenueState.clientId = cSel.value;
  }

  const rangeSel = document.getElementById('rev-range');
  if (rangeSel) {
    revenueState.range = rangeSel.value;
  }

  // 過濾業主，並排除取消的案件
  let jobs = activeJobs();
  if (revenueState.clientId !== 'all') jobs = jobs.filter(j => j.clientId === revenueState.clientId);

  // v2.8.1: 收益依「payment 日期」歸月（每筆 payment 各自歸到實際入帳月）
  // 待收/進行中：用案件的 j.date 歸月（因為還沒收所以沒有 payment date）
  const buckets = {};
  const ensureKey = (k) => { if (!buckets[k]) buckets[k] = { paid: 0, unpaid: 0, pending: 0 }; };

  jobs.forEach(j => {
    // 各筆 payment 歸入該 payment 的月份/年份
    (j.payments || []).forEach(p => {
      if (!p.date) return;
      const k = revenueState.mode === 'year' ? p.date.slice(0,4) : p.date.slice(0,7);
      ensureKey(k);
      buckets[k].paid += (+p.amount || 0);
    });
    // 未收的部分（unpaid/pending）依案件 j.date 歸月
    if (!j.date) return;
    const key = revenueState.mode === 'year' ? j.date.slice(0,4) : j.date.slice(0,7);
    ensureKey(key);
    const unpaidAmt = jobUnpaidAmount(j);
    if (unpaidAmt > 0) {
      if (j.done) buckets[key].unpaid += unpaidAmt;
      else buckets[key].pending += unpaidAmt;
    }
  });

  let keys = Object.keys(buckets).sort();
  if (!keys.length) keys = [revenueState.mode==='year' ? String(new Date().getFullYear()) : thisMonth()];

  // 補齊空月/空年
  const filled = fillEmptyBuckets(keys, revenueState.mode);
  filled.forEach(k => { if (!buckets[k]) buckets[k] = { paid: 0, unpaid: 0, pending: 0 }; });

  // 依 range 決定顯示範圍
  const r = String(revenueState.range);
  let displayKeys = filled;

  if (r === 'all') {
    displayKeys = filled;
  } else if (r === 'ytd') {
    // 今年至今：年度模式才有此選項
    const y = String(new Date().getFullYear());
    displayKeys = filled.filter(k => k === y);
    if (!buckets[y]) buckets[y] = { paid: 0, unpaid: 0, pending: 0 };
    if (!displayKeys.length) displayKeys = [y];
  } else if (r.startsWith('year-')) {
    // 單一年度（年度模式）
    const y = r.slice(5);
    displayKeys = [y];
    if (!buckets[y]) buckets[y] = { paid: 0, unpaid: 0, pending: 0 };
  } else if (r === 'custom') {
    // 自訂範圍
    if (revenueState.mode === 'month') {
      const from = document.getElementById('rev-from-month')?.value || filled[0];
      const to = document.getElementById('rev-to-month')?.value || filled[filled.length-1];
      const lo = from <= to ? from : to;
      const hi = from <= to ? to : from;
      displayKeys = filled.filter(k => k >= lo && k <= hi);
    } else {
      const from = document.getElementById('rev-from-year')?.value || filled[0];
      const to = document.getElementById('rev-to-year')?.value || filled[filled.length-1];
      const lo = +from <= +to ? +from : +to;
      const hi = +from <= +to ? +to : +from;
      displayKeys = filled.filter(k => +k >= lo && +k <= hi);
    }
  } else {
    // 數字 = 最近 N 個
    const n = +r;
    if (n > 0) {
      // 年度模式：固定取「截至當年」的最近 N 年（不超過今年）
      if (revenueState.mode === 'year') {
        const thisY = new Date().getFullYear();
        const wantedYears = [];
        for (let y = thisY - n + 1; y <= thisY; y++) wantedYears.push(String(y));
        // filled 中存在的部分，加上當年（即使沒資料也顯示）
        displayKeys = wantedYears;
        // 確保 buckets 有當年（沒就建空的）
        wantedYears.forEach(y => { if (!buckets[y]) buckets[y] = { paid: 0, unpaid: 0, pending: 0 }; });
      } else {
        displayKeys = filled.slice(-n);
      }
    }
  }

  const data = displayKeys.map(k => ({ label: k, ...buckets[k] }));

  // 「今年至今」模式下，把今年的 label 標註「至今」
  if (r === 'ytd' && revenueState.mode === 'year') {
    const thisY = String(new Date().getFullYear());
    data.forEach(d => {
      if (d.label === thisY) d.label = `${thisY}（至今）`;
    });
  }
  // 單一年度模式：直接顯示年份（不需修改 label）

  // 標題
  const modeLabel = revenueState.mode === 'year' ? '年度' : '月度';
  document.getElementById('rev-chart-title').textContent = `${modeLabel}收益趨勢（${data.length} 期）`;

  // 摘要
  renderRevSummary(data);

  // 主圖表
  drawRevChart(data);

  // 業主貢獻排行
  renderClientRank(jobs, revenueState.range === 'all' ? null : displayKeys);

  // 新增的三張卡片
  renderTagPie();
  renderHeatmap();
  renderMonthlyReport();
  // v2.7
  renderBusyCycle();
  renderHourlyTrend();
  // v2.9: 收款時間軸
  renderPaymentTimeline();
}

function fillEmptyBuckets(keys, mode) {
  if (!keys.length) return [];
  const sorted = [...keys].sort();
  const first = sorted[0];
  const last = sorted[sorted.length-1];
  const result = [];

  if (mode === 'year') {
    const fy = +first, ly = +last;
    for (let y = fy; y <= ly; y++) result.push(String(y));
  } else {
    let [fy, fm] = first.split('-').map(Number);
    const [ly, lm] = last.split('-').map(Number);
    while (fy < ly || (fy === ly && fm <= lm)) {
      result.push(`${fy}-${String(fm).padStart(2,'0')}`);
      fm++;
      if (fm > 12) { fm = 1; fy++; }
    }
  }
  // 補到至少當期
  const now = mode === 'year' ? String(new Date().getFullYear()) : thisMonth();
  if (result.length && result[result.length-1] < now) {
    if (mode === 'year') {
      let y = +result[result.length-1] + 1;
      while (y <= +now) { result.push(String(y)); y++; }
    } else {
      let [y, m] = result[result.length-1].split('-').map(Number);
      m++;
      while (`${y}-${String(m).padStart(2,'0')}` <= now) {
        result.push(`${y}-${String(m).padStart(2,'0')}`);
        m++; if (m > 12) { m = 1; y++; }
      }
    }
  }
  return result;
}

function renderRevSummary(data) {
  const totalPaid = data.reduce((s,d) => s + d.paid, 0);
  const totalUnpaid = data.reduce((s,d) => s + d.unpaid, 0);
  const totalPending = data.reduce((s,d) => s + d.pending, 0);
  const total = totalPaid + totalUnpaid + totalPending;
  const avg = data.length ? Math.round((totalPaid + totalUnpaid) / data.length) : 0;
  const best = data.slice().sort((a,b) => (b.paid+b.unpaid) - (a.paid+a.unpaid))[0];

  // 對比上期
  const half = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, half).reduce((s,d) => s + d.paid + d.unpaid, 0);
  const secondHalf = data.slice(half).reduce((s,d) => s + d.paid + d.unpaid, 0);
  let delta = '';
  if (firstHalf > 0 && half > 0) {
    const pct = ((secondHalf - firstHalf) / firstHalf * 100).toFixed(0);
    const up = secondHalf >= firstHalf;
    delta = `<div class="delta ${up?'up':'down'}">${up?'↑':'↓'} ${Math.abs(pct)}% vs 前半期</div>`;
  }

  document.getElementById('rev-summary').innerHTML = `
    <div class="summary-card">
      <div class="label">期間總收入</div>
      <div class="value">${fmt(totalPaid + totalUnpaid)}</div>
      ${delta}
    </div>
    <div class="summary-card">
      <div class="label">已收款</div>
      <div class="value" style="color: var(--success);">${fmt(totalPaid)}</div>
      <div class="delta">${total ? Math.round(totalPaid/total*100) : 0}% 已入帳</div>
    </div>
    <div class="summary-card">
      <div class="label">待收款</div>
      <div class="value" style="color: var(--warning);">${fmt(totalUnpaid)}</div>
      <div class="delta" style="color: var(--muted);">${totalUnpaid ? '待請款或催收' : '全部入帳'}</div>
    </div>
    <div class="summary-card">
      <div class="label">每${revenueState.mode==='year'?'年':'月'}平均</div>
      <div class="value">${fmt(avg)}</div>
      <div class="delta" style="color: var(--muted);">共 ${data.length} ${revenueState.mode==='year'?'年':'期'}</div>
    </div>
    ${best && (best.paid+best.unpaid) ? `<div class="summary-card">
      <div class="label">最佳${revenueState.mode==='year'?'年度':'月份'}</div>
      <div class="value" style="font-size: 16px;">${best.label}</div>
      <div class="delta" style="color: var(--primary);">${fmt(best.paid+best.unpaid)}</div>
    </div>` : ''}
  `;
}

// ============== SVG Charts ==============
function drawRevChart(data) {
  const svg = document.getElementById('rev-chart');
  if (!svg) return;

  const W = Math.max(svg.clientWidth || 700, 320);
  const H = 260;
  const margin = { top: 16, right: 14, bottom: 36, left: 60 };
  const chartW = W - margin.left - margin.right;
  const chartH = H - margin.top - margin.bottom;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  if (!data.length) {
    svg.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#8a8f98" font-size="13">沒有資料</text>`;
    return;
  }

  const max = Math.max(...data.map(d => d.paid + d.unpaid + d.pending), 1);
  // 取整到漂亮的刻度
  const niceMax = niceScale(max);
  const n = data.length;
  const barGroupW = chartW / n;
  const barW = Math.min(barGroupW * 0.6, 50);

  const parts = [];

  // Y 軸格線 + 刻度
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = margin.top + chartH - (i/gridCount) * chartH;
    const val = Math.round(niceMax * i / gridCount);
    parts.push(`<line x1="${margin.left}" y1="${y}" x2="${W-margin.right}" y2="${y}" stroke="#e4e6eb" stroke-width="1"/>`);
    parts.push(`<text x="${margin.left-6}" y="${y+4}" text-anchor="end" fill="#8a8f98" font-size="10">${fmtShort(val)}</text>`);
  }

  // 柱 + 趨勢線點
  const linePoints = [];
  data.forEach((d, i) => {
    const cx = margin.left + i * barGroupW + barGroupW/2;
    const bx = cx - barW/2;

    const total = d.paid + d.unpaid + d.pending;
    let yCursor = margin.top + chartH;

    // 已收 (底)
    if (d.paid > 0) {
      const h = d.paid / niceMax * chartH;
      yCursor -= h;
      parts.push(`<rect x="${bx}" y="${yCursor}" width="${barW}" height="${h}" fill="#10b981" rx="2"><title>${d.label}　已收 ${fmt(d.paid)}</title></rect>`);
    }
    // 待收 (中)
    if (d.unpaid > 0) {
      const h = d.unpaid / niceMax * chartH;
      yCursor -= h;
      parts.push(`<rect x="${bx}" y="${yCursor}" width="${barW}" height="${h}" fill="#f59e0b" rx="2"><title>${d.label}　待收 ${fmt(d.unpaid)}</title></rect>`);
    }
    // 進行中 (頂，透明)
    if (d.pending > 0) {
      const h = d.pending / niceMax * chartH;
      yCursor -= h;
      parts.push(`<rect x="${bx}" y="${yCursor}" width="${barW}" height="${h}" fill="#8a8f98" opacity="0.3" rx="2"><title>${d.label}　進行中 ${fmt(d.pending)}</title></rect>`);
    }

    // 趨勢線點
    const ly = margin.top + chartH - (total / niceMax * chartH);
    linePoints.push({ x: cx, y: ly, label: d.label, total });

    // X 軸標籤
    const xLabel = data.length > 12 ? (i % 2 === 0 ? d.label : '') : d.label;
    const shortLabel = revenueState.mode === 'year' ? xLabel : xLabel.slice(5);
    parts.push(`<text x="${cx}" y="${H-margin.bottom+16}" text-anchor="middle" fill="#8a8f98" font-size="10">${shortLabel}</text>`);
  });

  // 累計線（從第一期到當期，顯示成長曲線）
  let cumTotal = 0;
  const cumPoints = [];
  data.forEach((d, i) => {
    cumTotal += d.paid + d.unpaid;  // 不算進行中的
    const cx = margin.left + i * barGroupW + barGroupW/2;
    cumPoints.push({ x: cx, value: cumTotal });
  });
  const cumMax = Math.max(...cumPoints.map(p => p.value), 1);
  cumPoints.forEach(p => {
    p.y = margin.top + chartH - (p.value / cumMax * chartH);
  });

  // 累計線（淡紫虛線，顯示在底層）
  if (cumPoints.length > 1) {
    const cumPath = 'M ' + cumPoints.map(p => `${p.x} ${p.y}`).join(' L ');
    parts.push(`<path d="${cumPath}" stroke="#a855f7" stroke-width="2" fill="none" stroke-dasharray="5,3" opacity="0.55"/>`);
    // 起點和終點 label
    if (cumPoints.length > 0) {
      const last = cumPoints[cumPoints.length-1];
      parts.push(`<text x="${last.x - 4}" y="${last.y - 6}" text-anchor="end" fill="#a855f7" font-size="10" font-weight="600">累計 ${fmtShort(last.value)}</text>`);
    }
  }

  // 當期趨勢線（藍色實線，顯示在上層）
  if (linePoints.length > 1) {
    const d = 'M ' + linePoints.map(p => `${p.x} ${p.y}`).join(' L ');
    parts.push(`<path d="${d}" stroke="#2563eb" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    linePoints.forEach(p => {
      if (p.total > 0) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3" fill="#2563eb"/>`);
      }
    });
  }

  svg.innerHTML = parts.join('');
}

function niceScale(max) {
  if (max <= 0) return 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const d = max / pow;
  let nice;
  if (d <= 1) nice = 1;
  else if (d <= 2) nice = 2;
  else if (d <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

function fmtShort(n) {
  if (n >= 10000) return Math.round(n/1000) + 'k';
  if (n >= 1000) return (n/1000).toFixed(1).replace('.0','') + 'k';
  return String(n);
}

// ============== 案件類型派圖 ==============
function renderTagPie() {
  const box = document.getElementById('rev-tag-pie');
  if (!box) return;

  const tagAmounts = {};
  activeJobs().forEach(j => {
    if (!jobIsFullyPaid(j) && jobPaidTotal(j) === 0) return;
    const tag = j.tag || '未分類';
    tagAmounts[tag] = (tagAmounts[tag] || 0) + jobNetAmount(j);
  });

  const entries = Object.entries(tagAmounts).filter(([_,v]) => v > 0).sort((a,b) => b[1] - a[1]);
  if (!entries.length) {
    box.innerHTML = '<div class="empty" style="padding: 20px;"><div style="font-size: 13px;">沒有已收款的案件</div></div>';
    return;
  }

  const total = entries.reduce((s, [_,v]) => s + v, 0);
  const cx = 90, cy = 90, r = 78;
  const colors = ['#2563eb','#10b981','#f59e0b','#ec4899','#8b5cf6','#14b8a6','#ef4444','#eab308','#0891b2','#7c3aed','#92400e','#64748b'];

  let startAngle = -Math.PI / 2;
  const slices = entries.map(([tag, amt], i) => {
    const angle = (amt / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    let path;
    if (entries.length === 1) {
      path = `M ${cx-r} ${cy} A ${r} ${r} 0 1 1 ${cx+r-0.01} ${cy} A ${r} ${r} 0 1 1 ${cx-r} ${cy}`;
    } else {
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = angle > Math.PI ? 1 : 0;
      path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    }
    const slice = `<path d="${path}" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="1.5"><title>${escapeHtml(tag)}：${fmt(amt)} (${(amt/total*100).toFixed(0)}%)</title></path>`;
    startAngle = endAngle;
    return slice;
  });

  const legend = entries.map(([tag, amt], i) => `
    <div class="pie-legend-item">
      <div class="pie-legend-dot" style="background: ${colors[i % colors.length]};"></div>
      <span class="pie-legend-name">${escapeHtml(tag)}</span>
      <span class="pie-legend-amt">${fmt(amt)}</span>
      <span class="pie-legend-pct">${(amt/total*100).toFixed(0)}%</span>
    </div>
  `).join('');

  box.innerHTML = `<div class="pie-container">
    <svg class="pie-svg" viewBox="0 0 180 180" width="180" height="180" xmlns="http://www.w3.org/2000/svg">${slices.join('')}</svg>
    <div class="pie-legend">${legend}</div>
  </div>`;
}

// ============== 工作熱圖 (GitHub-style) ==============
function renderHeatmap() {
  const box = document.getElementById('rev-heatmap');
  if (!box) return;

  const cell = 11;
  const gap = 2;
  const weeks = 53;
  const W = (cell + gap) * weeks + 30;
  const H = (cell + gap) * 7 + 24;

  // 計算每天的收款金額（v2.9: 用 payments 各自日期 + 比例分配 net amount）
  const byDay = {};
  activeJobs().forEach(j => {
    const final = jobFinalAmount(j);
    if (final <= 0) return;
    const net = jobNetAmount(j);
    (j.payments || []).forEach(p => {
      if (!p.date) return;
      const portion = (+p.amount || 0) / final;  // 該筆 payment 佔總比例
      byDay[p.date] = (byDay[p.date] || 0) + Math.round(net * portion);
    });
  });

  const today = new Date();
  // 找開始日：今天 - 365 天，往前找到那週的週日
  const start = new Date(today);
  start.setDate(start.getDate() - 365);
  while (start.getDay() !== 0) start.setDate(start.getDate() - 1);

  const max = Math.max(...Object.values(byDay), 1);
  const colors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

  const cells = [];
  const monthLabels = [];
  let lastMonth = -1;

  const todayStrV = todayStr();
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w*7 + d);
      const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      if (ds > todayStrV) continue;
      const amt = byDay[ds] || 0;
      const intensity = amt > 0 ? Math.min(4, Math.ceil(amt / max * 4)) : 0;
      const x = w * (cell+gap) + 22;
      const y = d * (cell+gap) + 18;
      const isToday = ds === todayStrV;
      cells.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${colors[intensity]}" ${isToday?'stroke="var(--primary)" stroke-width="1.5"':''}><title>${ds}　${fmt(amt)}</title></rect>`);
    }
    // 月份 label（每個月的第一個出現）
    const cur = new Date(start);
    cur.setDate(start.getDate() + w*7);
    if (cur.getMonth() !== lastMonth) {
      lastMonth = cur.getMonth();
      monthLabels.push(`<text x="${w * (cell+gap) + 22}" y="14" fill="#8a8f98" font-size="10">${cur.getMonth()+1}月</text>`);
    }
  }

  // 星期 label
  const dowLabels = [];
  ['', '一', '', '三', '', '五', ''].forEach((d, i) => {
    if (d) dowLabels.push(`<text x="0" y="${i*(cell+gap)+27}" fill="#8a8f98" font-size="9">${d}</text>`);
  });

  // 圖例
  const legendCells = colors.map(c => `<div class="heatmap-legend-cell" style="background:${c}"></div>`).join('');

  box.innerHTML = `<div class="heatmap-container">
    <svg class="heatmap-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      ${monthLabels.join('')}
      ${dowLabels.join('')}
      ${cells.join('')}
    </svg>
  </div>
  <div class="heatmap-legend">
    <span>少</span>${legendCells}<span>多</span>
  </div>`;
}

// ============== 月度業主彙整 ==============
function renderMonthlyReport() {
  const sel = document.getElementById('report-month');
  if (!sel) return;

  // 填月份選單
  const allMonths = [...new Set(state.jobs.map(j => jobBelongMonth(j)).filter(Boolean))].sort().reverse();
  if (!allMonths.length) allMonths.push(thisMonth());
  const cur = sel.value;
  sel.innerHTML = allMonths.map(m => `<option value="${m}">${m}</option>`).join('');
  sel.value = cur && allMonths.includes(cur) ? cur : (allMonths[0] || thisMonth());

  const month = sel.value;
  const monthJobs = activeJobs().filter(j => jobBelongMonth(j) === month);

  const box = document.getElementById('rev-monthly-report');
  if (!box) return;

  if (!monthJobs.length) {
    box.innerHTML = '<div class="empty" style="padding: 20px;"><div style="font-size: 13px;">該月份沒有資料</div></div>';
    return;
  }

  // 依業主彙整
  const byClient = {};
  monthJobs.forEach(j => {
    const c = getClient(j.clientId);
    const cid = j.clientId || 'unknown';
    if (!byClient[cid]) {
      byClient[cid] = {
        client: c, count: 0,
        gross: 0,        // 案件總額（未扣分潤）
        commission: 0,   // 給介紹人的部分
        net: 0,          // 實收
        paidNet: 0,      // 已收款（實收）
        unpaidNet: 0,    // 待收款（實收）
        pendingNet: 0    // 進行中（實收）
      };
    }
    const r = byClient[cid];
    r.count++;
    r.gross += +j.amount || 0;
    r.commission += jobCommission(j);
    r.net += jobNetAmount(j);
    if (j.paid) r.paidNet += jobNetAmount(j);
    else if (j.done) r.unpaidNet += jobNetAmount(j);
    else r.pendingNet += jobNetAmount(j);
  });

  const rows = Object.values(byClient).sort((a,b) => b.net - a.net);

  // 加總
  const totals = rows.reduce((acc, r) => {
    acc.count += r.count;
    acc.gross += r.gross;
    acc.commission += r.commission;
    acc.net += r.net;
    acc.paidNet += r.paidNet;
    acc.unpaidNet += r.unpaidNet;
    acc.pendingNet += r.pendingNet;
    return acc;
  }, { count: 0, gross: 0, commission: 0, net: 0, paidNet: 0, unpaidNet: 0, pendingNet: 0 });

  const showCommission = totals.commission > 0;

  box.innerHTML = `<div style="overflow-x: auto;">
    <table class="report-table">
      <thead>
        <tr>
          <th>業主</th>
          <th class="num">案件</th>
          <th class="num">原始金額</th>
          ${showCommission ? '<th class="num">分潤</th><th class="num">實收</th>' : ''}
          <th class="num">已收</th>
          <th class="num">待收</th>
          <th class="num">進行中</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const name = r.client ? r.client.name : '(已刪除)';
          const color = r.client ? r.client.color : '#ccc';
          return `<tr>
            <td><span class="dot" style="display:inline-block;background:${color};width:8px;height:8px;border-radius:50%;margin-right:6px;"></span>${escapeHtml(name)}</td>
            <td class="num">${r.count}</td>
            <td class="num">${fmt(r.gross)}</td>
            ${showCommission ? `<td class="num" style="color: var(--warning);">${r.commission ? '-'+fmt(r.commission) : '—'}</td><td class="num"><b>${fmt(r.net)}</b></td>` : ''}
            <td class="num" style="color: var(--success);">${fmt(r.paidNet)}</td>
            <td class="num" style="color: var(--warning);">${fmt(r.unpaidNet)}</td>
            <td class="num" style="color: var(--muted);">${fmt(r.pendingNet)}</td>
          </tr>`;
        }).join('')}
        <tr class="report-total">
          <td>合計</td>
          <td class="num">${totals.count}</td>
          <td class="num">${fmt(totals.gross)}</td>
          ${showCommission ? `<td class="num" style="color: var(--warning);">${totals.commission ? '-'+fmt(totals.commission) : '—'}</td><td class="num">${fmt(totals.net)}</td>` : ''}
          <td class="num" style="color: var(--success);">${fmt(totals.paidNet)}</td>
          <td class="num" style="color: var(--warning);">${fmt(totals.unpaidNet)}</td>
          <td class="num" style="color: var(--muted);">${fmt(totals.pendingNet)}</td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

function exportMonthlyReportCSV() {
  const sel = document.getElementById('report-month');
  if (!sel) return;
  const month = sel.value;
  const monthJobs = activeJobs().filter(j => jobBelongMonth(j) === month);

  if (!monthJobs.length) { toast('該月沒有資料'); return; }

  const headers = ['業主', '案件數', '原始金額', '分潤', '實收', '已收款', '待收款', '進行中'];

  // 依業主彙整
  const byClient = {};
  monthJobs.forEach(j => {
    const c = getClient(j.clientId);
    const cid = j.clientId || 'unknown';
    if (!byClient[cid]) byClient[cid] = { name: c?c.name:'(已刪除)', count: 0, gross: 0, commission: 0, net: 0, paid: 0, unpaid: 0, pending: 0 };
    const r = byClient[cid];
    r.count++;
    r.gross += +j.amount || 0;
    r.commission += jobCommission(j);
    r.net += jobNetAmount(j);
    if (j.paid) r.paid += jobNetAmount(j);
    else if (j.done) r.unpaid += jobNetAmount(j);
    else r.pending += jobNetAmount(j);
  });

  const rows = Object.values(byClient).sort((a,b) => b.net - a.net).map(r =>
    [r.name, r.count, r.gross, r.commission, r.net, r.paid, r.unpaid, r.pending]);

  const csv = '﻿' + [
    headers.join(','),
    ...rows.map(r => r.map(c => {
      const s = String(c);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `monthly-report-${month}.csv`;
  a.click();
  toast(`✓ 已匯出 ${month} 月度報表`);
}

// 暫存業主排行的案件 ID 清單，給點擊時跳轉用
let clientRankCache = {};

function renderClientRank(jobs, keysFilter) {
  const box = document.getElementById('rev-client-rank');
  if (!box) return;

  // 若有 keysFilter (非 all)，只計算在範圍內的 jobs
  let scoped = jobs;
  if (keysFilter) {
    scoped = jobs.filter(j => {
      if (!j.date) return false;
      const k = revenueState.mode === 'year' ? j.date.slice(0,4) : j.date.slice(0,7);
      return keysFilter.includes(k);
    });
  }

  const byClient = {};
  scoped.forEach(j => {
    const cid = j.clientId || 'unknown';
    if (!byClient[cid]) byClient[cid] = { paid: 0, unpaid: 0, pending: 0, count: 0, jobIds: [] };
    // v2.8.1: 用 finalAmount + paymentTotal
    const final = jobFinalAmount(j);
    const paid = jobPaidTotal(j);
    const unpaid = Math.max(0, final - paid - (+j.writeOff || 0));
    byClient[cid].paid += paid;
    if (j.done) byClient[cid].unpaid += unpaid;
    else byClient[cid].pending += unpaid;
    byClient[cid].count++;
    byClient[cid].jobIds.push(j.id);
  });

  const rows = Object.entries(byClient)
    .map(([cid, d]) => {
      const c = getClient(cid);
      return { ...d, total: d.paid + d.unpaid, cid, name: c ? c.name : '未指定', color: c ? c.color : '#ccc' };
    })
    .filter(r => r.total > 0)
    .sort((a,b) => b.total - a.total);

  // 暫存到 cache 讓點擊用
  clientRankCache = {};
  rows.forEach(r => { clientRankCache[r.cid] = { jobIds: r.jobIds, name: r.name, count: r.count }; });

  if (!rows.length) {
    box.innerHTML = emptyState('期間內沒有收益資料', '');
    return;
  }

  const maxTotal = rows[0].total;
  box.innerHTML = rows.map(r => {
    const paidPct = r.total ? r.paid / r.total * 100 : 0;
    const unpaidPct = r.total ? r.unpaid / r.total * 100 : 0;
    const barScale = r.total / maxTotal * 100;
    return `<div class="client-rank-row" onclick="clickClientRank('${r.cid}')" style="cursor: pointer;" title="點擊查看 ${r.count} 筆案件">
      <div class="dot" style="background:${r.color}; width: 10px; height: 10px;"></div>
      <div class="client-rank-info">
        <div class="client-rank-name">${escapeHtml(r.name)}<span style="color: var(--muted); font-size: 11px; font-weight: 400;">（${r.count} 筆）</span></div>
        <div class="client-rank-bar-box" style="width: ${barScale}%;">
          <div class="client-rank-bar-paid" style="width: ${paidPct}%;"></div>
          <div class="client-rank-bar-unpaid" style="width: ${unpaidPct}%;"></div>
        </div>
      </div>
      <div class="client-rank-amt">
        ${fmt(r.total)}
        ${r.unpaid ? `<div class="client-rank-amt-sub">（待收 ${fmt(r.unpaid)}）</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// 點業主排行 → 鎖定篩選那批案件 + 跳案件分頁
function clickClientRank(cid) {
  const cache = clientRankCache[cid];
  if (!cache) return;
  // 範圍標籤（描述當前 revenue 顯示的範圍）
  let rangeLabel = '當前範圍';
  const r = String(revenueState.range);
  if (r === 'all') rangeLabel = '全部';
  else if (r === 'ytd') rangeLabel = '今年至今';
  else if (r === 'custom') {
    rangeLabel = revenueState.mode === 'month' ? '自訂月份範圍' : '自訂年份範圍';
  } else if (revenueState.mode === 'year') {
    rangeLabel = `最近 ${r} 年`;
  } else {
    rangeLabel = `最近 ${r} 個月`;
  }
  lockJobsToIds(cache.jobIds, `${cache.name} · ${rangeLabel}（${cache.count} 筆）`);
  switchTab('jobs');
}

// ============== Modal 內子任務（v2.6）==============
let modalSubtasks = [];

function renderJobSubtasks() {
  const list = document.getElementById('job-subtasks-list');
  const counter = document.getElementById('job-subtasks-counter');
  if (!list) return;
  if (!modalSubtasks.length) {
    list.innerHTML = '<div style="font-size: 12px; color: var(--muted); padding: 4px 0;">尚無子任務</div>';
    if (counter) counter.textContent = '';
    return;
  }
  const done = modalSubtasks.filter(s => s.done).length;
  if (counter) counter.textContent = `（${done}/${modalSubtasks.length}）`;
  list.innerHTML = modalSubtasks.map((s, i) => `
    <div style="display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 13px;">
      <input type="checkbox" ${s.done?'checked':''} onchange="toggleJobSubtask(${i})" style="width:auto; margin:0;">
      <span style="flex:1; ${s.done?'text-decoration:line-through; color:var(--muted);':''}">${escapeHtml(s.text)}</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="removeJobSubtask(${i})" style="color:var(--danger); padding:2px 6px;">✕</button>
    </div>
  `).join('');
}

function addJobSubtask() {
  const inp = document.getElementById('job-subtask-input');
  const text = (inp?.value || '').trim();
  if (!text) return;
  modalSubtasks.push({ id: uid(), text, done: false });
  inp.value = '';
  renderJobSubtasks();
  setTimeout(() => inp.focus(), 50);
}

function toggleJobSubtask(i) {
  if (modalSubtasks[i]) {
    modalSubtasks[i].done = !modalSubtasks[i].done;
    renderJobSubtasks();
  }
}

function removeJobSubtask(i) {
  modalSubtasks.splice(i, 1);
  renderJobSubtasks();
}

// ============== Modal 內計時器（v2.6）==============
let modalTimerStart = 0;     // 當前 session 開始的 timestamp（0 = 未在計時）
let modalTimerBaseMs = 0;    // 之前累積的毫秒（從 job 載入）
let modalTimerInterval = null;

function fmtTimerMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getCurrentTimerMs() {
  const sessionMs = modalTimerStart ? (Date.now() - modalTimerStart) : 0;
  return modalTimerBaseMs + sessionMs;
}

function refreshTimerDisplay() {
  const el = document.getElementById('job-timer-display');
  if (el) el.textContent = fmtTimerMs(getCurrentTimerMs());
}

function loadJobTimer(timeSpentMs) {
  modalTimerBaseMs = +timeSpentMs || 0;
  modalTimerStart = 0;
  refreshTimerDisplay();
  const btn = document.getElementById('job-timer-toggle');
  if (btn) btn.innerHTML = '▶ 開始';
}

function toggleJobTimer() {
  const btn = document.getElementById('job-timer-toggle');
  if (modalTimerStart) {
    // 暫停 → 把 session 累計到 base
    modalTimerBaseMs += Date.now() - modalTimerStart;
    modalTimerStart = 0;
    if (modalTimerInterval) { clearInterval(modalTimerInterval); modalTimerInterval = null; }
    if (btn) btn.innerHTML = '▶ 繼續';
  } else {
    // 開始
    modalTimerStart = Date.now();
    modalTimerInterval = setInterval(refreshTimerDisplay, 500);
    if (btn) btn.innerHTML = '⏸ 暫停';
  }
}

function resetJobTimer() {
  if (modalTimerStart || modalTimerBaseMs > 0) {
    if (!confirm('確定清空計時器？此案件累計工時會歸零。')) return;
  }
  modalTimerStart = 0;
  modalTimerBaseMs = 0;
  if (modalTimerInterval) { clearInterval(modalTimerInterval); modalTimerInterval = null; }
  refreshTimerDisplay();
  const btn = document.getElementById('job-timer-toggle');
  if (btn) btn.innerHTML = '▶ 開始';
}

function finishJobTimer() {
  // 暫停 + 把累計時間加到工時欄
  if (modalTimerStart) toggleJobTimer();
  const ms = getCurrentTimerMs();
  if (ms <= 0) { toast('還沒開始計時'); return; }
  const hours = +(ms / 3600000).toFixed(2);
  const inp = document.getElementById('job-hours');
  if (inp) {
    const existing = +inp.value || 0;
    inp.value = (existing + hours).toFixed(2);
    updateJobHourlyHint();
  }
  toast(`✓ 已加 ${hours} 小時到工時欄`);
}

function stopJobTimerOnClose() {
  // Modal 關閉時記錄當前計時狀態（不清除 base，因為要儲存）
  if (modalTimerStart) {
    modalTimerBaseMs += Date.now() - modalTimerStart;
    modalTimerStart = 0;
  }
  if (modalTimerInterval) { clearInterval(modalTimerInterval); modalTimerInterval = null; }
}

// ============== 估價單（v2.6）==============
async function exportSingleJobPDF() {
  if (!editingJobId) { toast('請先儲存後再匯出'); return; }
  const j = state.jobs.find(x => x.id === editingJobId);
  if (!j) return;
  const c = getClient(j.clientId);
  // 用 invoice-view 同樣的 HTML 結構臨時生成
  const tempBox = document.createElement('div');
  tempBox.style.cssText = 'position: fixed; left: -10000px; top: 0; width: 700px; padding: 30px; background: white; color: black; font-family: -apple-system, "PingFang TC", sans-serif;';
  const userName = config.userInfo?.name || '';
  const tag = j.isEstimate ? '估價單' : '請款單（單筆）';
  tempBox.innerHTML = `
    <h1 style="font-size: 24px; margin-bottom: 8px; color: black;">${tag}</h1>
    <div style="font-size: 13px; color: #666; margin-bottom: 16px;">
      製單日期：${todayStr()}　${j.isEstimate ? '估價有效期：14 天' : ''}
    </div>
    <div style="border: 1px solid #ddd; padding: 12px; border-radius: 8px; margin-bottom: 16px; color: black;">
      <div style="margin-bottom: 8px;"><b>業主：</b>${escapeHtml(c?.name || '?')}</div>
      <div style="margin-bottom: 8px;"><b>${j.isEstimate ? '預計執行日期' : '案件日期'}：</b>${j.date || '-'}${j.endDate ? ' ~ ' + j.endDate : ''}</div>
      <div style="margin-bottom: 8px;"><b>案件名稱：</b>${escapeHtml(j.title || '')}</div>
      ${j.tag ? `<div style="margin-bottom: 8px;"><b>類型：</b>${escapeHtml(j.tag)}</div>` : ''}
      ${j.details ? `<div style="margin-bottom: 8px;"><b>說明：</b><br><span style="white-space: pre-wrap;">${escapeHtml(j.details)}</span></div>` : ''}
    </div>
    <div style="background: #f7f7f7; padding: 12px; border-radius: 8px; text-align: right; color: black;">
      <div style="font-size: 13px; color: #666;">${j.isEstimate ? '估價金額' : '應收金額'}</div>
      <div style="font-size: 28px; font-weight: 700;">NT$ ${(+j.amount||0).toLocaleString()}</div>
    </div>
    ${userName ? `<div style="margin-top: 24px; font-size: 12px; color: #666; border-top: 1px solid #ddd; padding-top: 12px; color: black;">
      <b>承製方：</b>${escapeHtml(userName)}
      ${(() => {
        // v2.10.13: 用選中的收款帳號取代舊 bankInfo
        // v2.10.15: 戶名 + 存摺照片
        const a = getActivePaymentAccount();
        if (!a) return '';
        const parts = [];
        if (a.bank) parts.push(a.bank);
        if (a.account) parts.push(a.account);
        if (a.holderName) parts.push('戶名 ' + a.holderName);
        const text = parts.length ? `<br>${escapeHtml(parts.join(' / '))}` : '';
        const img = a.bankbookImage ? `<div style="margin-top: 8px;"><img src="${a.bankbookImage}" alt="存摺" style="max-width: 240px; max-height: 140px; border-radius: 4px; border: 1px solid #ddd;"></div>` : '';
        return text + img;
      })()}
    </div>` : ''}
  `;
  document.body.appendChild(tempBox);
  try {
    toastProgress('🎨 渲染中...');
    await loadScript(HTML2CANVAS_CDN);
    const canvas = await html2canvas(tempBox, { scale: 2, backgroundColor: '#ffffff' });
    await loadScript(JSPDF_CDN);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const margin = 8;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, imgW, imgH);
    pdf.save(`${tag}_${c?.name || '案件'}_${todayStr()}.pdf`);
    toast('✓ 已下載 PDF');
  } catch (err) {
    toast('匯出失敗：' + err.message);
  } finally {
    tempBox.remove();
  }
}

function confirmEstimateAsJob() {
  if (!editingJobId) return;
  if (!confirm('確認接案？\n\n會把這張估價單轉成正式案件，計入收益統計。')) return;
  const j = state.jobs.find(x => x.id === editingJobId);
  if (!j) return;
  j.isEstimate = false;
  save();
  toast('✓ 已轉為正式案件');
  closeJobModal();
  render();
}

// ============== iCal 訂閱（v2.5）==============
function getIcalUrl() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) return null;
  return cfg.apiUrl + '?action=ical&token=' + encodeURIComponent(cfg.apiToken);
}

async function copyIcalUrl() {
  const url = getIcalUrl();
  if (!url) { toast('請先設定雲端同步'); return; }
  try {
    await navigator.clipboard.writeText(url);
    toast('✓ 已複製訂閱連結到剪貼簿', 4000);
  } catch (err) {
    // fallback
    prompt('複製此連結（Ctrl+C / Cmd+C）：', url);
  }
}

function showIcalHelp() {
  const url = getIcalUrl();
  const msg = [
    '📅 將案件截止日加入行事曆',
    '',
    '【Google Calendar (網頁)】',
    '1. 左側「其他日曆」旁的 + 號',
    '2. 選「以網址加入」',
    '3. 貼上訂閱連結 → 加入',
    '',
    '【iPhone / iPad】',
    '1. 設定 → 行事曆 → 帳號 → 新增帳號',
    '2. 其他 → 新增訂閱式行事曆',
    '3. 伺服器：貼上訂閱連結',
    '',
    '【macOS 行事曆】',
    '1. 檔案 → 新增行事曆訂閱',
    '2. 貼上連結',
    '',
    '訂閱後行事曆會每 15-60 分鐘自動更新（依 APP 而定）。',
    '截止日會顯示為全天事件，提前 1 天有提醒。'
  ].join('\n');
  alert(msg);
}

// ============== 瀏覽器原生通知（v2.5）==============
const NOTIF_ENABLED_KEY = 'ftNotifEnabled_v1';
const NOTIF_LAST_FIRED_KEY = 'ftNotifLastFired_v1';

function notifSupported() {
  return 'Notification' in window;
}

async function requestNotifPermission() {
  if (!notifSupported()) { toast('此瀏覽器不支援通知'); return; }
  if (Notification.permission === 'granted') {
    localStorage.setItem(NOTIF_ENABLED_KEY, '1');
    toast('✓ 通知已啟用');
    sendTestNotification();
    updateNotifUI();
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    localStorage.setItem(NOTIF_ENABLED_KEY, '1');
    toast('✓ 通知已啟用');
    sendTestNotification();
  } else if (perm === 'denied') {
    toast('❌ 已拒絕。要重新啟用須到瀏覽器設定打開', 5000);
  }
  updateNotifUI();
}

function disableNotif() {
  localStorage.setItem(NOTIF_ENABLED_KEY, '0');
  toast('已停用通知');
  updateNotifUI();
}

function isNotifEnabled() {
  return notifSupported() &&
         Notification.permission === 'granted' &&
         localStorage.getItem(NOTIF_ENABLED_KEY) === '1';
}

function sendTestNotification() {
  if (!isNotifEnabled()) return;
  new Notification('外包收益管理', {
    body: '✓ 通知已啟用！截止日、拖款警告會即時跳出。',
    icon: 'icons/icon.svg',
    tag: 'ftracker-test'
  });
}

// 開頁時掃一次：把 alert 推成系統通知（一天一次，避免狂跳）
function maybeFireNotifications() {
  if (!isNotifEnabled()) return;
  const today = todayStr();
  const lastFired = localStorage.getItem(NOTIF_LAST_FIRED_KEY);
  if (lastFired === today) return;  // 今天已通知過
  const alerts = computeAlerts();
  const important = alerts.filter(a => ['overdue', 'due-soon', 'unpaid-long', 'slow-pay'].includes(a.type));
  if (!important.length) return;
  // 統整成一則
  const top = important[0];
  const more = important.length > 1 ? `（還有 ${important.length - 1} 項）` : '';
  const body = important.map(a => `${a.icon} ${a.title}`).join('\n').slice(0, 200);
  const n = new Notification(top.title + more, {
    body,
    icon: 'icons/icon.svg',
    tag: 'ftracker-daily',
    requireInteraction: false
  });
  n.onclick = () => {
    window.focus();
    switchTab('dashboard');
    n.close();
  };
  localStorage.setItem(NOTIF_LAST_FIRED_KEY, today);
}

function updateNotifUI() {
  const status = document.getElementById('notif-status');
  const enableBtn = document.getElementById('notif-enable-btn');
  const disableBtn = document.getElementById('notif-disable-btn');
  if (!status) return;
  if (!notifSupported()) {
    status.textContent = '❌ 此瀏覽器不支援';
    if (enableBtn) enableBtn.disabled = true;
  } else if (Notification.permission === 'denied') {
    status.textContent = '🚫 已被瀏覽器拒絕（要從瀏覽器設定重新允許）';
  } else if (isNotifEnabled()) {
    status.textContent = '✅ 已啟用';
    enableBtn?.classList.add('hidden');
    disableBtn?.classList.remove('hidden');
  } else {
    status.textContent = '⏸ 未啟用';
    enableBtn?.classList.remove('hidden');
    disableBtn?.classList.add('hidden');
  }
}

// ============== 雲端容量監控 ==============
async function showCloudCapacity() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) { toast('請先設定雲端同步'); return; }
  toastProgress('📊 計算容量中...');
  try {
    const url = cfg.apiUrl + '?action=listSnapshots&token=' + encodeURIComponent(cfg.apiToken);
    const resp = await fetch(url);
    const data = await resp.json();
    toastDismiss();
    if (!data.ok) { toast('讀取失敗'); return; }
    const snaps = data.snapshots || [];
    const totalBytes = snaps.reduce((s, x) => s + (x.dataSize || 0), 0);
    const totalKB = Math.round(totalBytes / 1024);
    const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
    // 估算當前資料 size
    const currentJson = JSON.stringify({ clients: state.clients, jobs: state.jobs });
    const currentKB = Math.round(currentJson.length / 1024);

    // 分層統計
    const byTier = {};
    snaps.forEach(s => { byTier[s.tier] = (byTier[s.tier] || 0) + 1; });
    const tierLabels = { force: '🔒 每日強制', manual: '✋ 手動', restore: '↩️ 還原前', auto: '⚙️ 自動', legacy: '📦 舊版' };
    const tierLines = Object.entries(byTier).map(([k, v]) => `  ${tierLabels[k] || k}: ${v} 份`).join('\n');

    // Sheet 限制：單儲存格 50K 字元，整 sheet 1000 萬儲存格（基本不會撞到）
    const maxSnapshotSize = 4 * 45000;  // 4 columns * 45K
    const usagePct = Math.round(currentJson.length / maxSnapshotSize * 100);

    const msg = [
      `📊 雲端 Sheet 容量現況`,
      ``,
      `本地資料大小：約 ${currentKB} KB`,
      `每筆 snapshot 上限：180 KB（4 欄拆分）`,
      `當前資料佔上限 ${usagePct}% ${usagePct > 80 ? '⚠️ 接近上限' : '✓'}`,
      ``,
      `Snapshot 總數：${snaps.length} 份`,
      `Snapshot 總大小：${totalKB} KB（${totalMB} MB）`,
      ``,
      `分層分佈：`,
      tierLines,
      ``,
      `Google Sheet 整體上限：1000 萬儲存格（基本不會用到 1%）`
    ].join('\n');
    toastDismiss();
    alert(msg);
  } catch (err) {
    toastDismiss();
    toast('錯誤：' + err.message);
  }
}

// ============== 模糊比對（v2.7）==============
// Levenshtein 距離（標準化到 0-1，1 = 完全一樣）
function similarity(a, b) {
  a = String(a || '').toLowerCase().trim();
  b = String(b || '').toLowerCase().trim();
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  // 簡化版 Levenshtein
  const len1 = a.length, len2 = b.length;
  const dp = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1];
      else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return 1 - dp[len1][len2] / Math.max(len1, len2);
}

// 找出可能重複的業主
function findFuzzyDupClients(threshold = 0.75) {
  const cs = state.clients;
  const dupes = [];
  const seen = new Set();
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      const s = similarity(a.name, b.name);
      if (s >= threshold && s < 1) {  // 完全一樣的另外處理
        const key = [a.id, b.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        dupes.push({ a, b, similarity: +s.toFixed(2) });
      }
    }
  }
  return dupes.sort((x, y) => y.similarity - x.similarity);
}

// 找出可能重複的案件（同業主、同月、相似標題）
function findFuzzyDupJobs(threshold = 0.85) {
  const jobs = state.jobs.filter(j => !j.cancelled && !j.isEstimate);
  // 按 業主+月份 分組
  const groups = {};
  jobs.forEach(j => {
    const key = j.clientId + '|' + (j.date || '').slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(j);
  });
  const dupes = [];
  Object.values(groups).forEach(group => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const s = similarity(a.title, b.title);
        if (s >= threshold) {
          dupes.push({ a, b, similarity: +s.toFixed(2) });
        }
      }
    }
  });
  return dupes.sort((x, y) => y.similarity - x.similarity);
}

// ============== 資料健檢 ==============
function runDataHealthCheck() {
  const results = [];
  const clientIds = new Set(state.clients.map(c => c.id));
  const clientNameLower = {};

  // 1. 孤兒案件（clientId 不存在）
  const orphans = state.jobs.filter(j => !clientIds.has(j.clientId));
  if (orphans.length) {
    results.push({
      severity: 'error',
      title: `${orphans.length} 筆孤兒案件`,
      desc: 'clientId 對應不到任何業主（可能是業主被刪除）',
      jobIds: orphans.map(j => j.id),
      action: { label: '查看這些案件', fn: () => { lockJobsToIds(orphans.map(j=>j.id), `🔧 孤兒案件（${orphans.length} 筆）`); switchTab('jobs'); } }
    });
  }

  // 2. 重複業主名（同名）
  const nameCount = {};
  state.clients.forEach(c => {
    const k = (c.name || '').trim().toLowerCase();
    if (!k) return;
    nameCount[k] = (nameCount[k] || 0) + 1;
    clientNameLower[k] = clientNameLower[k] || [];
    clientNameLower[k].push(c);
  });
  const dupes = Object.keys(nameCount).filter(k => nameCount[k] > 1);
  if (dupes.length) {
    const samples = dupes.slice(0, 3).map(k => clientNameLower[k][0].name).join('、');
    results.push({
      severity: 'warn',
      title: `${dupes.length} 個業主名重複`,
      desc: `例：${samples}${dupes.length > 3 ? '…' : ''}`
    });
  }

  // 3. 異常金額（>= 10 倍中位數，或 = 0）
  const amounts = state.jobs.filter(j => !j.cancelled).map(j => +j.amount || 0).filter(n => n > 0).sort((a,b) => a-b);
  if (amounts.length > 5) {
    const median = amounts[Math.floor(amounts.length / 2)];
    const outliers = state.jobs.filter(j => !j.cancelled && (+j.amount || 0) >= median * 10);
    if (outliers.length) {
      results.push({
        severity: 'info',
        title: `${outliers.length} 筆金額異常高`,
        desc: `中位數 ${fmt(median)}，這幾筆 >= 中位數 10 倍`,
        jobIds: outliers.map(j => j.id),
        action: { label: '查看', fn: () => { lockJobsToIds(outliers.map(j=>j.id), `🔧 金額異常（${outliers.length} 筆）`); switchTab('jobs'); } }
      });
    }
  }

  // 4. 缺日期 / 缺金額 / 缺標題
  const missingDate = state.jobs.filter(j => !j.cancelled && !j.date);
  const missingAmount = state.jobs.filter(j => !j.cancelled && !(+j.amount));
  const missingTitle = state.jobs.filter(j => !(j.title || '').trim());
  if (missingDate.length) {
    results.push({ severity: 'warn', title: `${missingDate.length} 筆案件沒有日期`, desc: '可能影響月份統計', jobIds: missingDate.map(j=>j.id),
      action: { label: '查看', fn: () => { lockJobsToIds(missingDate.map(j=>j.id), `🔧 缺日期（${missingDate.length} 筆）`); switchTab('jobs'); } } });
  }
  if (missingAmount.length) {
    results.push({ severity: 'warn', title: `${missingAmount.length} 筆案件沒有金額`, desc: '會被視為 0', jobIds: missingAmount.map(j=>j.id),
      action: { label: '查看', fn: () => { lockJobsToIds(missingAmount.map(j=>j.id), `🔧 缺金額（${missingAmount.length} 筆）`); switchTab('jobs'); } } });
  }
  if (missingTitle.length) {
    results.push({ severity: 'info', title: `${missingTitle.length} 筆案件沒有標題`, desc: '建議補上方便辨識', jobIds: missingTitle.map(j=>j.id),
      action: { label: '查看', fn: () => { lockJobsToIds(missingTitle.map(j=>j.id), `🔧 缺標題（${missingTitle.length} 筆）`); switchTab('jobs'); } } });
  }

  // 5. doneAt > paidAt（時序錯亂）
  const reversed = state.jobs.filter(j => j.doneAt && j.paidAt && j.paidAt < j.doneAt);
  if (reversed.length) {
    results.push({ severity: 'warn', title: `${reversed.length} 筆收款日期早於完成日期`, desc: '時序可能填錯', jobIds: reversed.map(j=>j.id),
      action: { label: '查看', fn: () => { lockJobsToIds(reversed.map(j=>j.id), `🔧 時序錯亂（${reversed.length} 筆）`); switchTab('jobs'); } } });
  }

  // 6. 過大資料（單筆 details > 5000 字）
  const tooLarge = state.jobs.filter(j => (j.details || '').length > 5000);
  if (tooLarge.length) {
    results.push({ severity: 'info', title: `${tooLarge.length} 筆案件 details 過長 (>5000 字)`, desc: '建議精簡' });
  }

  // 7. v2.7: 模糊重複業主名（不完全相同但很相似）
  const fuzzyClients = findFuzzyDupClients(0.75);
  if (fuzzyClients.length) {
    const samples = fuzzyClients.slice(0, 3).map(d => `${d.a.name} ↔ ${d.b.name} (${Math.round(d.similarity * 100)}%)`).join('\n');
    results.push({
      severity: 'info',
      title: `${fuzzyClients.length} 組業主名相似可能重複`,
      desc: samples + (fuzzyClients.length > 3 ? '\n…' : ''),
    });
  }

  // 8. v2.7: 同月同業主相似標題的案件（可能重複）
  const fuzzyJobs = findFuzzyDupJobs(0.85);
  if (fuzzyJobs.length) {
    const ids = new Set();
    fuzzyJobs.forEach(d => { ids.add(d.a.id); ids.add(d.b.id); });
    const samples = fuzzyJobs.slice(0, 3).map(d => `${d.a.title || '?'} ↔ ${d.b.title || '?'} (${Math.round(d.similarity * 100)}%)`).join('\n');
    results.push({
      severity: 'info',
      title: `${fuzzyJobs.length} 組案件可能重複（同業主、同月、相似標題）`,
      desc: samples + (fuzzyJobs.length > 3 ? '\n…' : ''),
      jobIds: Array.from(ids),
      action: { label: '查看', fn: () => { lockJobsToIds(Array.from(ids), `🔧 可能重複的案件（${fuzzyJobs.length} 組）`); switchTab('jobs'); } }
    });
  }

  return results;
}

let _healthCheckResults = [];

function showHealthCheckModal() {
  _healthCheckResults = runDataHealthCheck();
  const box = document.getElementById('health-check-result');
  if (!box) return;
  if (!_healthCheckResults.length) {
    box.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--success); font-size: 16px;">✅ 所有資料看起來都很正常！</div>';
  } else {
    const colorMap = { error: 'var(--danger)', warn: 'var(--warning)', info: 'var(--muted)' };
    const iconMap = { error: '🔴', warn: '🟡', info: 'ℹ️' };
    box.innerHTML = _healthCheckResults.map((r, i) => `
      <div style="padding: 10px; border-radius: 8px; background: var(--bg); margin-bottom: 8px; border-left: 3px solid ${colorMap[r.severity]};">
        <div style="font-weight: 600; font-size: 14px;">${iconMap[r.severity]} ${escapeHtml(r.title)}</div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px; white-space: pre-line;">${escapeHtml(r.desc)}</div>
        ${r.action ? `<button class="btn btn-outline btn-sm" style="margin-top: 6px;" onclick="runHealthAction(${i})">${escapeHtml(r.action.label)}</button>` : ''}
      </div>
    `).join('');
  }
  document.getElementById('health-modal').classList.add('open');
}

function runHealthAction(i) {
  const r = _healthCheckResults[i];
  if (r?.action?.fn) {
    r.action.fn();
    document.getElementById('health-modal').classList.remove('open');
  }
}

// ============== 範本系統（案件描述常用片語）==============
const TEMPLATES_KEY = 'ftJobTemplates_v1';

function getTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]'); }
  catch (_) { return []; }
}
function setTemplates(arr) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(arr));
}

function openTemplatePicker() {
  const box = document.getElementById('template-picker');
  if (!box) return;
  if (!box.classList.contains('hidden')) {
    box.classList.add('hidden');
    return;
  }
  const list = getTemplates();
  if (!list.length) {
    box.innerHTML = '<div style="font-size: 12px; color: var(--muted); padding: 8px; text-align: center;">尚無範本，先在文字框打字後按「💾 存範本」儲存</div>';
  } else {
    box.innerHTML = list.map((t, i) => `
      <div style="display: flex; gap: 6px; align-items: flex-start; padding: 6px; border-bottom: 1px solid var(--border);">
        <div style="flex: 1; font-size: 13px; cursor: pointer; white-space: pre-wrap;" onclick="useTemplate(${i})">${escapeHtml(t.length > 80 ? t.slice(0, 80) + '…' : t)}</div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="deleteTemplate(${i})" style="color: var(--danger); padding: 2px 6px;">✕</button>
      </div>
    `).join('');
  }
  box.classList.remove('hidden');
}

function useTemplate(i) {
  const list = getTemplates();
  const t = list[i];
  if (!t) return;
  const ta = document.getElementById('job-details');
  if (!ta) return;
  // 如果已有內容 → 在後面接上；空的就直接帶入
  ta.value = ta.value.trim() ? (ta.value + '\n' + t) : t;
  document.getElementById('template-picker')?.classList.add('hidden');
  toast('✓ 已帶入範本');
}

function deleteTemplate(i) {
  const list = getTemplates();
  list.splice(i, 1);
  setTemplates(list);
  openTemplatePicker();  // 重畫
  // 再開一次（toggle 邏輯有點繞，直接強制顯示）
  document.getElementById('template-picker')?.classList.remove('hidden');
  toast('已刪除範本');
}

function saveCurrentAsTemplate() {
  const ta = document.getElementById('job-details');
  const text = ta?.value?.trim() || '';
  if (!text) { toast('文字框是空的'); return; }
  if (text.length < 5) { toast('範本內容太短（至少 5 字）'); return; }
  const list = getTemplates();
  if (list.includes(text)) { toast('已有相同範本'); return; }
  list.unshift(text);  // 新範本放最前
  if (list.length > 30) list.length = 30;  // 最多 30 個
  setTemplates(list);
  toast(`✓ 已存範本（共 ${list.length} 個）`, 3000);
}

// ============== Invoice 匯出（PDF / 圖片）==============
const HTML2CANVAS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

function getInvoiceFilename(ext) {
  const sel = document.getElementById('inv-client');
  const c = state.clients.find(x => x.id === sel?.value);
  const cname = c ? c.name : 'invoice';
  const m = document.getElementById('inv-month')?.value || '';
  const mEnd = document.getElementById('inv-month-end')?.value || '';
  const range = (mEnd && mEnd !== m) ? `${m}_${mEnd}` : m;
  return `請款單_${cname}_${range}.${ext}`.replace(/\s+/g, '');
}

async function captureInvoiceCanvas() {
  const view = document.getElementById('invoice-view');
  if (!view || !view.innerHTML.trim()) {
    toast('請先選擇業主與月份');
    return null;
  }
  toastProgress('🎨 渲染中...');
  await loadScript(HTML2CANVAS_CDN);
  // 用較高 scale 提升解析度（不會太糊）
  const canvas = await html2canvas(view, {
    scale: 2,
    backgroundColor: getComputedStyle(document.body).getPropertyValue('--card').trim() || '#ffffff',
    useCORS: true,
    logging: false
  });
  return canvas;
}

async function exportInvoicePNG() {
  try {
    const canvas = await captureInvoiceCanvas();
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = getInvoiceFilename('png');
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('✓ 已下載圖片');
  } catch (err) {
    toastDismiss();
    toast('匯出失敗：' + err.message);
  }
}

// v2.10.3：直接把請款單圖片複製到剪貼簿，使用者可貼到 LINE / Messenger / Email
async function copyInvoiceImage() {
  try {
    const canvas = await captureInvoiceCanvas();
    if (!canvas) return;
    // Canvas → Blob → ClipboardItem
    canvas.toBlob(async (blob) => {
      if (!blob) { toastDismiss(); toast('產生圖片失敗'); return; }
      try {
        if (!navigator.clipboard || !window.ClipboardItem) {
          toastDismiss();
          alert('此瀏覽器不支援複製圖片到剪貼簿，請改用「下載圖片」按鈕。\n\n（建議瀏覽器：Chrome / Edge / Safari 最新版）');
          return;
        }
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        toastDismiss();
        toast('✓ 已複製，可直接貼到 LINE / Messenger / Email');
        logAction('invoice-copy', { summary: '複製請款單到剪貼簿' });
      } catch (err) {
        toastDismiss();
        // 常見原因：頁面沒有 focus、HTTPS 限制等
        if (String(err).includes('NotAllowedError') || String(err).includes('Document is not focused')) {
          alert('複製失敗：請先點一下頁面任何地方再試（瀏覽器要求頁面在前景才允許複製）。');
        } else {
          alert('複製失敗：' + err.message + '\n\n你的瀏覽器可能不支援，請改用「下載圖片」。');
        }
      }
    }, 'image/png');
  } catch (err) {
    toastDismiss();
    toast('匯出失敗：' + err.message);
  }
}

async function exportInvoicePDF() {
  try {
    const canvas = await captureInvoiceCanvas();
    if (!canvas) return;
    toastProgress('📄 產生 PDF...');
    await loadScript(JSPDF_CDN);
    const { jsPDF } = window.jspdf;

    // A4 尺寸：210mm × 297mm；用 mm 為單位
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();   // 210
    const pageH = pdf.internal.pageSize.getHeight();  // 297
    const margin = 8;
    const usableW = pageW - margin * 2;

    const imgW = usableW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL('image/png');

    // 內容比一頁長 → 分頁
    if (imgH <= pageH - margin * 2) {
      pdf.addImage(imgData, 'PNG', margin, margin, imgW, imgH);
    } else {
      // 把整張圖切成多頁
      let position = margin;
      let heightLeft = imgH;
      pdf.addImage(imgData, 'PNG', margin, position, imgW, imgH);
      heightLeft -= (pageH - margin * 2);
      while (heightLeft > 0) {
        position = heightLeft - imgH + margin;  // 負位移把上半部推到頁面外
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, position, imgW, imgH);
        heightLeft -= (pageH - margin * 2);
      }
    }
    pdf.save(getInvoiceFilename('pdf'));
    toast('✓ 已下載 PDF');
  } catch (err) {
    toast('匯出失敗：' + err.message);
  }
}

// ============== v2.9: 收款時間軸 ==============
function renderPaymentTimeline() {
  const box = document.getElementById('rev-payment-timeline');
  if (!box) return;
  // 收集所有 payment（按月分組）
  const byMonth = {};
  activeJobs().forEach(j => {
    (j.payments || []).forEach(p => {
      if (!p.date) return;
      const m = p.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { total: 0, count: 0, byClient: {} };
      byMonth[m].total += +p.amount || 0;
      byMonth[m].count++;
      const c = getClient(j.clientId);
      const cname = c?.name || '?';
      byMonth[m].byClient[cname] = (byMonth[m].byClient[cname] || 0) + (+p.amount || 0);
    });
  });

  // 取最近 12 個月（含空月）
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  const max = Math.max(...months.map(m => byMonth[m]?.total || 0), 1);
  if (max === 1) {
    box.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--muted); font-size: 13px;">最近 12 個月還沒有收款紀錄</div>';
    return;
  }

  const total = months.reduce((s,m) => s + (byMonth[m]?.total || 0), 0);
  const avgMonthly = Math.round(total / months.filter(m => byMonth[m]?.total > 0).length || 1);

  const bars = months.map(m => {
    const data = byMonth[m] || { total: 0, count: 0 };
    const h = data.total > 0 ? Math.max(8, (data.total / max) * 140) : 4;
    const isCurrent = m === months[months.length - 1];
    const yymm = m.slice(2);  // 26-04
    return `<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;" title="${m}：${fmt(data.total)} (${data.count} 筆)">
      <div style="font-size: 10px; color: var(--muted);">${data.total>0 ? Math.round(data.total/1000)+'k' : ''}</div>
      <div style="height: ${h}px; width: 70%; background: ${isCurrent?'var(--primary)':'var(--success)'}; border-radius: 3px; opacity: ${data.total>0?1:0.3};"></div>
      <div style="font-size: 10px; color: var(--muted); white-space: nowrap;">${yymm}</div>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 12px;">
      <div style="background: var(--bg); padding: 10px; border-radius: 8px;">
        <div style="font-size: 11px; color: var(--muted);">12 個月總入帳</div>
        <div style="font-size: 18px; font-weight: 700; color: var(--success);">${fmt(total)}</div>
      </div>
      <div style="background: var(--bg); padding: 10px; border-radius: 8px;">
        <div style="font-size: 11px; color: var(--muted);">月平均（有入帳的月份）</div>
        <div style="font-size: 18px; font-weight: 700;">${fmt(avgMonthly)}</div>
      </div>
    </div>
    <div style="display: flex; gap: 4px; align-items: flex-end; height: 170px;">${bars}</div>
  `;
}

// ============== v2.7: 忙閒週期分析 ==============
function renderBusyCycle() {
  const box = document.getElementById('rev-busy-cycle');
  if (!box) return;
  const jobs = activeJobs().filter(j => j.date);
  if (jobs.length < 5) {
    box.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--muted); font-size: 13px;">資料量不足（至少 5 筆有日期的案件）</div>';
    return;
  }

  // 月份分布（1-12 月）
  const byMonth = Array(12).fill(0);
  const byMonthAmt = Array(12).fill(0);
  // 週幾分布（0=週日 ~ 6=週六）
  const byDow = Array(7).fill(0);
  const byDowAmt = Array(7).fill(0);

  jobs.forEach(j => {
    const d = new Date(j.date);
    if (isNaN(d)) return;
    const m = d.getMonth();
    const dow = d.getDay();
    byMonth[m]++;
    byDow[dow]++;
    const amt = +j.amount || 0;
    byMonthAmt[m] += amt;
    byDowAmt[dow] += amt;
  });

  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const dowNames = ['週日','週一','週二','週三','週四','週五','週六'];
  const maxMonth = Math.max(...byMonth, 1);
  const maxDow = Math.max(...byDow, 1);

  // 找出最忙月與最忙日
  const peakMonthIdx = byMonth.indexOf(Math.max(...byMonth));
  const slackMonthIdx = byMonth.indexOf(Math.min(...byMonth.filter(v => v > 0).length ? byMonth.map((v,i) => v === 0 ? Infinity : v) : byMonth));
  const peakDowIdx = byDow.indexOf(Math.max(...byDow));

  const monthBars = monthNames.map((n, i) => {
    const h = Math.max(4, (byMonth[i] / maxMonth) * 100);
    const isPeak = i === peakMonthIdx && byMonth[i] > 0;
    return `<div style="flex:1; display:flex; flex-direction: column; align-items: center; gap: 2px;">
      <div style="font-size: 10px; color: var(--muted);">${byMonth[i] || ''}</div>
      <div style="height: ${h}px; width: 80%; background: ${isPeak ? 'var(--primary)' : 'var(--primary-light)'}; border-radius: 3px;"></div>
      <div style="font-size: 11px; color: ${isPeak ? 'var(--primary)' : 'var(--text)'}; font-weight: ${isPeak?'600':'400'};">${n}</div>
    </div>`;
  }).join('');

  const dowBars = dowNames.map((n, i) => {
    const h = Math.max(4, (byDow[i] / maxDow) * 100);
    const isPeak = i === peakDowIdx && byDow[i] > 0;
    return `<div style="flex:1; display:flex; flex-direction: column; align-items: center; gap: 2px;">
      <div style="font-size: 10px; color: var(--muted);">${byDow[i] || ''}</div>
      <div style="height: ${h}px; width: 80%; background: ${isPeak ? 'var(--success)' : 'var(--success-light)'}; border-radius: 3px;"></div>
      <div style="font-size: 11px; color: ${isPeak ? 'var(--success)' : 'var(--text)'}; font-weight: ${isPeak?'600':'400'};">${n}</div>
    </div>`;
  }).join('');

  // 月份排序找出 Top3 與 Bottom3
  const monthRanked = monthNames.map((n, i) => ({ n, i, count: byMonth[i], amt: byMonthAmt[i] })).sort((a,b) => b.count - a.count);
  const top3 = monthRanked.slice(0, 3).filter(x => x.count > 0).map(x => x.n).join('、') || '—';
  const bot3 = monthRanked.slice(-3).filter(x => x.count > 0).reverse().map(x => x.n).join('、') || '—';

  box.innerHTML = `
    <div style="font-size: 12px; color: var(--muted); margin-bottom: 6px;">📈 月份分布（每月案件數）</div>
    <div style="display: flex; gap: 4px; align-items: flex-end; height: 130px; margin-bottom: 16px;">${monthBars}</div>

    <div style="font-size: 12px; color: var(--muted); margin-bottom: 6px;">📅 週幾分布（每週幾接幾筆）</div>
    <div style="display: flex; gap: 4px; align-items: flex-end; height: 130px; margin-bottom: 12px;">${dowBars}</div>

    <div style="background: var(--bg); padding: 10px; border-radius: 8px; font-size: 13px; line-height: 1.7;">
      <div>🔥 <b>最忙月份</b>：${top3}</div>
      <div>😴 <b>最閒月份</b>：${bot3}</div>
      <div>📅 <b>最常接案的週幾</b>：${dowNames[peakDowIdx]}（${byDow[peakDowIdx]} 筆）</div>
    </div>
  `;
}

// ============== v2.7: 個人時薪趨勢 ==============
function renderHourlyTrend() {
  const box = document.getElementById('rev-hourly-trend');
  if (!box) return;
  // 只看有填工時 + 有金額 + 有日期 + 沒取消 + 不是估價
  const jobs = state.jobs.filter(j => !j.cancelled && !j.isEstimate && j.date && +j.amount > 0 && +j.hoursWorked > 0);
  if (jobs.length < 3) {
    box.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--muted); font-size: 13px;">
      資料量不足（至少 3 筆有填工時的案件）<br>
      <span style="font-size: 11px;">在案件 modal 填「工時」欄位即可累積資料</span>
    </div>`;
    return;
  }

  // 按月分組
  const byMonth = {};
  jobs.forEach(j => {
    const m = getMonth(j.date);
    if (!byMonth[m]) byMonth[m] = { totalAmt: 0, totalHrs: 0, count: 0 };
    byMonth[m].totalAmt += +j.amount;
    byMonth[m].totalHrs += +j.hoursWorked;
    byMonth[m].count++;
  });

  const months = Object.keys(byMonth).sort();
  const recent = months.slice(-12);  // 最近 12 個月
  const rates = recent.map(m => {
    const s = byMonth[m];
    return { month: m, rate: s.totalAmt / s.totalHrs, count: s.count };
  });

  if (rates.length < 2) {
    box.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--muted); font-size: 13px;">資料分布太集中（同一個月份）</div>`;
    return;
  }

  const maxRate = Math.max(...rates.map(r => r.rate));
  const minRate = Math.min(...rates.map(r => r.rate));
  const avg = rates.reduce((s,r) => s + r.rate, 0) / rates.length;

  const bars = rates.map(r => {
    const pct = (r.rate / maxRate) * 100;
    const colorClass = r.rate > avg * 1.1 ? 'var(--success)' : (r.rate < avg * 0.9 ? 'var(--warning)' : 'var(--primary)');
    return `<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;">
      <div style="font-size: 10px; color: var(--muted);">${Math.round(r.rate).toLocaleString()}</div>
      <div style="height: ${pct * 1.4}px; width: 70%; background: ${colorClass}; border-radius: 3px;" title="${r.month}: NT$ ${Math.round(r.rate)}/hr （${r.count} 筆）"></div>
      <div style="font-size: 10px; color: var(--muted); white-space: nowrap;">${r.month.slice(2)}</div>
    </div>`;
  }).join('');

  // 整體統計
  const totalAmt = jobs.reduce((s,j) => s + (+j.amount || 0), 0);
  const totalHrs = jobs.reduce((s,j) => s + (+j.hoursWorked || 0), 0);
  const overallAvg = totalAmt / totalHrs;
  const trend = rates.length >= 6
    ? (rates.slice(-3).reduce((s,r)=>s+r.rate,0)/3) - (rates.slice(-6,-3).reduce((s,r)=>s+r.rate,0)/3)
    : 0;
  const trendIcon = trend > overallAvg * 0.05 ? '📈 上升' : (trend < -overallAvg * 0.05 ? '📉 下滑' : '➡️ 持平');

  box.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 12px;">
      <div style="background: var(--bg); padding: 10px; border-radius: 8px;">
        <div style="font-size: 11px; color: var(--muted);">整體平均時薪</div>
        <div style="font-size: 18px; font-weight: 700; color: var(--primary);">NT$ ${Math.round(overallAvg).toLocaleString()}/hr</div>
      </div>
      <div style="background: var(--bg); padding: 10px; border-radius: 8px;">
        <div style="font-size: 11px; color: var(--muted);">累計工時</div>
        <div style="font-size: 18px; font-weight: 700;">${Math.round(totalHrs).toLocaleString()} 小時</div>
      </div>
      <div style="background: var(--bg); padding: 10px; border-radius: 8px;">
        <div style="font-size: 11px; color: var(--muted);">趨勢（近 3 月 vs 前 3 月）</div>
        <div style="font-size: 16px; font-weight: 600;">${trendIcon}</div>
      </div>
    </div>
    <div style="font-size: 12px; color: var(--muted); margin-bottom: 6px;">最近 ${rates.length} 個月每月平均時薪</div>
    <div style="display: flex; gap: 4px; align-items: flex-end; height: 160px;">${bars}</div>
    <div style="font-size: 11px; color: var(--muted); margin-top: 6px;">
      綠色 = 高於平均 10%；橘色 = 低於平均 10%；藍色 = 接近平均
    </div>
  `;
}

// ============== Invoice Tab ==============
function renderInvoice() {
  const sel = document.getElementById('inv-client');
  const curC = sel.value;
  sel.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (curC) sel.value = curC;

  const allMonths = [...new Set(state.jobs.map(j => getMonth(j.date)).filter(Boolean))].sort().reverse();
  if (!allMonths.length) allMonths.push(thisMonth());

  const mSel = document.getElementById('inv-month');
  const curM = mSel.value;
  mSel.innerHTML = allMonths.map(m => `<option value="${m}">${m}</option>`).join('');
  if (curM && allMonths.includes(curM)) mSel.value = curM; else mSel.value = thisMonth();

  const mEnd = document.getElementById('inv-month-end');
  if (mEnd) {
    const curMe = mEnd.value;
    mEnd.innerHTML = allMonths.map(m => `<option value="${m}">${m}</option>`).join('');
    if (curMe && allMonths.includes(curMe)) mEnd.value = curMe; else mEnd.value = mSel.value;
  }

  // v2.10.13: 收款帳號下拉
  renderInvoicePayAccountSelect();

  drawInvoice();
}

// v2.10.13: 渲染請款單頁的收款帳號下拉
function renderInvoicePayAccountSelect() {
  const sel = document.getElementById('inv-pay-account');
  if (!sel) return;
  ensurePaymentAccounts();
  const u = config.userInfo || {};
  const list = u.paymentAccounts || [];
  if (!list.length) {
    sel.innerHTML = `<option value="">（尚未設定收款帳號，請到設定 → 我的收款資訊新增）</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = list.map(a => {
    const label = a.label || a.bank || '未命名帳號';
    const tail = a.account ? ' · ' + a.account.slice(-4).padStart(4, '*') : '';
    return `<option value="${escapeHtml(a.id)}">${escapeHtml(label)}${escapeHtml(tail)}</option>`;
  }).join('');
  sel.value = u.selectedPaymentAccountId || list[0].id;
}

function onInvPayAccountChange() {
  const sel = document.getElementById('inv-pay-account');
  if (!sel || !sel.value) return;
  config.userInfo.selectedPaymentAccountId = sel.value;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  drawInvoice();
}

function onInvModeChange() {
  const mode = document.getElementById('inv-mode').value;
  const sep = document.getElementById('inv-range-sep');
  const endSel = document.getElementById('inv-month-end');
  if (mode === 'range') {
    sep.classList.remove('hidden');
    endSel.classList.remove('hidden');
  } else {
    sep.classList.add('hidden');
    endSel.classList.add('hidden');
  }
  drawInvoice();
}

// v2.10.5：請款單狀態篩選 — preset 按鈕 + 常駐 checkbox
// 不再有「mode」概念；checkbox 勾選的狀態 = 顯示什麼
// preset 按鈕只是「快速勾選」的捷徑

const INVOICE_STATUS_IDS = {
  'done-unpaid': 'invst-done-unpaid',
  'partial':     'invst-partial',
  'paid':        'invst-paid',
  'pending':     'invst-pending',
  'cancelled':   'invst-cancelled'
};

const INVOICE_PRESETS = {
  'pending':   ['done-unpaid', 'partial'],                                  // 請款模式（預設）
  'reconcile': ['done-unpaid', 'partial', 'paid'],                          // 對帳模式
  'progress':  ['pending'],                                                 // 進度報告
  'all':       ['done-unpaid', 'partial', 'paid', 'pending', 'cancelled']   // 全部
};

const INVOICE_PRESET_LABELS = {
  'pending':   '📋 請款模式',
  'reconcile': '✅ 對帳模式',
  'progress':  '🔄 進度報告',
  'all':       '📦 全部'
};

// 把單一案件對應到 5 種「狀態類別」之一，給請款單篩選用
//   'paid'         = 已完成已收款
//   'partial'      = 部分收款（已收 > 0 且未收清；不論 done 與否）
//   'done-unpaid'  = 已完成待收款（沒有任何收款）
//   'pending'      = 進行中（!done）
//   'cancelled'    = 已取消
function jobInvoiceCategory(j) {
  if (j.cancelled) return 'cancelled';
  if (jobIsFullyPaid(j)) return 'paid';
  const paid = jobPaidTotal(j);
  if (paid > 0 && !jobIsFullyPaid(j)) return 'partial';
  if (j.done) return 'done-unpaid';
  return 'pending';
}

// 從目前 5 個 checkbox 取出勾選的狀態陣列
function getInvoiceCheckedStatuses() {
  const checked = [];
  Object.keys(INVOICE_STATUS_IDS).forEach(k => {
    if (document.getElementById(INVOICE_STATUS_IDS[k])?.checked) checked.push(k);
  });
  return checked;
}

// 把目前勾選狀態存到 config + 比對是否符合某個 preset，回傳該 preset key 或 'custom'
function detectInvoicePreset(checked) {
  const sortedNow = [...checked].sort().join(',');
  for (const [k, list] of Object.entries(INVOICE_PRESETS)) {
    if ([...list].sort().join(',') === sortedNow) return k;
  }
  return 'custom';
}

// 點 preset 按鈕：自動勾起對應的 checkbox 並重繪
function applyInvoicePreset(presetKey) {
  const list = INVOICE_PRESETS[presetKey] || INVOICE_PRESETS.pending;
  Object.keys(INVOICE_STATUS_IDS).forEach(k => {
    const el = document.getElementById(INVOICE_STATUS_IDS[k]);
    if (el) el.checked = list.includes(k);
  });
  onInvoiceStatusChange();
}

// checkbox 任一改動：存 config 並重繪
function onInvoiceStatusChange() {
  const checked = getInvoiceCheckedStatuses();
  config.invCustomStatuses = checked;
  // 同時記下「上次符合哪個 preset」（給 hint 用）；若是自訂組合則設為 'custom'
  config.invStatusMode = detectInvoicePreset(checked);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  drawInvoice();
}

// 給 drawInvoice 用：取得目前要顯示的狀態 set
function getInvoiceStatusFilter() {
  return new Set(getInvoiceCheckedStatuses());
}

// 載入請款單篩選 UI 到目前 config 的狀態
function loadInvoiceStatusUI() {
  // 若沒有任何儲存值 → 套用預設「請款模式」
  let cs = config.invCustomStatuses;
  if (!Array.isArray(cs) || cs.length === 0) {
    cs = INVOICE_PRESETS.pending;
  }
  Object.keys(INVOICE_STATUS_IDS).forEach(k => {
    const el = document.getElementById(INVOICE_STATUS_IDS[k]);
    if (el) el.checked = cs.includes(k);
  });
}

function drawInvoice() {
  const cid = document.getElementById('inv-client').value;
  const mode = document.getElementById('inv-mode')?.value || 'single';
  const mm = document.getElementById('inv-month').value;
  const mmEnd = document.getElementById('inv-month-end')?.value || mm;
  const c = getClient(cid);
  const v = document.getElementById('invoice-view');
  if (!c) { v.innerHTML = '<div class="card empty">請先新增業主</div>'; return; }

  // 計算範圍
  let rangeStart = mm, rangeEnd = mm;
  if (mode === 'range') {
    if (mmEnd < mm) { rangeStart = mmEnd; rangeEnd = mm; }
    else { rangeStart = mm; rangeEnd = mmEnd; }
  }
  const periodLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} ~ ${rangeEnd}`;

  // v2.10.4：套用狀態篩選
  // 注意：這裡改用 state.jobs（不再 activeJobs() 預先排除取消），因為「自訂」可能想包含取消的
  const allJobs = state.jobs.filter(j => {
    if (j.clientId !== cid) return false;
    const m = getMonth(j.date);
    return m >= rangeStart && m <= rangeEnd;
  });
  const statusFilter = getInvoiceStatusFilter();
  const jobs = allJobs.filter(j => statusFilter.has(jobInvoiceCategory(j)))
                      .sort((a,b) => (a.date||'').localeCompare(b.date||''));

  // 更新 toolbar 提示（顯示目前模式 + 筆數/總額，讓使用者寄出前心理預覽）
  const hintEl = document.getElementById('inv-status-hint');
  if (hintEl) {
    const filteredAmt = jobs.reduce((s,j) => s + jobFinalAmount(j), 0);
    const totalCount = allJobs.length;
    const presetKey = detectInvoicePreset(getInvoiceCheckedStatuses());
    const modeLabel = INVOICE_PRESET_LABELS[presetKey] || '⚙️ 自訂';
    if (jobs.length === 0) {
      hintEl.textContent = `${modeLabel}　（這個範圍沒有符合的案件，共 ${totalCount} 筆）`;
      hintEl.style.color = 'var(--warning)';
    } else {
      hintEl.textContent = `${modeLabel}　→ ${jobs.length}${jobs.length===totalCount?'':'/'+totalCount} 筆 · ${fmt(filteredAmt)}`;
      hintEl.style.color = 'var(--muted)';
    }
  }
  // v2.8.1: 用 finalAmount + payment 計算
  const grossTotal = jobs.reduce((s,j) => s + (+j.amount||0), 0);              // 原價合計
  const discountTotal = jobs.reduce((s,j) => s + jobDiscountAmount(j), 0);      // 折扣合計
  const finalTotal = jobs.reduce((s,j) => s + jobFinalAmount(j), 0);            // 應收合計
  const paidTotal = jobs.reduce((s,j) => s + jobPaidTotal(j), 0);               // 實收合計
  const unpaidTotal = jobs.filter(j => j.done).reduce((s,j) => s + jobUnpaidAmount(j), 0);  // 待收（已完成）
  const pendingTotal = jobs.filter(j => !j.done).reduce((s,j) => s + jobUnpaidAmount(j), 0); // 進行中
  const writeOffTotal = jobs.reduce((s,j) => s + (+j.writeOff || 0), 0);        // 呆帳合計
  const showDiscount = discountTotal > 0;  // v2.9.8: 沒有折扣 → 隱藏整欄

  const u = config.userInfo || {};
  const hasMyInfo = u.name || u.email || u.phone;
  // v2.10.13: 改用 active payment account
  const activeAcct = getActivePaymentAccount();
  const hasPayInfo = !!(activeAcct && (activeAcct.bank || activeAcct.account));

  v.innerHTML = `<div class="invoice" id="invoice-print">
    ${hasMyInfo ? `<div class="invoice-from">
      <div>
        <div class="from-name">${escapeHtml(u.invoiceTitle || u.name || '')}</div>
        ${u.name && u.invoiceTitle ? `<div>${escapeHtml(u.name)}</div>` : ''}
        ${u.phone ? `<div>📞 ${escapeHtml(u.phone)}</div>` : ''}
        ${u.email ? `<div>✉️ ${escapeHtml(u.email)}</div>` : ''}
      </div>
      <div style="text-align: right; color: var(--muted); font-size: 12px;">致</div>
    </div>` : ''}

    <div class="invoice-header">
      <div>
        <h2>${periodLabel} 工作明細</h2>
        <div class="meta">業主：${escapeHtml(c.name)}</div>
      </div>
      <div style="text-align: right;">
        <div class="meta">請款日：${todayStr()}</div>
        <div class="meta">共 ${jobs.length} 筆 · ${fmt(finalTotal)}</div>
      </div>
    </div>
    ${jobs.length ? `<table>
      <thead><tr><th>日期</th><th>項目</th><th>說明</th><th class="num">原價</th>${showDiscount ? '<th class="num">折扣</th>' : ''}<th class="num">應收</th><th class="num">已收</th><th>狀態</th></tr></thead>
      <tbody>
        ${jobs.map(j => {
          const final = jobFinalAmount(j);
          const disc = jobDiscountAmount(j);
          const gross = +j.amount || 0;
          const paid = jobPaidTotal(j);
          const unpaid = jobUnpaidAmount(j);
          const wo = +j.writeOff || 0;
          let stLabel;
          if (jobIsFullyPaid(j)) {
            stLabel = wo > 0
              ? '<span class="badge-status paid" title="部分認列呆帳">✓ 結清</span>'
              : '<span class="badge-status paid">✓ 已收款</span>';
          } else if (paid > 0) {
            stLabel = `<span class="badge-status done-unpaid">部分收款 · 還欠 ${fmt(unpaid).replace('NT$','').trim()}</span>`;
          } else if (j.done) {
            stLabel = '<span class="badge-status done-unpaid">$ 待收款</span>';
          } else {
            stLabel = '<span class="badge-status pending">進行中</span>';
          }
          return `<tr>
            <td>${j.date||'-'}</td>
            <td>${escapeHtml(j.title||'-')}</td>
            <td style="color:var(--muted); font-size: 13px;">${escapeHtml(j.details||'')}</td>
            <td class="num">${fmt(gross)}</td>
            ${showDiscount ? `<td class="num" style="color: ${disc>0?'var(--warning)':'var(--muted)'};">${disc>0 ? '−' + fmt(disc).replace('NT$','').trim() : '—'}</td>` : ''}
            <td class="num"><b>${fmt(final)}</b></td>
            <td class="num" style="color: ${paid>=final?'var(--success)':'var(--muted)'};">${paid>0 ? fmt(paid) : '—'}</td>
            <td>${stLabel}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr style="border-top: 2px solid var(--text); font-weight: 600;">
          <td colspan="3" style="text-align: right;">合計</td>
          <td class="num">${fmt(grossTotal)}</td>
          ${showDiscount ? `<td class="num" style="color: var(--warning);">−${fmt(discountTotal).replace('NT$','').trim()}</td>` : ''}
          <td class="num">${fmt(finalTotal)}</td>
          <td class="num" style="color: var(--success);">${fmt(paidTotal)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    <div class="invoice-total">
      ${paidTotal ? `<div class="invoice-total-item paid">
        <div class="tot-label">已收款</div>
        <div class="tot-value">${fmt(paidTotal)}</div>
      </div>` : ''}
      ${unpaidTotal ? `<div class="invoice-total-item pending">
        <div class="tot-label">本次請款（已完成待收）</div>
        <div class="tot-value">${fmt(unpaidTotal)}</div>
      </div>` : ''}
      ${pendingTotal ? `<div class="invoice-total-item" style="color: var(--muted);">
        <div class="tot-label">進行中（尚未請款）</div>
        <div class="tot-value" style="color: var(--muted);">${fmt(pendingTotal)}</div>
      </div>` : ''}
      ${writeOffTotal ? `<div class="invoice-total-item" style="color: var(--muted);">
        <div class="tot-label">呆帳（不再追討）</div>
        <div class="tot-value" style="color: var(--muted);">${fmt(writeOffTotal)}</div>
      </div>` : ''}
    </div>

    ${hasPayInfo ? `<div class="invoice-payment">
      <div class="invoice-payment-title">Payment Information 匯款資訊</div>
      ${activeAcct.bank ? `<div class="invoice-payment-row"><span class="lbl">銀行</span><span class="val">${escapeHtml(activeAcct.bank)}</span></div>` : ''}
      ${activeAcct.account ? `<div class="invoice-payment-row"><span class="lbl">帳號</span><span class="val" style="font-family: monospace;">${escapeHtml(activeAcct.account)}</span></div>` : ''}
      ${(activeAcct.holderName || u.name) ? `<div class="invoice-payment-row"><span class="lbl">戶名</span><span class="val">${escapeHtml(activeAcct.holderName || u.name)}</span></div>` : ''}
      ${activeAcct.note ? `<div class="invoice-payment-row" style="font-size: 12px; color: var(--muted);"><span class="lbl">備註</span><span class="val">${escapeHtml(activeAcct.note)}</span></div>` : ''}
      ${activeAcct.bankbookImage ? `<div style="margin-top: 12px;"><img src="${activeAcct.bankbookImage}" alt="存摺" style="max-width: 320px; max-height: 200px; width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border);"></div>` : ''}
    </div>` : ''}

    ${u.note ? `<div style="margin-top: 14px; padding: 10px; font-size: 12px; color: var(--muted); border-top: 1px dashed var(--border);">
      ${escapeHtml(u.note).replace(/\n/g, '<br>')}
    </div>` : ''}
    ` : '<div class="empty">此月份此業主沒有案件</div>'}
  </div>`;
}

function emptyState(title, sub) {
  return `<div class="empty"><div class="icon">📋</div><div style="font-weight: 500;">${title}</div><div style="font-size: 13px; margin-top: 4px;">${sub}</div></div>`;
}

// ============== Actions ==============
function setFilter(key, value) {
  // 切換任何篩選 → 自動清除提醒/業主排行帶來的鎖定篩選
  state.filters.jobIdsOnly = null;
  state.filters.jobIdsOnlyLabel = '';
  state.filters[key] = value;
  render();
}

// v2.3：只更新單一案件 row（避免 462 筆全重畫）
function updateJobRow(id) {
  const j = state.jobs.find(x => x.id === id);
  if (!j) return;
  const oldRow = document.querySelector(`[data-job-id="${id}"]`);
  if (!oldRow) { renderJobs(); return; }  // 找不到 → 退回完整重畫
  // 用同樣 HTML 取代
  const tmp = document.createElement('div');
  tmp.innerHTML = jobRow(j);
  const newRow = tmp.firstElementChild;
  if (newRow) oldRow.replaceWith(newRow);
}

function toggleDone(id) {
  const j = state.jobs.find(x => x.id === id); if (!j) return;
  if (j.cancelled) { toast('案件已取消，請先取消「已取消」狀態'); return; }
  j.done = !j.done;
  j.doneAt = j.done ? todayStr() : null;
  if (!j.done) { j.paid = false; j.paidAt = null; }
  save();
  // v2.9.5: 寫日誌
  const c = getClient(j.clientId);
  logAction(j.done ? 'job-done' : 'job-undo-done', { jobId: id, title: j.title, amount: j.amount, clientId: j.clientId, clientName: c?.name });
  updateJobRow(id);
  renderAlerts(); renderBadge();
  toast(j.done?'✓ 已標記完成':'已改為進行中');
}

function togglePaid(id) {
  const j = state.jobs.find(x => x.id === id); if (!j) return;
  if (j.cancelled) { toast('案件已取消，請先取消「已取消」狀態'); return; }
  if (jobIsFullyPaid(j)) {
    // 取消結清：若有多筆 payments → 提示去 modal 處理；單筆/無 → 直接清掉
    const count = (j.payments || []).length;
    if (count > 1) {
      toast('此案件有多筆收款紀錄，請開啟編輯視窗管理', 4000);
      editJob(id);
      return;
    }
    if (!confirm('將清除這筆案件的收款紀錄。確定？')) return;
    j.payments = [];
    j.writeOff = 0;
    recomputePaidStatus(j);
    save();
    const c = getClient(j.clientId);
    logAction('job-undo-paid', { jobId: id, title: j.title, amount: j.amount, clientId: j.clientId, clientName: c?.name });
    updateJobRow(id);
    renderAlerts(); renderBadge();
    toast('已改為待收款');
  } else {
    openPaidDateModal([id]);
  }
}

// ============== 收款日期 Modal ==============
let paidDateContext = null;  // { jobIds: [...] }

function openPaidDateModal(jobIds) {
  if (!jobIds.length) return;
  paidDateContext = { jobIds: [...jobIds] };
  document.getElementById('paid-date-input').value = todayStr();
  if (jobIds.length === 1) {
    const j = state.jobs.find(x => x.id === jobIds[0]);
    const c = j ? getClient(j.clientId) : null;
    document.getElementById('paid-date-info').textContent =
      `${c?.name || '?'} · ${j?.title || '(無標題)'} · ${fmt(+j?.amount||0)}`;
  } else {
    const total = state.jobs
      .filter(j => jobIds.includes(j.id))
      .reduce((s,j) => s + (+j.amount||0), 0);
    document.getElementById('paid-date-info').textContent =
      `批次標記 ${jobIds.length} 筆案件 · 合計 ${fmt(total)}`;
  }
  document.getElementById('paid-date-modal').classList.add('open');
}

function closePaidDateModal() {
  document.getElementById('paid-date-modal').classList.remove('open');
  paidDateContext = null;
}

function confirmPaidDate() {
  if (!paidDateContext) return;
  const dateStr = document.getElementById('paid-date-input').value;
  if (!dateStr) { toast('請填收款日'); return; }
  const ids = paidDateContext.jobIds;
  let n = 0;
  state.jobs.forEach(j => {
    if (!ids.includes(j.id)) return;
    if (jobIsFullyPaid(j)) return;
    // v2.8.0: 把待收餘額補一筆 payment（而非直接 set paid=true）
    const remaining = jobUnpaidAmount(j);
    if (remaining <= 0) return;
    j.payments = j.payments || [];
    j.payments.push({ id: uid(), date: dateStr, amount: remaining, note: '' });
    j.payments.sort((a,b) => (a.date||'').localeCompare(b.date||''));
    recomputePaidStatus(j);
    n++;
  });
  // v2.9.5: 寫日誌
  if (ids.length === 1) {
    const j = state.jobs.find(x => x.id === ids[0]);
    const c = getClient(j?.clientId);
    logAction('job-paid', { jobId: ids[0], title: j?.title, amount: j?.amount, clientId: j?.clientId, clientName: c?.name, date: dateStr });
  } else if (n > 0) {
    const total = ids.reduce((s, id) => {
      const j = state.jobs.find(x => x.id === id);
      return s + (j ? jobFinalAmount(j) : 0);
    }, 0);
    logAction('bulk-paid', { count: n, amount: total, date: dateStr });
  }
  if (ids.length > 1) bulkSelected.clear();
  if (paidDateContext._fromDashBulk) {
    dashBulkExit();
  }
  closePaidDateModal();
  save(); render();
  toast(`💰 ${n} 筆已標記收款 (${dateStr})`, 3000);
}

// ----- Job Modal -----
let editingJobId = null;

// v2.10.12: 業主下拉排序 — 常用 / 最近用過的擺上面（給新增 / 編輯案件用）
// 分數 = 近 90 天案件數 × 3 + 全期案件數；取消的案件不算；分數同則照業主名稱中文排序
function sortedClientsForPicker() {
  const NOW = Date.now();
  const RECENT_MS = 90 * 24 * 60 * 60 * 1000;
  const score = c => {
    const my = state.jobs.filter(j => j.clientId === c.id && !j.cancelled);
    const recent = my.filter(j => {
      const t = new Date(j.date).getTime();
      return !isNaN(t) && (NOW - t) < RECENT_MS;
    }).length;
    return recent * 3 + my.length;
  };
  return [...state.clients].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return (a.name || '').localeCompare(b.name || '', 'zh-Hant');
  });
}

function openJobModal() {
  if (!state.clients.length) { toast('請先新增業主'); switchTab('clients'); openClientModal(); return; }
  // v2.7.4: 鎖在背景拿，不擋 modal 開啟（修 FAB 點擊慢）
  tryAcquireLockOrWarn('案件');
  editingJobId = null;
  document.getElementById('job-modal-title').textContent = '新增案件';
  document.getElementById('job-delete-btn').classList.add('hidden');
  const cs = document.getElementById('job-client');
  cs.innerHTML = sortedClientsForPicker().map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (!document.getElementById('job-date').value) {
    document.getElementById('job-date').value = todayStr();
  }
  document.getElementById('job-end-date').value = '';
  document.getElementById('job-title').value = '';
  document.getElementById('job-tag').value = '';
  document.getElementById('job-details').value = '';
  document.getElementById('job-amount').value = '';
  document.getElementById('job-hours').value = '';
  document.getElementById('job-done').checked = false;
  document.getElementById('job-cancelled').checked = false;
  document.getElementById('job-estimate').checked = false;
  document.getElementById('job-done-at').value = '';
  // v2.8.0: 折扣 + payments 重設
  setDiscountUI('none', 0);
  document.getElementById('job-write-off').value = '';
  modalPayments = [];
  cancelAddJobPayment();
  updateJobAmountSummary();
  document.getElementById('job-duplicate-btn')?.classList.add('hidden');
  document.getElementById('job-export-estimate-btn')?.classList.add('hidden');
  document.getElementById('job-confirm-estimate-btn')?.classList.add('hidden');
  // v2.6: 子任務 + 計時器
  modalSubtasks = [];
  renderJobSubtasks();
  loadJobTimer(0);
  refreshTagSuggestions();
  onJobClientChange();
  updateJobHourlyHint();
  document.getElementById('job-modal').classList.add('open');
}

// ============== Modal 內折扣與收款狀況（v2.8.0）==============
let modalPayments = [];   // [{id, date, amount, note}]

function onDiscountTypeChange() {
  const type = document.querySelector('input[name="job-discount-type"]:checked')?.value || 'none';
  const inp = document.getElementById('job-discount-value');
  inp.disabled = (type === 'none');
  if (type === 'none') inp.value = '';
  if (type === 'percent') {
    inp.max = 100;
    inp.placeholder = '0-100';
  } else {
    inp.removeAttribute('max');
    inp.placeholder = '0';
  }
  updateJobAmountSummary();
}

function setDiscountUI(type, value) {
  document.querySelectorAll('input[name="job-discount-type"]').forEach(r => r.checked = (r.value === (type || 'none')));
  document.getElementById('job-discount-value').value = value || '';
  document.getElementById('job-discount-value').disabled = (!type || type === 'none');
}

// 即時更新「原價 - 折扣 = 應收 / 已收 / 待收」摘要
function updateJobAmountSummary() {
  const summary = document.getElementById('job-amount-summary');
  if (!summary) return;
  const base = +document.getElementById('job-amount').value || 0;
  const type = document.querySelector('input[name="job-discount-type"]:checked')?.value || 'none';
  const dval = +document.getElementById('job-discount-value').value || 0;
  let final = base, disc = 0;
  if (type === 'fixed') { disc = Math.min(base, dval); final = Math.max(0, base - disc); }
  else if (type === 'percent') { disc = Math.round(base * dval / 100); final = Math.max(0, base - disc); }

  const paid = modalPayments.reduce((s,p) => s + (+p.amount || 0), 0);
  const writeOff = +document.getElementById('job-write-off')?.value || 0;
  const unpaid = Math.max(0, final - paid - writeOff);

  let html = `原價 <b>${fmt(base)}</b>`;
  if (disc > 0) html += ` − 折扣 <b style="color: var(--warning);">${fmt(disc)}</b> = 應收 <b style="color: var(--primary);">${fmt(final)}</b>`;
  if (paid > 0 || writeOff > 0) {
    html += `<br>已收 <b style="color: var(--success);">${fmt(paid)}</b>`;
    if (writeOff > 0) html += ` · 呆帳 <b style="color: var(--muted);">${fmt(writeOff)}</b>`;
    html += ` · 待收 <b style="color: ${unpaid>0?'var(--warning)':'var(--success)'};">${fmt(unpaid)}</b>`;
  }
  summary.innerHTML = html;
  updateJobHourlyHint();
  renderJobPayments();
}

function renderJobPayments() {
  const list = document.getElementById('job-payments-list');
  if (!list) return;
  if (!modalPayments.length) {
    list.innerHTML = '<div style="font-size: 12px; color: var(--muted); padding: 4px 0;">尚無收款紀錄</div>';
  } else {
    list.innerHTML = modalPayments.map((p, i) => `
      <div style="display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 13px;">
        <span style="color: var(--muted); min-width: 92px;">${p.date || '-'}</span>
        <span style="flex: 1; color: var(--success); font-weight: 600;">+${fmt(+p.amount||0)}</span>
        <span style="color: var(--muted); font-size: 12px;">${escapeHtml(p.note||'')}</span>
        <button type="button" class="btn btn-ghost btn-sm" onclick="removeJobPayment(${i})" style="color: var(--danger); padding: 2px 6px;">✕</button>
      </div>
    `).join('');
  }
  // 更新狀態 badge
  const base = +document.getElementById('job-amount').value || 0;
  const type = document.querySelector('input[name="job-discount-type"]:checked')?.value || 'none';
  const dval = +document.getElementById('job-discount-value').value || 0;
  let final = base;
  if (type === 'fixed') final = Math.max(0, base - dval);
  else if (type === 'percent') final = Math.max(0, Math.round(base * (1 - dval / 100)));
  const paid = modalPayments.reduce((s,p) => s + (+p.amount || 0), 0);
  const writeOff = +document.getElementById('job-write-off')?.value || 0;
  const badge = document.getElementById('job-payment-status-badge');
  if (badge) {
    if (final === 0) badge.innerHTML = '';
    else if (paid + writeOff >= final) badge.innerHTML = '<span style="background: var(--success-light); color: var(--success); padding: 1px 6px; border-radius: 4px; font-weight: 600;">✓ 已結清</span>';
    else if (paid > 0) badge.innerHTML = `<span style="background: var(--warning-light); color: var(--warning); padding: 1px 6px; border-radius: 4px; font-weight: 600;">部分收款</span>`;
    else badge.innerHTML = `<span style="background: var(--danger-light); color: var(--danger); padding: 1px 6px; border-radius: 4px; font-weight: 600;">未收款</span>`;
  }
  const summaryEl = document.getElementById('job-payment-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `應收 <b>${fmt(final)}</b> · 已收 <b style="color: var(--success);">${fmt(paid)}</b> · 待收 <b style="color: ${final-paid-writeOff>0?'var(--warning)':'var(--muted)'};">${fmt(Math.max(0, final - paid - writeOff))}</b>`;
  }
}

function openAddJobPayment() {
  document.getElementById('job-payment-add-form').classList.remove('hidden');
  document.getElementById('job-payment-add-btn').classList.add('hidden');
  document.getElementById('job-payment-add-date').value = todayStr();
  // 預設帶入剩餘待收金額
  const base = +document.getElementById('job-amount').value || 0;
  const type = document.querySelector('input[name="job-discount-type"]:checked')?.value || 'none';
  const dval = +document.getElementById('job-discount-value').value || 0;
  let final = base;
  if (type === 'fixed') final = Math.max(0, base - dval);
  else if (type === 'percent') final = Math.max(0, Math.round(base * (1 - dval / 100)));
  const paid = modalPayments.reduce((s,p) => s + (+p.amount || 0), 0);
  const writeOff = +document.getElementById('job-write-off')?.value || 0;
  const remaining = Math.max(0, final - paid - writeOff);
  document.getElementById('job-payment-add-amount').value = remaining || '';
  document.getElementById('job-payment-add-note').value = '';
  setTimeout(() => document.getElementById('job-payment-add-amount').focus(), 50);
}

function cancelAddJobPayment() {
  document.getElementById('job-payment-add-form').classList.add('hidden');
  document.getElementById('job-payment-add-btn').classList.remove('hidden');
}

function confirmAddJobPayment() {
  const date = document.getElementById('job-payment-add-date').value;
  const amount = +document.getElementById('job-payment-add-amount').value;
  const note = document.getElementById('job-payment-add-note').value || '';
  if (!date) { toast('請選日期'); return; }
  if (!amount || amount <= 0) { toast('金額無效'); return; }
  modalPayments.push({ id: uid(), date, amount, note });
  modalPayments.sort((a,b) => (a.date||'').localeCompare(b.date||''));
  cancelAddJobPayment();
  updateJobAmountSummary();
  toast('✓ 已新增收款');
}

function removeJobPayment(i) {
  modalPayments.splice(i, 1);
  updateJobAmountSummary();
  toast('已刪除收款紀錄');
}

// 一鍵把待收餘額補一筆收款
function markJobFullyPaid() {
  const base = +document.getElementById('job-amount').value || 0;
  const type = document.querySelector('input[name="job-discount-type"]:checked')?.value || 'none';
  const dval = +document.getElementById('job-discount-value').value || 0;
  let final = base;
  if (type === 'fixed') final = Math.max(0, base - dval);
  else if (type === 'percent') final = Math.max(0, Math.round(base * (1 - dval / 100)));
  const paid = modalPayments.reduce((s,p) => s + (+p.amount || 0), 0);
  const writeOff = +document.getElementById('job-write-off')?.value || 0;
  const remaining = Math.max(0, final - paid - writeOff);
  if (remaining <= 0) { toast('已經結清了'); return; }
  modalPayments.push({ id: uid(), date: todayStr(), amount: remaining, note: '一次收齊' });
  modalPayments.sort((a,b) => (a.date||'').localeCompare(b.date||''));
  updateJobAmountSummary();
  toast(`✓ 已補一筆 ${fmt(remaining)}`);
}

// 工時與時薪即時計算提示
function updateJobHourlyHint() {
  const hint = document.getElementById('job-hourly-hint');
  if (!hint) return;
  const amt = +document.getElementById('job-amount')?.value || 0;
  const hrs = +document.getElementById('job-hours')?.value || 0;
  if (amt > 0 && hrs > 0) {
    const rate = Math.round(amt / hrs);
    hint.innerHTML = `💰 平均時薪：<b>NT$ ${fmt(rate).replace('NT$', '').trim()}/hr</b>`;
  } else {
    hint.innerHTML = '';
  }
}

function refreshTagSuggestions() {
  const dl = document.getElementById('tag-suggestions');
  if (!dl) return;
  dl.innerHTML = getUsedTags().map(t => `<option value="${escapeHtml(t)}">`).join('');
}

// 切換業主時：儲值制業主自動勾「已收款」並顯示餘額
function onJobClientChange() {
  const cid = document.getElementById('job-client').value;
  const c = getClient(cid);
  const hint = document.getElementById('job-prepaid-hint');
  if (!c?.prepaidMode) {
    hint?.classList.add('hidden');
    return;
  }
  // 儲值制業主：自動勾「已收款」（編輯時不要強制覆蓋）
  if (!editingJobId) {
    document.getElementById('job-paid').checked = true;
  }
  // 顯示餘額提示
  const bal = clientBalance(cid);
  if (bal && hint) {
    const amt = +document.getElementById('job-amount').value || 0;
    const willBe = bal.balance - amt;
    let warn = '';
    if (willBe < 0) warn = `<br>⚠️ 案件金額超過餘額！會超支 ${fmt(-willBe)}`;
    else if (willBe < 1000) warn = `<br>⚠️ 扣款後餘額剩 ${fmt(willBe)}，建議提醒業主再儲值`;
    hint.innerHTML = `💰 ${escapeHtml(c.name)} 是儲值制，目前餘額 <b>${fmt(bal.balance)}</b>${warn}`;
    hint.classList.remove('hidden');
  }
}

function editJob(id) {
  const j = state.jobs.find(x => x.id === id); if (!j) return;
  editingJobId = id;
  document.getElementById('job-modal-title').textContent = '編輯案件';
  document.getElementById('job-delete-btn').classList.remove('hidden');
  const cs = document.getElementById('job-client');
  cs.innerHTML = sortedClientsForPicker().map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  cs.value = j.clientId;
  document.getElementById('job-date').value = j.date || '';
  document.getElementById('job-end-date').value = j.endDate || '';
  document.getElementById('job-title').value = j.title || '';
  document.getElementById('job-tag').value = j.tag || '';
  document.getElementById('job-details').value = j.details || '';
  document.getElementById('job-amount').value = j.amount || '';
  document.getElementById('job-hours').value = j.hoursWorked || '';
  document.getElementById('job-done').checked = !!j.done;
  document.getElementById('job-cancelled').checked = !!j.cancelled;
  document.getElementById('job-estimate').checked = !!j.isEstimate;
  document.getElementById('job-done-at').value = j.doneAt || '';
  // v2.8.0: 折扣 + payments
  setDiscountUI(j.discountType || 'none', j.discountValue || 0);
  document.getElementById('job-write-off').value = j.writeOff || '';
  modalPayments = JSON.parse(JSON.stringify(j.payments || []));
  cancelAddJobPayment();
  updateJobAmountSummary();
  document.getElementById('job-duplicate-btn')?.classList.remove('hidden');
  // 估價單模式：顯示「轉正」與「估價單 PDF」按鈕
  document.getElementById('job-export-estimate-btn')?.classList.toggle('hidden', !j.isEstimate);
  document.getElementById('job-confirm-estimate-btn')?.classList.toggle('hidden', !j.isEstimate);
  // v2.6: 子任務 + 計時器
  modalSubtasks = JSON.parse(JSON.stringify(j.subtasks || []));
  renderJobSubtasks();
  loadJobTimer(j.timeSpentMs || 0);
  refreshTagSuggestions();
  onJobClientChange();
  updateJobHourlyHint();
  document.getElementById('job-modal').classList.add('open');
}

// 複製為新案件：保留欄位資料、重設日期/狀態
function duplicateJob() {
  if (!editingJobId) return;
  // 切到「新增」模式但保留現有欄位
  editingJobId = null;
  document.getElementById('job-modal-title').textContent = '新增案件（複製自現有案件）';
  document.getElementById('job-delete-btn').classList.add('hidden');
  document.getElementById('job-duplicate-btn').classList.add('hidden');
  // 清狀態（新案件預設未完成、未收款、未取消、日期改成今天）
  document.getElementById('job-date').value = todayStr();
  document.getElementById('job-end-date').value = '';
  document.getElementById('job-done').checked = false;
  document.getElementById('job-paid').checked = false;
  document.getElementById('job-cancelled').checked = false;
  document.getElementById('job-done-at').value = '';
  document.getElementById('job-paid-at').value = '';
  // 案件名稱加上「(複製)」字樣，方便辨識
  const title = document.getElementById('job-title');
  if (title.value && !title.value.includes('(複製)')) title.value = title.value + ' (複製)';
  toast('✓ 已複製欄位，按儲存即可建立新案件');
}

// 勾選完成時自動填今日（如果空白）
function onJobDoneChange() {
  const checked = document.getElementById('job-done').checked;
  const dateEl = document.getElementById('job-done-at');
  if (checked && !dateEl.value) dateEl.value = todayStr();
  if (!checked) dateEl.value = '';
}
function onJobPaidChange() {
  const checked = document.getElementById('job-paid').checked;
  const dateEl = document.getElementById('job-paid-at');
  if (checked && !dateEl.value) dateEl.value = todayStr();
  if (!checked) dateEl.value = '';
}

function closeJobModal() {
  stopJobTimerOnClose();  // v2.6: 停止計時器
  document.getElementById('job-modal').classList.remove('open');
  document.getElementById('job-date').value = '';
  releaseEditLock();
}

function saveJob() {
  const isDone = document.getElementById('job-done').checked;
  const isCancelled = document.getElementById('job-cancelled').checked;
  const endDate = document.getElementById('job-end-date').value;
  const hoursVal = document.getElementById('job-hours').value;
  const isEstimate = document.getElementById('job-estimate').checked;
  const timeSpentMs = getCurrentTimerMs();
  // v2.8.0: 折扣 + payments
  const discountType = document.querySelector('input[name="job-discount-type"]:checked')?.value || 'none';
  const discountValue = +document.getElementById('job-discount-value').value || 0;
  const writeOff = +document.getElementById('job-write-off').value || 0;
  const manualDoneAt = document.getElementById('job-done-at').value;

  const payload = {
    clientId: document.getElementById('job-client').value,
    date: document.getElementById('job-date').value,
    endDate: endDate || null,
    title: document.getElementById('job-title').value.trim(),
    tag: document.getElementById('job-tag').value.trim(),
    details: document.getElementById('job-details').value.trim(),
    amount: +document.getElementById('job-amount').value || 0,
    hoursWorked: hoursVal ? +hoursVal : null,
    done: isDone,
    cancelled: isCancelled,
    isEstimate: isEstimate,
    subtasks: [...modalSubtasks],
    timeSpentMs: timeSpentMs,
    // v2.8.0:
    discountType: discountType,
    discountValue: discountValue,
    payments: [...modalPayments],
    writeOff: writeOff
  };
  if (!payload.title) { toast('請輸入案件名稱'); return; }

  const c = getClient(payload.clientId);
  if (editingJobId) {
    const j = state.jobs.find(x => x.id === editingJobId);
    // 完成日邏輯（保留原樣）
    if (manualDoneAt && payload.done) payload.doneAt = manualDoneAt;
    else if (!j.done && payload.done) payload.doneAt = todayStr();
    else if (!payload.done) payload.doneAt = null;
    else payload.doneAt = j.doneAt;
    Object.assign(j, payload);
    recomputePaidStatus(j);
    logAction('job-edit', { jobId: editingJobId, title: payload.title, amount: payload.amount, clientId: payload.clientId, clientName: c?.name });
  } else {
    payload.doneAt = payload.done ? (manualDoneAt || todayStr()) : null;
    const newJob = { id: uid(), ...payload };
    recomputePaidStatus(newJob);
    state.jobs.push(newJob);
    logAction('job-create', { jobId: newJob.id, title: payload.title, amount: payload.amount, clientId: payload.clientId, clientName: c?.name });
  }
  save(); closeJobModal(); render(); toast('已儲存');
}

function deleteJob() {
  if (!editingJobId) return;
  if (!confirm('確定要刪除這筆案件？')) return;
  const j = state.jobs.find(x => x.id === editingJobId);
  const c = j ? getClient(j.clientId) : null;
  state.jobs = state.jobs.filter(j => j.id !== editingJobId);
  if (j) logAction('job-delete', { jobId: editingJobId, title: j.title, amount: j.amount, clientId: j.clientId, clientName: c?.name });
  save(); closeJobModal(); render(); toast('已刪除');
}

// ----- Client Modal -----
let editingClientId = null;
let pickedColor = COLORS[0];

// v2.7.9: 把 1-31 號的 select option 填好（共用）
function populateBillingDayDropdown(selected) {
  const sel = document.getElementById('client-billing-day');
  if (!sel) return;
  let html = '<option value="0">— 無固定 —</option>';
  for (let d = 1; d <= 31; d++) html += `<option value="${d}">${d} 號</option>`;
  sel.innerHTML = html;
  sel.value = String(selected || 0);
}

function openClientModal() {
  // v2.7.4: 鎖在背景拿，不擋 modal 開啟
  tryAcquireLockOrWarn('業主');
  editingClientId = null;
  document.getElementById('client-modal-title').textContent = '新增業主';
  document.getElementById('client-delete-btn').classList.add('hidden');
  document.getElementById('client-name').value = '';
  document.getElementById('client-note').value = '';
  document.getElementById('client-commission-rate').value = '';
  populateBillingDayDropdown(0);
  document.getElementById('client-billing-remind-days').value = 3;
  document.getElementById('client-unpaid-override').value = '';
  modalPrepayments = [];
  setPaymentMode('normal');
  refreshCommissionDropdown('');
  renderColorPicker(COLORS[state.clients.length % COLORS.length]);
  document.getElementById('client-modal').classList.add('open');
}

function editClient(id) {
  const c = getClient(id); if (!c) return;
  editingClientId = id;
  document.getElementById('client-modal-title').textContent = '編輯業主';
  document.getElementById('client-delete-btn').classList.remove('hidden');
  document.getElementById('client-name').value = c.name;
  document.getElementById('client-note').value = c.note || '';
  document.getElementById('client-commission-rate').value = c.commissionRate || '';
  populateBillingDayDropdown(c.billingDay || 0);
  document.getElementById('client-billing-remind-days').value = c.billingRemindDays || 3;
  document.getElementById('client-unpaid-override').value = c.unpaidRemindDaysOverride != null ? c.unpaidRemindDaysOverride : '';
  modalPrepayments = JSON.parse(JSON.stringify(c.prepayments || []));
  setPaymentMode(c.prepaidMode ? 'prepaid' : 'normal');
  refreshCommissionDropdown(c.commissionTo || '');
  renderColorPicker(c.color);
  document.getElementById('client-modal').classList.add('open');
}

// ============== 儲值紀錄管理（業主 Modal）==============
let modalPrepayments = [];  // Modal 內當前編輯的儲值清單

function setPaymentMode(mode) {
  const radios = document.querySelectorAll('input[name="client-payment-mode"]');
  radios.forEach(r => { r.checked = (r.value === mode); });
  document.getElementById('prepayment-section').classList.toggle('hidden', mode !== 'prepaid');
  if (mode === 'prepaid') renderPrepaymentList();
}

function onPaymentModeChange() {
  const mode = document.querySelector('input[name="client-payment-mode"]:checked')?.value || 'normal';
  document.getElementById('prepayment-section').classList.toggle('hidden', mode !== 'prepaid');
  if (mode === 'prepaid') renderPrepaymentList();
}

function renderPrepaymentList() {
  const list = document.getElementById('prepayment-list');
  if (!list) return;
  if (!modalPrepayments.length) {
    list.innerHTML = '<div style="font-size: 12px; color: var(--muted); padding: 4px 0;">尚無儲值紀錄</div>';
  } else {
    list.innerHTML = modalPrepayments.map((p, i) => `
      <div style="display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 13px;">
        <span style="color: var(--muted); min-width: 92px;">${p.date}</span>
        <span style="flex: 1; color: var(--success); font-weight: 600;">+${fmt(+p.amount||0)}</span>
        <span style="color: var(--muted); font-size: 12px;">${escapeHtml(p.note||'')}</span>
        <button type="button" class="btn btn-ghost btn-sm" onclick="removePrepayment(${i})" style="color: var(--danger); padding: 2px 6px;">✕</button>
      </div>
    `).join('');
  }

  // 計算餘額
  const total = modalPrepayments.reduce((s,p) => s + (+p.amount||0), 0);
  const used = editingClientId ? activeJobs().filter(j => j.clientId === editingClientId).reduce((s,j) => s + (+j.amount||0), 0) : 0;
  const balance = total - used;
  document.getElementById('prepayment-balance').innerHTML =
    `累計儲值：<b>${fmt(total)}</b> · 已使用：<b>${fmt(used)}</b> · ` +
    `<span style="color: ${balance < 1000 ? 'var(--danger)' : 'var(--success)'};">餘額 <b>${fmt(balance)}</b></span>`;
}

// Inline 新增儲值：開啟頁面內表單
function openAddPrepayment() {
  const form = document.getElementById('prepayment-add-form');
  const btn = document.getElementById('prepayment-add-btn');
  if (!form) return;
  // 預設值
  document.getElementById('prepayment-add-date').value = todayStr();
  document.getElementById('prepayment-add-amount').value = '';
  document.getElementById('prepayment-add-note').value = '';
  form.classList.remove('hidden');
  if (btn) btn.classList.add('hidden');
  setTimeout(() => document.getElementById('prepayment-add-amount')?.focus(), 50);
}

function cancelAddPrepayment() {
  document.getElementById('prepayment-add-form')?.classList.add('hidden');
  document.getElementById('prepayment-add-btn')?.classList.remove('hidden');
}

function confirmAddPrepayment() {
  const dateStr = document.getElementById('prepayment-add-date').value;
  const amtStr = document.getElementById('prepayment-add-amount').value;
  const note = document.getElementById('prepayment-add-note').value || '';
  if (!dateStr) { toast('請選日期'); return; }
  const amt = +amtStr;
  if (isNaN(amt) || amt <= 0) { toast('金額無效'); return; }
  modalPrepayments.push({ id: uid(), date: dateStr, amount: amt, note });
  modalPrepayments.sort((a,b) => (a.date||'').localeCompare(b.date||''));
  cancelAddPrepayment();
  renderPrepaymentList();
  toast('✓ 已新增儲值紀錄');
}

// 舊的 prompt 版本保留別名以防其他地方有引用
function addPrepayment() { openAddPrepayment(); }

function removePrepayment(i) {
  // 直接刪除（要復原可重新新增；不再用 confirm 彈窗）
  modalPrepayments.splice(i, 1);
  renderPrepaymentList();
  toast('已刪除一筆儲值紀錄');
}

function refreshCommissionDropdown(selected) {
  const sel = document.getElementById('client-commission-to');
  if (!sel) return;
  // 介紹人選單：列出其他業主（不含自己）
  sel.innerHTML = '<option value="">— 無 —</option>' +
    state.clients
      .filter(c => c.id !== editingClientId)
      .map(c => `<option value="${c.id}" ${selected===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
}

function closeClientModal() {
  document.getElementById('client-modal').classList.remove('open');
  releaseEditLock();
}

function renderColorPicker(selected) {
  pickedColor = selected;
  const box = document.getElementById('color-picker');
  box.innerHTML = COLORS.map(col => `<div onclick="pickColor('${col}')" style="width: 32px; height: 32px; border-radius: 50%; background: ${col}; cursor: pointer; border: 3px solid ${col===selected?'var(--text)':'transparent'};"></div>`).join('');
}

function pickColor(col) { renderColorPicker(col); }

function saveClient() {
  const name = document.getElementById('client-name').value.trim();
  const note = document.getElementById('client-note').value.trim();
  const commissionRate = +document.getElementById('client-commission-rate').value || 0;
  const commissionTo = document.getElementById('client-commission-to').value;
  const paymentMode = document.querySelector('input[name="client-payment-mode"]:checked')?.value || 'normal';
  // v2.7.9: 請款設定
  const billingDay = +document.getElementById('client-billing-day').value || 0;
  const billingRemindDays = +document.getElementById('client-billing-remind-days').value || 3;
  const unpaidOverrideRaw = document.getElementById('client-unpaid-override').value.trim();
  const unpaidRemindDaysOverride = unpaidOverrideRaw === '' ? null : (+unpaidOverrideRaw || null);
  if (!name) { toast('請輸入業主名稱'); return; }
  const payload = {
    name, note, color: pickedColor,
    commissionRate, commissionTo,
    prepaidMode: paymentMode === 'prepaid',
    prepayments: paymentMode === 'prepaid' ? modalPrepayments : [],
    billingDay,
    billingRemindDays,
    unpaidRemindDaysOverride
  };
  if (editingClientId) {
    const c = getClient(editingClientId);
    Object.assign(c, payload);
    logAction('client-edit', { clientId: editingClientId, name: payload.name });
  } else {
    const newId = uid();
    state.clients.push({ id: newId, ...payload });
    logAction('client-create', { clientId: newId, name: payload.name });
  }
  save(); closeClientModal(); render(); toast('已儲存');
}

function deleteClient() {
  if (!editingClientId) return;
  const c = getClient(editingClientId);
  const cnt = state.jobs.filter(j => j.clientId === editingClientId).length;
  if (!confirm(`確定要刪除業主「${c.name}」？這將同時刪除 ${cnt} 筆案件。`)) return;
  state.jobs = state.jobs.filter(j => j.clientId !== editingClientId);
  state.clients = state.clients.filter(x => x.id !== editingClientId);
  logAction('client-delete', { clientId: editingClientId, name: c.name, deletedJobs: cnt });
  save(); closeClientModal(); render(); toast('已刪除');
}

// ----- Invoice actions -----
function gotoInvoice(cid) {
  switchTab('invoice');
  setTimeout(() => {
    document.getElementById('inv-client').value = cid;
    document.getElementById('inv-month').value = thisMonth();
    drawInvoice();
  }, 50);
}

function copyShareLink(cid) {
  const url = location.origin + location.pathname + '?client=' + cid;
  navigator.clipboard.writeText(url).then(() => toast('✓ 連結已複製'));
}

function copyInvoiceText() {
  const cid = document.getElementById('inv-client').value;
  const mode = document.getElementById('inv-mode')?.value || 'single';
  const mm = document.getElementById('inv-month').value;
  const mmEnd = document.getElementById('inv-month-end')?.value || mm;
  const c = getClient(cid); if (!c) return;

  let rangeStart = mm, rangeEnd = mm;
  if (mode === 'range') {
    if (mmEnd < mm) { rangeStart = mmEnd; rangeEnd = mm; }
    else { rangeStart = mm; rangeEnd = mmEnd; }
  }
  const periodLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} ~ ${rangeEnd}`;

  const jobs = activeJobs().filter(j => {
    if (j.clientId !== cid) return false;
    const m = getMonth(j.date);
    return m >= rangeStart && m <= rangeEnd;
  }).sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const paid = jobs.reduce((s,j) => s + jobPaidTotal(j), 0);
  const unpaid = jobs.filter(j => j.done).reduce((s,j) => s + jobUnpaidAmount(j), 0);
  const txt = `${periodLabel} ${c.name} 工作明細\n\n` +
    jobs.map(j => {
      const final = jobFinalAmount(j);
      const disc = jobDiscountAmount(j);
      const pTotal = jobPaidTotal(j);
      const st = jobIsFullyPaid(j) ? '✓已收' :
                 (pTotal > 0 ? `部分收款 (已收${fmt(pTotal).replace('NT$','')})` :
                 (j.done ? '$待收' : '進行中'));
      const amtStr = disc > 0 ? `${fmt(+j.amount||0)} − ${fmt(disc).replace('NT$','')} = ${fmt(final)}` : fmt(final);
      return `${j.date} | ${j.title} | ${amtStr} | ${st}${j.details?'\n  '+j.details:''}`;
    }).join('\n') +
    `\n\n本次請款（待收款）：${fmt(unpaid)}` +
    (paid ? `\n已收款：${fmt(paid)}` : '');
  navigator.clipboard.writeText(txt).then(() => toast('✓ 已複製純文字版'));
}

function enterClientMode(cid) {
  const c = getClient(cid);
  if (!c) { alert('找不到此業主的資料'); return; }
  document.querySelector('nav.tabs').style.display = 'none';
  document.getElementById('fab-add').style.display = 'none';
  document.getElementById('page-title').textContent = c.name + ' - 工作明細';
  document.getElementById('page-sub').textContent = '只讀檢視';
  document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
  const inv = document.getElementById('tab-invoice');
  inv.classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('inv-client').value = cid;
    document.getElementById('inv-client').disabled = true;
    drawInvoice();
  }, 50);
}

// ============== Import / Export / Demo ==============
function exportData() {
  const payload = {
    _exportedAt: new Date().toISOString(),
    _version: 'v1.0',
    _counts: { clients: state.clients.length, jobs: state.jobs.length },
    clients: state.clients,
    jobs: state.jobs,
    config: {
      ...config,
      // 不要把連線密碼一起匯出（匯出資料備份時）
      sheetConfig: undefined,
      calId: undefined
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `freelance-backup-${todayStr()}.json`;
  a.click();
  // 記錄匯出時間
  config.lastExportAt = todayStr();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  render();
  toast('✓ 已匯出，備份時間已更新');
}

// ============== 我的收款資訊（v2.10.13 改成多筆收款帳號）==============

// 確保 paymentAccounts 陣列存在；若無但有舊單筆 bank/account → 自動建立「預設帳號」
function ensurePaymentAccounts() {
  config.userInfo = config.userInfo || {};
  const u = config.userInfo;
  if (!Array.isArray(u.paymentAccounts)) u.paymentAccounts = [];
  if (u.paymentAccounts.length === 0 && (u.bank || u.account)) {
    u.paymentAccounts.push({
      id: uid(),
      label: '預設帳號',
      bank: u.bank || '',
      account: u.account || '',
      note: ''
    });
  }
  if (u.paymentAccounts.length > 0 && !u.selectedPaymentAccountId) {
    u.selectedPaymentAccountId = u.paymentAccounts[0].id;
  }
  // 若選中的 id 不在陣列裡（被刪過）→ 重設為第一筆
  if (u.selectedPaymentAccountId && !u.paymentAccounts.find(a => a.id === u.selectedPaymentAccountId)) {
    u.selectedPaymentAccountId = u.paymentAccounts[0]?.id || '';
  }
}

// v2.10.15: 把上傳圖片縮到指定寬度 + JPEG 壓縮，回傳 data URL
function resizeImageToDataUrl(file, maxW = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('沒有檔案'));
    if (!file.type.startsWith('image/')) return reject(new Error('不是圖片檔'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) { reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀取圖片失敗')); };
    img.src = url;
  });
}

// 上傳存摺照片：壓縮後寫入該帳號 row 的 hidden input，並更新預覽
async function onBankbookFileChange(input, acctId) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('請選擇圖片檔'); input.value = ''; return; }
  toastProgress('🖼️ 壓縮圖片中…');
  try {
    const dataUrl = await resizeImageToDataUrl(file, 800, 0.7);
    const row = input.closest('.payment-account-row');
    if (!row) throw new Error('找不到帳號 row');
    const hidden = row.querySelector('[data-acct-field="bankbookImage"]');
    if (hidden) hidden.value = dataUrl;
    const preview = document.getElementById(`bankbook-preview-${acctId}`);
    if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="存摺" style="max-width: 200px; max-height: 120px; border-radius: 6px; border: 1px solid var(--border); margin-top: 6px;">`;
    const removeBtn = document.getElementById(`bankbook-remove-${acctId}`);
    if (removeBtn) removeBtn.style.display = '';
    toast('✓ 圖片已上傳，記得按儲存');
  } catch (err) {
    toast('圖片處理失敗：' + (err.message || err));
  }
  input.value = '';
}

function clearBankbookImage(acctId) {
  const row = document.querySelector(`.payment-account-row[data-acct-id="${acctId}"]`);
  if (!row) return;
  const hidden = row.querySelector('[data-acct-field="bankbookImage"]');
  if (hidden) hidden.value = '';
  const preview = document.getElementById(`bankbook-preview-${acctId}`);
  if (preview) preview.innerHTML = '';
  const removeBtn = document.getElementById(`bankbook-remove-${acctId}`);
  if (removeBtn) removeBtn.style.display = 'none';
  toast('✓ 已清除存摺照片，記得按儲存');
}

// 取得目前要顯示在請款單上的收款帳號（依 selectedPaymentAccountId，找不到回第一筆）
function getActivePaymentAccount() {
  const u = config.userInfo || {};
  const list = Array.isArray(u.paymentAccounts) ? u.paymentAccounts : [];
  if (!list.length) {
    // 完全沒有 → 回退舊欄位（向下相容）
    return (u.bank || u.account) ? { bank: u.bank || '', account: u.account || '', note: '' } : null;
  }
  return list.find(a => a.id === u.selectedPaymentAccountId) || list[0];
}

function loadUserInfoUI() {
  ensurePaymentAccounts();
  const u = config.userInfo || {};
  const g = (id) => document.getElementById(id);
  if (g('me-name')) g('me-name').value = u.name || '';
  if (g('me-phone')) g('me-phone').value = u.phone || '';
  if (g('me-email')) g('me-email').value = u.email || '';
  if (g('me-title')) g('me-title').value = u.invoiceTitle || '';
  if (g('me-note')) g('me-note').value = u.note || '';
  renderPaymentAccountsUI();
}

// 渲染收款帳號列表（設定頁）
function renderPaymentAccountsUI() {
  const wrap = document.getElementById('payment-accounts-list');
  if (!wrap) return;
  const u = config.userInfo || {};
  const list = u.paymentAccounts || [];
  if (!list.length) {
    wrap.innerHTML = `<div style="font-size: 13px; color: var(--muted); padding: 8px 0;">尚未新增收款帳號，按下方「+ 新增帳號」開始建立。</div>`;
    return;
  }
  wrap.innerHTML = list.map((a, i) => `
    <div class="payment-account-row" data-acct-id="${escapeHtml(a.id)}" style="border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 10px; background: var(--bg);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <strong style="font-size: 13px;">收款帳號 ${i + 1}</strong>
        <button type="button" class="btn btn-ghost btn-sm" onclick="removePaymentAccount('${escapeHtml(a.id)}')" title="刪除這筆收款帳號" style="color: var(--danger);">🗑️ 刪除</button>
      </div>
      <div class="my-info-grid">
        <div>
          <label>標籤（自己看的）</label>
          <input type="text" data-acct-field="label" value="${escapeHtml(a.label || '')}" placeholder="例：個人 / 工作室">
        </div>
        <div>
          <label>戶名（請款單顯示）</label>
          <input type="text" data-acct-field="holderName" value="${escapeHtml(a.holderName || '')}" placeholder="留空則用我的姓名">
        </div>
        <div>
          <label>匯款銀行</label>
          <input type="text" data-acct-field="bank" value="${escapeHtml(a.bank || '')}" placeholder="例：玉山銀行 (808)">
        </div>
        <div>
          <label>匯款帳號</label>
          <input type="text" data-acct-field="account" value="${escapeHtml(a.account || '')}" placeholder="0000-000-000000">
        </div>
        <div style="grid-column: 1 / -1;">
          <label>帳號備註（會列在請款單對應位置）</label>
          <input type="text" data-acct-field="note" value="${escapeHtml(a.note || '')}" placeholder="例：請註明案件編號">
        </div>
        <div style="grid-column: 1 / -1;">
          <label>存摺照片（請款單會附上，自動壓縮到 800px）</label>
          <input type="hidden" data-acct-field="bankbookImage" value="${escapeHtml(a.bankbookImage || '')}">
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <input type="file" accept="image/*" id="bankbook-upload-${escapeHtml(a.id)}" onchange="onBankbookFileChange(this, '${escapeHtml(a.id)}')" style="display: none;">
            <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('bankbook-upload-${escapeHtml(a.id)}').click()">📷 ${a.bankbookImage ? '更換照片' : '上傳照片'}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="bankbook-remove-${escapeHtml(a.id)}" onclick="clearBankbookImage('${escapeHtml(a.id)}')" style="color: var(--danger); ${a.bankbookImage ? '' : 'display: none;'}">移除</button>
          </div>
          <div id="bankbook-preview-${escapeHtml(a.id)}">
            ${a.bankbookImage ? `<img src="${a.bankbookImage}" alt="存摺" style="max-width: 200px; max-height: 120px; border-radius: 6px; border: 1px solid var(--border); margin-top: 6px;">` : ''}
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function addPaymentAccount() {
  // 先把目前 UI 上的內容收回 config，再新增空白一筆，重新 render
  collectPaymentAccountsFromUI();
  config.userInfo.paymentAccounts.push({
    id: uid(),
    label: '',
    holderName: '',
    bank: '',
    account: '',
    note: '',
    bankbookImage: ''
  });
  renderPaymentAccountsUI();
}

function removePaymentAccount(id) {
  collectPaymentAccountsFromUI();
  const u = config.userInfo;
  u.paymentAccounts = (u.paymentAccounts || []).filter(a => a.id !== id);
  if (u.selectedPaymentAccountId === id) {
    u.selectedPaymentAccountId = u.paymentAccounts[0]?.id || '';
  }
  renderPaymentAccountsUI();
}

// 把畫面上的 input 內容收回 config.userInfo.paymentAccounts（in-place 更新）
function collectPaymentAccountsFromUI() {
  const wrap = document.getElementById('payment-accounts-list');
  if (!wrap) return;
  const u = config.userInfo || {};
  const list = u.paymentAccounts || [];
  wrap.querySelectorAll('.payment-account-row').forEach(row => {
    const id = row.dataset.acctId;
    const a = list.find(x => x.id === id);
    if (!a) return;
    row.querySelectorAll('[data-acct-field]').forEach(inp => {
      a[inp.dataset.acctField] = inp.value.trim();
    });
  });
}

function saveUserInfo() {
  // 收回 UI 上的多筆收款帳號
  collectPaymentAccountsFromUI();
  config.userInfo = {
    ...config.userInfo,
    name: document.getElementById('me-name').value.trim(),
    phone: document.getElementById('me-phone').value.trim(),
    email: document.getElementById('me-email').value.trim(),
    invoiceTitle: document.getElementById('me-title').value.trim(),
    note: document.getElementById('me-note').value.trim()
    // bank / account 舊欄位不再寫入；paymentAccounts 由上面 collectPaymentAccountsFromUI 維護
  };
  ensurePaymentAccounts();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  render();
  toast('✓ 已儲存收款資訊，請款單會自動帶入');
}

function renderBackupStatus() {
  // 順便調整範例按鈕的安全提示
  const demoBtn = document.getElementById('demo-btn');
  if (demoBtn) {
    if (state.clients.length > 0 || state.jobs.length > 0) {
      demoBtn.textContent = '⚠️ 載入範例（會清空現有）';
      demoBtn.classList.remove('btn-outline');
      demoBtn.classList.add('btn-danger');
    } else {
      demoBtn.textContent = '載入範例資料';
      demoBtn.classList.remove('btn-danger');
      demoBtn.classList.add('btn-outline');
    }
  }

  const el = document.getElementById('backup-status');
  if (!el) return;
  const last = config.lastExportAt;
  if (!last) {
    el.textContent = '尚未備份';
    el.style.color = 'var(--danger)';
  } else {
    const days = daysBetween(last, todayStr());
    if (days === 0) {
      el.textContent = '✓ 今日已備份';
      el.style.color = 'var(--success)';
    } else if (days <= 7) {
      el.textContent = `${days} 天前備份過`;
      el.style.color = 'var(--success)';
    } else if (days <= config.backupRemindDays) {
      el.textContent = `${days} 天前備份過`;
      el.style.color = 'var(--warning)';
    } else {
      el.textContent = `${days} 天沒備份`;
      el.style.color = 'var(--danger)';
    }
  }
}

function exportCSV() {
  if (!state.jobs.length) { toast('沒有資料可匯出'); return; }

  const headers = ['日期', '截止日', '業主', '案件名稱', '類型', '細項', '金額', '抽成%', '實收金額', '狀態', '完成日', '收款日'];
  const rows = state.jobs
    .slice()
    .sort((a,b) => (a.date||'').localeCompare(b.date||''))
    .map(j => {
      const c = getClient(j.clientId);
      const clientName = c ? c.name : '未指定';
      const rate = (c?.commissionRate) || 0;
      const net = jobNetAmount(j);
      const status = j.cancelled ? '已取消' : (j.paid ? '已收款' : (j.done ? '完成待收' : '進行中'));
      return [
        j.date || '',
        j.endDate || '',
        clientName,
        j.title || '',
        j.tag || '',
        (j.details || '').replace(/\n/g, ' '),
        j.amount || 0,
        rate,
        net,
        status,
        j.doneAt || '',
        j.paidAt || ''
      ];
    });

  // CSV 字串建構（含 BOM 給 Excel 認得 UTF-8）
  const csv = '﻿' + [
    headers.join(','),
    ...rows.map(r => r.map(cell => {
      const s = String(cell);
      // 含逗號、引號、換行的要包雙引號並轉義
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `freelance-export-${todayStr()}.csv`;
  a.click();
  toast('✓ CSV 已匯出（用 Excel 開啟即可）');
}

function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);

      // 驗證
      if (!d.clients && !d.jobs) {
        alert('這似乎不是資料備份檔（缺少 clients/jobs 欄位）。\n\n注意：「跨裝置設定檔」跟「資料備份檔」是不同的東西。');
        return;
      }

      // 比對日期：哪份比較新？
      const importedAt = d._exportedAt || null;
      const localAt = config.lastModifiedAt || null;
      const importedCnt = (d.clients?.length || 0) + (d.jobs?.length || 0);
      const localCnt = state.clients.length + state.jobs.length;

      let warningMsg = '';
      if (importedAt && localAt) {
        const importedDate = new Date(importedAt);
        const localDate = new Date(localAt);
        const diffMs = importedDate - localDate;
        const diffDays = Math.round(Math.abs(diffMs) / 86400000);
        if (diffMs > 0) {
          warningMsg = `📅 匯入檔比較新（${diffDays} 天）\n• 匯入檔：${importedDate.toLocaleString('zh-TW')}\n• 現有資料：${localDate.toLocaleString('zh-TW')}\n\n建議：直接匯入。`;
        } else if (diffMs < 0) {
          warningMsg = `⚠️ 警告：現有資料比較新（${diffDays} 天）！\n• 匯入檔：${importedDate.toLocaleString('zh-TW')}\n• 現有資料：${localDate.toLocaleString('zh-TW')}\n\n建議：先匯出現有資料備份，確認真的要回到舊版本再匯入。`;
        } else {
          warningMsg = `兩份資料時間相同：${importedDate.toLocaleString('zh-TW')}`;
        }
      } else if (importedAt) {
        warningMsg = `匯入檔：${new Date(importedAt).toLocaleString('zh-TW')}\n現有資料：（沒有時間記錄）`;
      } else {
        warningMsg = '⚠️ 匯入檔沒有時間戳（可能是舊版本檔案），無法判斷新舊';
      }

      const confirmMsg = `準備匯入：\n` +
        `• 業主 ${d.clients?.length||0} 位（現有 ${state.clients.length} 位）\n` +
        `• 案件 ${d.jobs?.length||0} 筆（現有 ${state.jobs.length} 筆）\n\n` +
        warningMsg + `\n\n` +
        `⚠️ 匯入會覆蓋現有資料。確定？`;

      if (!confirm(confirmMsg)) return;

      // 第二次確認（如果現有比新）
      if (localAt && importedAt && new Date(localAt) > new Date(importedAt) && localCnt > 0) {
        if (!confirm('再次確認：你的現有資料較新，匯入後會被舊版覆蓋。\n\n真的要繼續？')) return;
      }

      state.clients = d.clients || [];
      state.jobs = (d.jobs || []).map(j => ({
        ...j,
        paid: j.paid ?? false,
        cancelled: j.cancelled ?? false,
        doneAt: j.doneAt ?? (j.done ? (j.date || todayStr()) : null),
        paidAt: j.paidAt ?? (j.paid ? (j.date || todayStr()) : null)
      }));
      save(); renderAll(); toast('✓ 已匯入');
    } catch(err) {
      alert('檔案格式錯誤：' + err.message);
    }
  };
  r.readAsText(f);
}

function loadDemo() {
  // 已有資料時：兩次警告
  if (state.clients.length > 0 || state.jobs.length > 0) {
    const msg = `⚠️ 警告：載入範例資料會清空現有資料！\n\n` +
      `現有：${state.clients.length} 位業主、${state.jobs.length} 筆案件\n\n` +
      `如果你不確定，先按取消，到「💾 資料備份」匯出備份。\n\n確定要繼續？`;
    if (!confirm(msg)) return;
    const verify = prompt('最後確認：請輸入「載入範例」四個字才會執行（避免誤觸）');
    if (verify !== '載入範例') {
      toast('已取消（輸入文字不符）');
      return;
    }
  }
  const c1 = uid(), c2 = uid(), c3 = uid();
  state.clients = [
    { id: c1, name: 'A 媒體公司', color: COLORS[0], note: '月結' },
    { id: c2, name: 'B 電商品牌', color: COLORS[2], note: '結案付款' },
    { id: c3, name: 'C 工作室', color: COLORS[3], note: '' }
  ];
  const m = thisMonth();
  const today = todayStr();
  state.jobs = [
    // 已收款
    { id: uid(), clientId: c1, date: m+'-03', title: 'FB 廣告 banner 5 張', details: '1080x1080，含兩次修改', amount: 4500, done: true, paid: true, doneAt: m+'-05', paidAt: m+'-10' },
    // 完成未收款（超過 7 天 → 會觸發提醒）
    { id: uid(), clientId: c1, date: m+'-12', title: '官網首頁改版', details: '首頁 + 3 內頁', amount: 18000, done: true, paid: false, doneAt: addDays(new Date(), -10), paidAt: null },
    // 剛完成待收款
    { id: uid(), clientId: c2, date: m+'-08', title: '產品攝影後製', details: '15 張', amount: 3000, done: true, paid: false, doneAt: addDays(new Date(), -2), paidAt: null },
    // 進行中（未來）
    { id: uid(), clientId: c2, date: addDays(new Date(), 2), title: 'EDM 設計', details: '春季促銷 EDM', amount: 2500, done: false, paid: false, doneAt: null, paidAt: null },
    // 逾期未完成
    { id: uid(), clientId: c3, date: addDays(new Date(), -3), title: '形象動畫', details: '30 秒片頭', amount: 12000, done: false, paid: false, doneAt: null, paidAt: null },
    // 未來案件
    { id: uid(), clientId: c3, date: addDays(new Date(), 10), title: 'Logo 優化', details: '主視覺調整', amount: 5000, done: false, paid: false, doneAt: null, paidAt: null },
  ];
  logAction('data-load-demo', { clients: state.clients.length, jobs: state.jobs.length });
  save(); renderAll(); toast('✓ 已載入範例');
}

function clearAll() {
  const cnt = state.jobs.length;
  if (cnt === 0 && state.clients.length === 0) {
    toast('資料已經是空的');
    return;
  }
  if (!confirm(`⚠️ 即將清空所有資料！\n\n業主：${state.clients.length} 位\n案件：${cnt} 筆\n\n操作不可復原。確定？`)) return;
  // 二次確認：必須輸入「確認清空」
  const verify = prompt('最後確認：請輸入「確認清空」四個字才會執行（避免誤觸）');
  if (verify !== '確認清空') {
    toast('已取消（輸入文字不符）');
    return;
  }
  const beforeC = state.clients.length;
  const beforeJ = state.jobs.length;
  state.clients = []; state.jobs = [];
  logAction('data-clear', { clearedClients: beforeC, clearedJobs: beforeJ });
  save(); renderAll(); toast('已清空全部資料');
}

// ============== 事件監聽 ==============
document.getElementById('inv-client').addEventListener('change', drawInvoice);
document.getElementById('inv-month').addEventListener('change', drawInvoice);
document.getElementById('inv-month-end')?.addEventListener('change', drawInvoice);
// 案件金額變動時更新儲值提示
document.getElementById('job-amount')?.addEventListener('input', onJobClientChange);

// ============== 跨裝置設定檔（攜帶 API URL、Token、我的資料）==============
function exportSettings() {
  // 只匯出設定，不含 clients/jobs（那些走 Sheet 同步）
  const settings = {
    _exportedAt: new Date().toISOString(),
    _version: 'v1.0',
    _device: navigator.platform,
    sheetConfig: {
      apiUrl: config.sheetConfig?.apiUrl || '',
      apiToken: config.sheetConfig?.apiToken || '',
      sheetUrl: config.sheetConfig?.sheetUrl || ''
    },
    sheetSyncEnabled: config.sheetSyncEnabled || false,
    userInfo: config.userInfo || {},
    calId: config.calId || '',
    calEnabled: config.calEnabled || false,
    calAutoSync: config.calAutoSync || false,
    unpaidRemindDays: config.unpaidRemindDays || 7,
    backupRemindDays: config.backupRemindDays || 14
  };

  const hasToken = !!settings.sheetConfig.apiToken;
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `freelance-tracker-settings-${todayStr()}.json`;
  a.click();

  if (hasToken) {
    setTimeout(() => {
      alert('✓ 設定檔已下載\n\n⚠️ 此檔案含 API Token，請小心保管：\n• 勿傳到 Email / 聊天 / 公開雲端\n• 建議放 USB、加密硬碟、或密碼管理器\n\n到新裝置：\n1. 設定頁 → 匯入設定檔（選此檔）\n2. 設定頁 → 手動從 Sheet 拉取\n3. 啟用自動同步');
    }, 100);
  } else {
    toast('✓ 設定檔已匯出（未含 Token，因為你還沒設過）');
  }
}

function importSettings(e) {
  const f = e.target.files[0];
  if (!f) return;
  e.target.value = '';  // 清空，下次選同檔案才會觸發

  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      // 驗證格式
      if (!s.sheetConfig && !s.userInfo) {
        alert('這似乎不是設定檔（缺少必要欄位）。\n\n注意：別把案件資料的 freelance-import.json 跟設定檔搞混。');
        return;
      }

      const summary = [];
      if (s.sheetConfig?.apiUrl) summary.push('• API URL + Token');
      if (s.userInfo?.name) summary.push(`• 我的資料（${s.userInfo.name}）`);
      if (s.calId) summary.push(`• Calendar 同步設定`);
      if (s.unpaidRemindDays) summary.push(`• 提醒偏好`);

      if (!confirm(`即將匯入下列設定：\n\n${summary.join('\n')}\n\n本地原本的設定會被覆蓋（資料 clients/jobs 不受影響）。\n\n匯出時間：${s._exportedAt}\n\n確定？`)) return;

      // 套用設定
      if (s.sheetConfig) config.sheetConfig = { ...config.sheetConfig, ...s.sheetConfig };
      if (s.userInfo) config.userInfo = { ...config.userInfo, ...s.userInfo };
      if (s.sheetSyncEnabled !== undefined) config.sheetSyncEnabled = s.sheetSyncEnabled;
      if (s.calId !== undefined) config.calId = s.calId;
      if (s.calEnabled !== undefined) config.calEnabled = s.calEnabled;
      if (s.calAutoSync !== undefined) config.calAutoSync = s.calAutoSync;
      if (s.unpaidRemindDays !== undefined) config.unpaidRemindDays = s.unpaidRemindDays;
      if (s.backupRemindDays !== undefined) config.backupRemindDays = s.backupRemindDays;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

      // 重新載入所有 UI
      loadUserInfoUI();
      loadSheetConfigUI();
      loadCalendarConfigUI();
      loadInvoiceStatusUI();
      updateSheetSyncBadge();
      loadReminderConfigUI();
      render();

      // 引導下一步
      const hasToken = !!config.sheetConfig?.apiToken;
      if (hasToken) {
        if (confirm('✓ 設定已匯入！\n\n下一步建議：從 Sheet 拉取最新資料到本機。\n\n要現在拉取嗎？')) {
          pullFromSheet(false);
        }
      } else {
        toast('✓ 設定已匯入');
      }
    } catch (err) {
      alert('檔案格式錯誤：' + err.message);
    }
  };
  r.readAsText(f);
}

// ============== Sheet 雙向同步 ==============
let syncTimer = null;
let syncStatus = 'idle';  // idle | syncing | synced | offline | error
let syncError = null;

function setSyncStatus(status, err) {
  syncStatus = status;
  syncError = err || null;
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  const cfg = config.sheetConfig || {};
  // 直接用日期+時間顯示，不用 hover
  const dt = cfg.cloudLastModifiedAt ? new Date(cfg.cloudLastModifiedAt) : null;
  const dtText = dt
    ? `${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ` +
      `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
    : '';
  const verText = cfg.cloudVersion ? `v${cfg.cloudVersion}` : '';
  const pendingNote = config.sheetPendingPush ? ' (待同步)' : '';

  let text = '';
  let cls = 'idle';
  let icon = '☁️';

  switch (status) {
    case 'syncing':
      icon = '⏳'; cls = 'syncing'; text = '同步中…';
      break;
    case 'synced':
      icon = '✓'; cls = 'synced';
      // 已取得最新 04-26 14:30 v123
      text = '已取得最新';
      if (dtText) text += ` ${dtText}`;
      if (verText) text += ` ${verText}`;
      break;
    case 'offline':
      icon = '⚠'; cls = 'offline';
      text = '離線' + pendingNote;
      break;
    case 'idle-paused':
      icon = '💤'; cls = 'offline';
      text = '閒置暫停' + pendingNote;
      break;
    case 'lab-paused':
      icon = '🧪'; cls = 'offline';
      text = '開發模式（不推送）';
      break;
    case 'error':
      icon = '✗'; cls = 'error'; text = '失敗';
      break;
    case 'idle':
    default:
      icon = '☁️'; cls = 'idle'; text = '未連雲端';
  }
  el.className = `sync-indicator sync-${cls}`;
  el.innerHTML = `${icon} ${text}`;

  // tooltip 顯示完整資訊
  const lines = [];
  if (cfg.cloudVersion) lines.push(`雲端版本：v${cfg.cloudVersion}`);
  if (cfg.cloudLastModifiedAt) lines.push(`雲端最新：${new Date(cfg.cloudLastModifiedAt).toLocaleString('zh-TW')}`);
  if (cfg.lastSyncAt) lines.push(`上次上傳：${new Date(cfg.lastSyncAt).toLocaleString('zh-TW')}`);
  if (cfg.lastPullAt) lines.push(`上次下載：${new Date(cfg.lastPullAt).toLocaleString('zh-TW')}`);
  if (config.cloudFirstMode) lines.push('☁️ 雲端優先模式 ON');
  if (config.autoPollEnabled !== false) lines.push('🔄 自動偵測 ON（每 30 秒）');
  if (err) lines.push(`錯誤：${err}`);
  el.title = lines.join('\n') || '尚未同步';
}

// 切換摺疊卡片
function toggleCard(cardId) {
  const card = document.getElementById(cardId);
  if (card) card.classList.toggle('collapsed');
}

async function pullFromSheet(silent = false) {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) {
    if (!silent) toast('請先填 API URL 和 Token');
    return false;
  }
  setSyncStatus('syncing');
  if (!silent) toastProgress('⬇️ 從雲端下載中...');
  try {
    const url = cfg.apiUrl + '?action=list&token=' + encodeURIComponent(cfg.apiToken);
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) {
      setSyncStatus('error', data.error);
      if (!silent) alert('拉取失敗：' + data.error);
      return false;
    }
    // 覆蓋本地（並跑 migration 確保新欄位齊全）
    state.clients = data.data.clients || [];
    state.jobs = data.data.jobs || [];
    state.schemaVersion = data.data.schemaVersion || 1;
    runMigrations(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      clients: state.clients,
      jobs: state.jobs
    }));
    config.sheetConfig.lastPullAt = data.listedAt || new Date().toISOString();
    if (data.meta) {
      config.sheetConfig.cloudVersion = +data.meta.version || 0;
      config.sheetConfig.cloudLastModifiedAt = data.meta.lastModifiedAt || data.listedAt;
      config.sheetConfig.cloudLastDevice = data.meta.lastDevice || '';
      config.sheetConfig.cloudSchemaVersion = +data.meta.schemaVersion || 0;
      config.sheetConfig.cloudAppVersion = data.meta.appVersion || '';
      // 雲端 schema 比本地新 → 程式過舊，強制提示重整
      if (config.sheetConfig.cloudSchemaVersion > CURRENT_SCHEMA_VERSION) {
        showStaleClientBanner(config.sheetConfig.cloudSchemaVersion);
      }
      // 雲端 appVersion **比本地新**才警告（避免反向誤報）
      // v2.10.1: 改用 compareAppVersion 做數字版號比較（修 v2.9 vs v2.10 字串 bug）
      if (data.meta.appVersion && compareAppVersion(data.meta.appVersion, APP_VERSION) > 0) {
        showStaleClientBanner(null, data.meta.appVersion);
      } else {
        // 本地較新或相同 → 把可能殘留的舊橫幅清掉
        document.getElementById('stale-banner')?.remove();
      }
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    setSyncStatus('synced');
    // v2.9.5: 記錄手動拉取（silent=true 為自動 polling，不寫日誌避免洗版）
    if (!silent) logAction('sync-pull', { summary: `${state.clients.length} 業主、${state.jobs.length} 案件` });
    renderAll();
    if (!silent) toast(`✓ 已下載 ${state.clients.length} 業主、${state.jobs.length} 案件`, 3500);
    return true;
  } catch (err) {
    setSyncStatus('offline', err.message);
    if (!silent) alert('網路錯誤：' + err.message);
    return false;
  }
}

async function pushToSheet(silent = false, force = false) {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) {
    if (!silent) toast('請先設定 API URL + Token');
    return false;
  }
  setSyncStatus('syncing');
  if (!silent) toastProgress('⬆️ 上傳到雲端中...');

  // 衝突保護：先比對雲端 metadata
  if (!force) {
    try {
      const metaResp = await fetch(cfg.apiUrl + '?action=getMeta&token=' + encodeURIComponent(cfg.apiToken));
      const metaData = await metaResp.json();
      if (metaData.ok && metaData.meta && metaData.meta.lastModifiedAt) {
        const cloudTime = new Date(metaData.meta.lastModifiedAt);
        const localCloudTime = cfg.cloudLastModifiedAt ? new Date(cfg.cloudLastModifiedAt) : null;
        // 雲端比本地記錄的雲端版本還新 → 有別人更新過
        if (!localCloudTime || cloudTime > localCloudTime) {
          const msg = `⚠️ 雲端有別處剛更新的資料！\n\n` +
            `雲端最新：${metaData.meta.lastModifiedAt}（裝置：${metaData.meta.lastDevice || '?'}）\n` +
            `本地記錄的雲端版本：${cfg.cloudLastModifiedAt || '從未同步'}\n\n` +
            `雲端內容：${metaData.meta.clientsCount || 0} 業主、${metaData.meta.jobsCount || 0} 案件\n\n` +
            `若直接上傳，雲端的更新會被你本地的版本覆蓋。建議先取消，按「⬇️ 從雲端下載」拉新版，再做你想做的修改。\n\n` +
            `仍要強制覆蓋？`;
          if (!silent && !confirm(msg)) {
            setSyncStatus('synced');
            toast('已取消上傳');
            return false;
          }
          if (silent) {
            // 自動 schedulePush 時不要強制覆蓋，先標記待同步
            setSyncStatus('offline', '雲端有新版');
            config.sheetPendingPush = true;
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
            return false;
          }
        }
      }
    } catch (err) {
      // 連線錯誤不擋上傳
      console.warn('Meta check failed', err);
    }
  }

  try {
    const resp = await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'save',
        token: cfg.apiToken,
        deviceLabel: getDeviceLabelForUpload(),
        snapshotNote: `from ${getDeviceLabelForUpload()}`,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: APP_VERSION,
        data: { schemaVersion: CURRENT_SCHEMA_VERSION, clients: state.clients, jobs: state.jobs }
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      // v2.2: schema 不匹配 → 強制提示重整、不再自動推送
      if (data.error === 'SCHEMA_TOO_OLD') {
        setSyncStatus('error', 'SCHEMA_TOO_OLD');
        config.sheetPendingPush = false;
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        showStaleClientBanner(data.cloudSchema);
        return false;
      }
      setSyncStatus('error', data.error);
      if (!silent) alert('推送失敗：' + data.error);
      return false;
    }
    config.sheetConfig.lastSyncAt = data.savedAt;
    if (data.meta) {
      config.sheetConfig.cloudVersion = +data.meta.version || 0;
      config.sheetConfig.cloudLastModifiedAt = data.meta.lastModifiedAt || data.savedAt;
      config.sheetConfig.cloudLastDevice = data.meta.lastDevice || getDeviceLabel();
    }
    config.sheetPendingPush = false;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    setSyncStatus('synced');
    // v2.9.5: 記錄手動推送（silent 為 schedulePush 自動觸發，不寫日誌）
    if (!silent) logAction('sync-push', { summary: `${state.clients.length} 業主、${state.jobs.length} 案件` });
    if (!silent) toast(`✓ 已上傳 ${state.clients.length} 業主、${state.jobs.length} 案件到雲端`, 3500);
    return true;
  } catch (err) {
    setSyncStatus('offline', err.message);
    config.sheetPendingPush = true;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return false;
  }
}

// ============== Idle 偵測（10 分鐘無操作 → 暫停自動 push）==============
const IDLE_THRESHOLD_MS = 10 * 60 * 1000;
let lastActivityAt = Date.now();
let idleNotified = false;

['mousedown', 'keydown', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, () => {
    const wasIdle = (Date.now() - lastActivityAt) > IDLE_THRESHOLD_MS;
    lastActivityAt = Date.now();
    idleNotified = false;
    // 從 idle 喚醒：先 pull 再清待推送旗標
    if (wasIdle && config.sheetSyncEnabled && config.sheetPendingPush) {
      pullFromSheet(true).then(() => {
        if (config.sheetPendingPush) pushToSheet(true);
      });
    }
  }, { passive: true });
});

function isIdle() {
  return (Date.now() - lastActivityAt) > IDLE_THRESHOLD_MS;
}

// ============== 編輯鎖（軟鎖，5 分鐘 TTL，60 秒 heartbeat）==============
let lockHeartbeatTimer = null;
let currentLockHolder = null;  // 當前知道的持鎖者
let myLockActive = false;

// 開啟 modal 前嘗試取鎖，被別人鎖住時用 toast 警告但不擋（讓使用者知道風險）
async function tryAcquireLockOrWarn(label) {
  const result = await acquireEditLock(label);
  if (!result.acquired && result.by) {
    const remainingMin = Math.ceil((new Date(result.expiresAt) - Date.now()) / 60000);
    toast(`⚠️ 「${result.by}」正在編輯中（剩 ${remainingMin} 分鐘）。建議等對方關閉後再操作。`, 6000);
  }
}

async function acquireEditLock(reason) {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken || !config.sheetSyncEnabled) return { acquired: true, local: true };
  try {
    const resp = await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'acquireLock',
        token: cfg.apiToken,
        deviceLabel: getDeviceLabel()
      })
    });
    const data = await resp.json();
    if (!data.ok) return { acquired: false, error: data.error };
    if (data.lock?.acquired) {
      myLockActive = true;
      currentLockHolder = getDeviceLabel();
      startLockHeartbeat();
      return { acquired: true };
    }
    // 別人持有鎖
    currentLockHolder = data.lock.by;
    return { acquired: false, by: data.lock.by, expiresAt: data.lock.expiresAt };
  } catch (err) {
    return { acquired: true, local: true };  // 連不上時放行（離線編輯）
  }
}

async function releaseEditLock() {
  stopLockHeartbeat();
  myLockActive = false;
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken || !config.sheetSyncEnabled) return;
  try {
    await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'releaseLock',
        token: cfg.apiToken,
        deviceLabel: getDeviceLabel()
      })
    });
  } catch (err) {}
}

async function forceReleaseEditLock() {
  if (!confirm(`確定要強制清除其他裝置的鎖？\n\n（如果那台 PC 還在編輯，可能會發生資料衝突）`)) return;
  const cfg = config.sheetConfig;
  try {
    await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'forceReleaseLock', token: cfg.apiToken })
    });
    toast('✓ 已強制清除鎖');
    currentLockHolder = null;
    updateSheetSyncBadge();
  } catch (err) {
    toast('清除失敗：' + err.message);
  }
}

function startLockHeartbeat() {
  stopLockHeartbeat();
  // 60 秒 heartbeat（後端 TTL 3 分鐘 → 至少有 2 次重試機會）
  lockHeartbeatTimer = setInterval(async () => {
    if (!myLockActive) return;
    const result = await acquireEditLock('heartbeat');
    if (!result.acquired && !result.local) {
      // heartbeat 失敗（鎖被別人搶走或網路斷）→ toast 警告使用者
      myLockActive = false;
      stopLockHeartbeat();
      toast(`⚠️ 編輯鎖失效${result.by ? '（被「' + result.by + '」接管）' : ''}！建議先關閉視窗檢查雲端狀態。`, 8000);
    }
  }, 60 * 1000);
}

function stopLockHeartbeat() {
  if (lockHeartbeatTimer) { clearInterval(lockHeartbeatTimer); lockHeartbeatTimer = null; }
}

// 在 page unload 時釋放鎖
window.addEventListener('beforeunload', () => {
  if (myLockActive) {
    // 用 sendBeacon 確保送出（fetch 可能會被取消）
    const cfg = config.sheetConfig;
    if (cfg?.apiUrl) {
      navigator.sendBeacon(cfg.apiUrl, JSON.stringify({
        action: 'releaseLock',
        token: cfg.apiToken,
        deviceLabel: getDeviceLabel()
      }));
    }
  }
});

// 手動 snapshot
async function manualSnapshot() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) { toast('請先設定雲端同步'); return; }
  const note = (document.getElementById('manual-snapshot-note')?.value || '').trim() || '手動備份';
  toastProgress('📸 建立 snapshot...');
  try {
    const resp = await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'manualSnapshot',
        token: cfg.apiToken,
        note,
        deviceLabel: getDeviceLabelForUpload()
      })
    });
    const data = await resp.json();
    if (data.ok && data.result) {
      toast('✓ 已建立手動備份（永久保留）');
      const noteInput = document.getElementById('manual-snapshot-note');
      if (noteInput) noteInput.value = '';
    } else {
      toast('建立失敗：' + (data.error || '未知錯誤'));
    }
  } catch (err) {
    toast('錯誤：' + err.message);
  }
}

// 觸發每日 trigger 設定
async function setupDailyForceTrigger() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) { toast('請先設定雲端同步'); return; }
  if (!confirm(`設定每日凌晨 03:00 自動建立強制 snapshot？\n\n首次設定會要求 Apps Script 授權 trigger 權限。`)) return;
  toastProgress('⏰ 建立 trigger...');
  try {
    const resp = await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'setupDailyTrigger', token: cfg.apiToken })
    });
    const data = await resp.json();
    if (data.ok) toast('✓ 每日強制 snapshot 已啟用（每天 03:00）', 4000);
    else toast('設定失敗：' + data.error);
  } catch (err) {
    toast('錯誤：' + err.message);
  }
}

function schedulePush() {
  // 只有「啟用自動同步」狀態下才會自動推
  if (!config.sheetSyncEnabled) return;
  // Lab/開發模式 → 完全停止任何 push（避免測試影響雲端）
  if (isLabMode()) {
    setSyncStatus('lab-paused');
    return;
  }
  // Idle 保護：超過 10 分鐘無互動就先標記待推送，等使用者回來再推
  if (isIdle()) {
    config.sheetPendingPush = true;
    if (!idleNotified) {
      setSyncStatus('idle-paused');
      idleNotified = true;
    }
    return;
  }
  clearTimeout(syncTimer);
  setSyncStatus('syncing');
  syncTimer = setTimeout(() => pushToSheet(true), 2000);
}

// ============== 暗色模式 ==============
const THEME_KEY = 'ftTheme_v1';

function applyTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  let theme = saved;
  if (!saved || saved === 'auto') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  // 更新 theme-color meta（手機網址列顏色跟著變）
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1115' : '#3b82f6');
}

function setTheme(mode) {
  // 'auto' / 'light' / 'dark'
  localStorage.setItem(THEME_KEY, mode);
  applyTheme();
  loadThemeUI();
  updateThemeToggleIcon();
  toast(`✓ 主題：${ {auto: '自動（跟隨系統）', light: '淺色', dark: '深色'}[mode] }`);
}

// v2.7.4: 標題列圖示按一下循環切換 auto → light → dark
function cycleTheme() {
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
  setTheme(next);
}

function updateThemeToggleIcon() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  // v2.10.5：顯示「主題:淺色/深色/系統」
  const label = cur === 'auto' ? '系統' : (cur === 'dark' ? '深色' : '淺色');
  btn.textContent = `主題:${label}`;
  btn.title = `目前主題：${label}（點擊循環切換 系統 → 淺色 → 深色）`;
}

function loadThemeUI() {
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  document.querySelectorAll('[name="theme-mode"]').forEach(r => {
    r.checked = (r.value === cur);
  });
}

// 啟動時立刻套用（避免閃白）
applyTheme();
// 系統色模式變更時即時切換（auto 模式才有效）+ 同步圖示
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') {
      applyTheme();
      updateThemeToggleIcon();
    }
  });
}

// ============== 全域搜尋 ==============
function onGlobalSearch() {
  const q = (document.getElementById('global-search')?.value || '').trim().toLowerCase();
  const box = document.getElementById('global-search-results');
  if (!box) return;
  if (!q) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  // 業主比對
  const matchClient = (c) => {
    return (c.name || '').toLowerCase().includes(q) ||
           (c.note || '').toLowerCase().includes(q);
  };
  // 案件比對
  const matchJob = (j) => {
    return (j.title || '').toLowerCase().includes(q) ||
           (j.details || '').toLowerCase().includes(q) ||
           (j.tag || '').toLowerCase().includes(q);
  };
  const clients = state.clients.filter(matchClient).slice(0, 10);
  const jobs = state.jobs.filter(matchJob).slice(0, 30);
  let html = '';
  if (clients.length) {
    html += `<div class="gs-section">業主（${clients.length}）</div>`;
    html += clients.map(c => `
      <div class="gs-row" onclick="globalSearchClickClient('${c.id}')">
        <div class="gs-title">${highlightMatch(c.name, q)}</div>
        ${c.note ? `<div class="gs-meta">${highlightMatch((c.note || '').slice(0, 60), q)}</div>` : ''}
      </div>
    `).join('');
  }
  if (jobs.length) {
    html += `<div class="gs-section">案件（${jobs.length}）</div>`;
    html += jobs.map(j => {
      const c = getClient(j.clientId);
      return `
        <div class="gs-row" onclick="globalSearchClickJob('${j.id}')">
          <div class="gs-title">${highlightMatch(j.title || '(無標題)', q)} <span style="color:var(--muted); font-weight:400;">${j.amount ? fmt(j.amount) : ''}</span></div>
          <div class="gs-meta">${escapeHtml(c?.name || '?')} · ${j.date || '無日期'}${j.tag ? ' · ' + highlightMatch(j.tag, q) : ''}</div>
        </div>
      `;
    }).join('');
  }
  if (!clients.length && !jobs.length) {
    html = '<div class="gs-empty">沒有找到符合「' + escapeHtml(q) + '」的結果</div>';
  }
  box.innerHTML = html;
  box.classList.remove('hidden');
}

function highlightMatch(text, q) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  if (!q) return escaped;
  const reg = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  return escaped.replace(reg, m => `<mark>${m}</mark>`);
}

function globalSearchClickClient(cid) {
  closeGlobalSearch();
  switchTab('clients');
  // 滾到該業主
  setTimeout(() => {
    const el = document.querySelector(`[data-client-card="${cid}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

function globalSearchClickJob(jid) {
  closeGlobalSearch();
  switchTab('jobs');
  setTimeout(() => editJob(jid), 100);
}

function closeGlobalSearch() {
  const box = document.getElementById('global-search-results');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  const input = document.getElementById('global-search');
  if (input) input.value = '';
}

// 點擊外部關閉搜尋下拉
document.addEventListener('click', (e) => {
  const bar = document.querySelector('.global-search-bar');
  if (bar && !bar.contains(e.target)) {
    document.getElementById('global-search-results')?.classList.add('hidden');
  }
});

// ============== Lab / 開發模式（暫停同步）==============
const LAB_MODE_KEY = 'ftLabMode_v1';
function isLabMode() { return localStorage.getItem(LAB_MODE_KEY) === '1'; }
function toggleLabMode() {
  const next = !isLabMode();
  localStorage.setItem(LAB_MODE_KEY, next ? '1' : '0');
  document.getElementById('lab-mode-banner')?.remove();
  if (next) {
    showLabModeBanner();
    toast('🧪 開發模式已啟用：暫停所有雲端 push（pull 仍會自動進行）', 5000);
  } else {
    toast('✓ 開發模式已關閉，恢復雲端同步', 4000);
  }
  setSyncStatus(isLabMode() ? 'lab-paused' : (config.sheetSyncEnabled ? 'synced' : 'idle'));
  updateLabModeUI();
}
function showLabModeBanner() {
  if (document.getElementById('lab-mode-banner')) return;
  const div = document.createElement('div');
  div.id = 'lab-mode-banner';
  div.style.cssText = 'position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:#ea580c; color:#fff; padding:10px 16px; border-radius:24px; box-shadow:0 4px 16px rgba(0,0,0,0.2); font-size:13px; z-index:9999; cursor:pointer;';
  div.innerHTML = '🧪 開發模式 — 不會推到雲端 · 點此關閉';
  div.onclick = toggleLabMode;
  document.body.appendChild(div);
}
function updateLabModeUI() {
  const cb = document.getElementById('cfg-lab-mode');
  if (cb) cb.checked = isLabMode();
  if (isLabMode()) showLabModeBanner();
  else document.getElementById('lab-mode-banner')?.remove();
}

// ============== 過時客戶端橫幅（schema/version 不匹配時）==============
function showStaleClientBanner(cloudSchema, cloudAppVer) {
  if (document.getElementById('stale-banner')) return;
  const div = document.createElement('div');
  div.id = 'stale-banner';
  div.style.cssText = 'position:fixed; top:0; left:0; right:0; background:#dc2626; color:#fff; padding:14px 20px; text-align:center; font-size:14px; font-weight:600; z-index:10000; box-shadow:0 2px 8px rgba(0,0,0,0.25);';
  let msg;
  if (cloudSchema) {
    msg = `⚠️ 雲端資料結構已更新到 v${cloudSchema}（你目前 v${CURRENT_SCHEMA_VERSION}），請重整網頁取得新版以避免資料遺失。`;
  } else {
    msg = `🆕 偵測到別台 PC 推送了新版 (${cloudAppVer})，目前你是舊版，請重整網頁。`;
  }
  div.innerHTML = `${msg} <a onclick="location.reload(true)" style="margin-left:12px; color:#fff; text-decoration:underline; cursor:pointer;">立即重整</a>`;
  document.body.appendChild(div);
  // 同時禁用自動 push（避免覆蓋）
  config.sheetPendingPush = false;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// 裝置標籤：每台 PC 自己存在 localStorage（不上雲）
// 注意：瀏覽器沙盒禁止讀取 OS 的電腦名稱（如 Windows 的 hostname），
// 所以採用「OS 偵測 + 自動產生唯一識別碼」的折衷方案。
// 使用者可在設定頁改成有意義的名字（例如「工作室 Win」）。
const DEVICE_NAME_KEY = 'ftDeviceName_v1';
const DEVICE_AUTO_KEY = 'ftDeviceAutoId_v1';

function getOsLabel() {
  const ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Win/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function getOrGenerateAutoId() {
  let auto = localStorage.getItem(DEVICE_AUTO_KEY);
  if (!auto) {
    // 短碼：4 個英數字，每台 PC 唯一
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    auto = `${getOsLabel()}-${rand}`;
    localStorage.setItem(DEVICE_AUTO_KEY, auto);
  }
  return auto;
}

function getDeviceLabel() {
  // 1. 使用者自訂的名字優先
  const custom = localStorage.getItem(DEVICE_NAME_KEY);
  if (custom && custom.trim()) return custom.trim();
  // 2. 否則用自動產生的 OS-XXXX
  return getOrGenerateAutoId();
}

function setDeviceName(name) {
  if (!name || !name.trim()) {
    localStorage.removeItem(DEVICE_NAME_KEY);
    toast(`已清除自訂名稱（將顯示為 ${getOrGenerateAutoId()}）`);
  } else {
    localStorage.setItem(DEVICE_NAME_KEY, name.trim());
    toast(`✓ 裝置名稱：${name.trim()}`);
  }
  loadDeviceNameUI();
  updateSheetSyncBadge();
}

function loadDeviceNameUI() {
  const input = document.getElementById('cfg-device-name');
  if (input) input.value = localStorage.getItem(DEVICE_NAME_KEY) || '';
  // 顯示目前生效的識別 + 位置資訊
  const hint = document.getElementById('cfg-device-name-current');
  if (hint) {
    const loc = cachedDeviceLocation || {};
    let locText = '';
    if (loc.preciseCity || loc.preciseDistrict) {
      locText = `🎯 精確：${loc.preciseCity || ''} ${loc.preciseDistrict || ''}`;
    } else if (loc.city) {
      locText = `📍 IP 城市：${loc.city}`;
    } else {
      locText = '📍 位置：尚未取得';
    }
    hint.innerHTML = `目前識別：<b>${escapeHtml(getDeviceLabel())}</b><br>${locText}` +
      (loc.ip ? ` · IP ${loc.ip}` : '');
  }
}

// ============== IP + 地理位置（24 小時快取）==============
const DEVICE_LOCATION_KEY = 'ftDeviceLocation_v1';
let cachedDeviceLocation = null;

async function fetchDeviceLocation() {
  // 24 小時快取
  try {
    const cached = localStorage.getItem(DEVICE_LOCATION_KEY);
    if (cached) {
      const obj = JSON.parse(cached);
      if (Date.now() - obj.fetchedAt < 24 * 60 * 60 * 1000) {
        cachedDeviceLocation = obj;
        return obj;
      }
    }
  } catch (_) {}
  // 呼叫 ipapi.co（HTTPS 免金鑰）
  try {
    const resp = await fetch('https://ipapi.co/json/');
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.ip) return null;
    const loc = {
      ip: data.ip,
      city: data.city || '',
      region: data.region || '',
      country: data.country_name || '',
      isp: (data.org || '').slice(0, 40),
      fetchedAt: Date.now()
    };
    localStorage.setItem(DEVICE_LOCATION_KEY, JSON.stringify(loc));
    cachedDeviceLocation = loc;
    return loc;
  } catch (err) {
    return null;  // 抓不到就算了，不擋主流程
  }
}

// 給上傳/snapshot 用：附加地理位置（裝置名 @ 城市 區 IP）
function getDeviceLabelForUpload() {
  const base = getDeviceLabel();
  const loc = cachedDeviceLocation;
  if (!loc) return base;
  const ip = loc.ip ? ` ${loc.ip}` : '';
  // 優先用精確位置（GPS 反向地理編碼）
  if (loc.preciseCity || loc.preciseDistrict) {
    const parts = [loc.preciseCity, loc.preciseDistrict].filter(Boolean).join(' ');
    return `${base} @ ${parts}${ip}`;
  }
  // 退回 IP 城市（不到區）
  const where = loc.city || loc.country;
  if (where) return `${base} @ ${where}${ip}`;
  return base + ip;
}

// 使用 HTML5 Geolocation 取得精確位置 + BigDataCloud 反向地理編碼
async function requestPreciseLocation() {
  if (!navigator.geolocation) {
    toast('這個瀏覽器不支援精確定位');
    return;
  }
  toastProgress('🎯 請在瀏覽器跳出的視窗按「允許」...');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    try {
      // BigDataCloud 免金鑰、HTTPS、支援繁中
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh-TW`;
      const resp = await fetch(url);
      const data = await resp.json();
      const district = data.locality || (data.localityInfo?.administrative || []).slice(-1)[0]?.name || '';
      const city = data.city || data.principalSubdivision || '';

      const loc = cachedDeviceLocation || {};
      loc.preciseCity = city;
      loc.preciseDistrict = district;
      loc.preciseLat = +lat.toFixed(3);
      loc.preciseLng = +lng.toFixed(3);
      loc.preciseFetchedAt = Date.now();
      cachedDeviceLocation = loc;
      localStorage.setItem(DEVICE_LOCATION_KEY, JSON.stringify(loc));

      toast(`✓ 精確位置：${city} ${district}`, 4000);
      updateSheetSyncBadge();
      loadDeviceNameUI();
    } catch (err) {
      toast('反向地理編碼失敗：' + err.message);
    }
  }, (err) => {
    let msg = '無法取得位置';
    if (err.code === 1) msg = '使用者拒絕授權';
    else if (err.code === 2) msg = '位置服務無法使用（可能未開 GPS）';
    else if (err.code === 3) msg = '取得位置超時';
    toast('❌ ' + msg, 4000);
  }, { timeout: 15000, maximumAge: 60 * 60 * 1000, enableHighAccuracy: false });
}

// 清除精確位置（之後又會退回 IP 城市）
function clearPreciseLocation() {
  if (cachedDeviceLocation) {
    delete cachedDeviceLocation.preciseCity;
    delete cachedDeviceLocation.preciseDistrict;
    delete cachedDeviceLocation.preciseLat;
    delete cachedDeviceLocation.preciseLng;
    delete cachedDeviceLocation.preciseFetchedAt;
    localStorage.setItem(DEVICE_LOCATION_KEY, JSON.stringify(cachedDeviceLocation));
  }
  toast('已清除精確位置（改用 IP 城市）');
  loadDeviceNameUI();
}

// ============== 裝置名稱提醒 modal ==============
const DEVICE_PROMPT_DISMISSED_KEY = 'ftDeviceNamePromptDismissed_v1';

function maybeShowDeviceNamePrompt() {
  // 已設過名稱 → 不顯示
  if (localStorage.getItem(DEVICE_NAME_KEY)) return;
  // 已經跳過 → 不再煩
  if (localStorage.getItem(DEVICE_PROMPT_DISMISSED_KEY) === 'true') return;
  // 還沒啟用同步 → 不需要顯示（沒設備衝突）
  if (!config.sheetSyncEnabled) return;
  // 顯示
  const modal = document.getElementById('device-name-prompt-modal');
  if (!modal) return;
  const hint = document.getElementById('device-name-prompt-current');
  if (hint) hint.textContent = `現在使用的自動識別：${getOrGenerateAutoId()}`;
  document.getElementById('device-name-prompt-input').value = '';
  modal.classList.add('open');
}

function saveDeviceNameFromPrompt() {
  const val = document.getElementById('device-name-prompt-input').value.trim();
  if (!val) {
    toast('請輸入裝置名稱，或選「先跳過」');
    return;
  }
  setDeviceName(val);
  document.getElementById('device-name-prompt-modal').classList.remove('open');
}

function skipDeviceNamePrompt() {
  localStorage.setItem(DEVICE_PROMPT_DISMISSED_KEY, 'true');
  document.getElementById('device-name-prompt-modal').classList.remove('open');
  toast('已跳過。設定頁可隨時更改裝置名稱。', 4000);
}

async function enableSheetSync() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) {
    alert('請先設定 Apps Script URL 並測試連線成功');
    return;
  }

  // 防呆：先檢查雲端有沒有資料
  toastProgress('🔍 檢查雲端狀態...');
  let cloudHasData = false;
  let cloudMeta = null;
  try {
    const metaResp = await fetch(cfg.apiUrl + '?action=getMeta&token=' + encodeURIComponent(cfg.apiToken));
    const metaData = await metaResp.json();
    if (metaData.ok && metaData.meta) {
      cloudMeta = metaData.meta;
      cloudHasData = (+metaData.meta.jobsCount || 0) > 0 || (+metaData.meta.clientsCount || 0) > 0;
    }
  } catch (err) {
    console.warn('Meta check failed', err);
  }

  // 若雲端有資料但本地沒同步過 → 強制先 pull（避免覆蓋）
  if (cloudHasData && !cfg.cloudLastModifiedAt) {
    const pullFirst = confirm(
      '⚠️ 安全提示：雲端已經有資料，但你這台裝置從沒下載過！\n\n' +
      `雲端：${cloudMeta.clientsCount || 0} 業主、${cloudMeta.jobsCount || 0} 案件\n` +
      `本地：${state.clients.length} 業主、${state.jobs.length} 案件\n\n` +
      '建議流程：\n' +
      '1. 先「⬇️ 從雲端下載」拉雲端資料\n' +
      '2. 確認資料正確再啟用自動同步\n\n' +
      '直接按「確定」會自動先下載 → 再啟用同步\n' +
      '按「取消」可改手動操作'
    );
    if (!pullFirst) return;
    const pulled = await pullFromSheet(false);
    if (!pulled) return;
  }

  const msg =
    '【啟用雲端自動同步】\n\n' +
    `本地：${state.clients.length} 業主、${state.jobs.length} 案件\n` +
    (cloudMeta ? `雲端：${cloudMeta.clientsCount || 0} 業主、${cloudMeta.jobsCount || 0} 案件\n` : '') +
    '\n啟用後每次改動 2 秒內自動同步。\n推送前會檢查雲端是否有更新，避免覆蓋別處改動。\n\n確定？';
  if (!confirm(msg)) return;

  config.sheetSyncEnabled = true;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

  const ok = await pushToSheet(false);
  if (ok) {
    updateSheetSyncBadge();
    toast('✓ 自動同步已啟用！', 3500);
  } else {
    config.sheetSyncEnabled = false;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }
}

function disableSheetSync() {
  if (!confirm('停用後，本地資料就不會再自動推送到 Sheet。\nSheet 上的資料保留不動。\n\n確定？')) return;
  config.sheetSyncEnabled = false;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  setSyncStatus('idle');
  updateSheetSyncBadge();
  toast('已停用自動同步');
}

function updateSheetSyncBadge() {
  const el = document.getElementById('sheet-sync-status');
  if (!el) return;
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl) {
    el.textContent = '未連接';
    el.style.color = 'var(--muted)';
  } else if (!config.sheetSyncEnabled) {
    el.textContent = '已關閉';
    el.style.color = 'var(--muted)';
  } else {
    el.textContent = '✓ 已連雲端';
    el.style.color = 'var(--success)';
  }
}

async function showSnapshotList() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) { alert('請先設定 API URL'); return; }
  toastProgress('📂 讀取備份歷史中...');
  try {
    const url = cfg.apiUrl + '?action=listSnapshots&token=' + encodeURIComponent(cfg.apiToken);
    const resp = await fetch(url);
    const data = await resp.json();
    toastDismiss();
    if (!data.ok) { alert('讀取失敗：' + data.error); return; }
    const list = data.snapshots || [];

    const box = document.getElementById('snapshot-list-modal');
    if (!list.length) {
      box.innerHTML = '<div class="empty"><div style="font-size: 13px;">目前沒有備份紀錄</div></div>';
    } else {
      box.innerHTML = list.map((s, i) => {
        const stats = s.stats || {};
        const cls = i === 0 ? 'recent' : '';
        const tag = i === 0 ? '<span class="badge-status paid" style="margin-left: 6px;">最新</span>' : '';
        // Tier 標籤顏色
        const tierMap = {
          'force':   { label: '🔒 每日強制', color: 'var(--primary)', bg: 'var(--primary-light)' },
          'manual':  { label: '✋ 手動', color: 'var(--success)', bg: 'var(--success-light)' },
          'restore': { label: '↩️ 還原前', color: 'var(--warning)', bg: 'var(--warning-light)' },
          'auto':    { label: '⚙️ 自動', color: 'var(--muted)', bg: 'var(--bg)' },
          'legacy':  { label: '📦 舊版', color: 'var(--muted)', bg: 'var(--bg)' }
        };
        const tier = tierMap[s.tier] || tierMap.auto;
        const tierBadge = `<span style="background:${tier.bg}; color:${tier.color}; padding:1px 6px; border-radius:4px; font-size:11px; font-weight:600;">${tier.label}</span>`;
        const deviceText = s.device ? ` · ${escapeHtml(s.device)}` : '';
        // 資料大小警告（>= 160KB 接近 4 欄拆分上限 180KB）
        const dataSize = s.dataSize || 0;
        const sizeKB = Math.round(dataSize / 1024);
        const sizeWarn = dataSize > 160 * 1024
          ? ` <span style="color: var(--warning);">⚠️ ${sizeKB} KB</span>`
          : (dataSize > 0 ? ` <span style="color: var(--muted); font-size: 11px;">${sizeKB} KB</span>` : '');
        return `<div class="snapshot-row ${cls}">
          <div class="snapshot-info">
            <div class="snapshot-time">${s.timestamp}${tag} ${tierBadge}${sizeWarn}</div>
            <div class="snapshot-stats">
              ${stats.clients || 0} 業主 · ${stats.jobs || 0} 案件 · 總額 ${fmt(stats.totalAmount || 0)}${deviceText}
            </div>
            <div class="snapshot-stats">${escapeHtml(s.note || '—')}</div>
            <div class="snapshot-stats" style="font-family: monospace;">ID: ${s.id}</div>
          </div>
          <div class="snapshot-actions">
            <button class="btn btn-outline btn-sm" onclick="previewSnapshot('${s.id}')">👁️ 預覽</button>
            <button class="btn btn-primary btn-sm" onclick="restoreSnapshot('${s.id}')">⏮️ 還原</button>
          </div>
        </div>`;
      }).join('');
    }
    document.getElementById('snapshot-modal').classList.add('open');
    toast('✓ 載入 ' + list.length + ' 筆備份');
  } catch (err) {
    alert('錯誤：' + err.message);
  }
}

// 預覽特定 snapshot 內容
// ============== 操作日誌 UI（v2.9.5）==============
function openActionLogModal() {
  // 填類型 select
  const typeSel = document.getElementById('log-filter-type');
  if (typeSel) {
    const usedTypes = [...new Set(actionLog.map(l => l.type))].sort();
    typeSel.innerHTML = '<option value="all">全部類型</option>' +
      usedTypes.map(t => `<option value="${t}">${(ACTION_LABELS[t]?.icon || '')} ${ACTION_LABELS[t]?.label || t}</option>`).join('');
  }
  // 填業主 select（只列 log 中出現過的）
  const clientSel = document.getElementById('log-filter-client');
  if (clientSel) {
    const usedClientIds = new Set();
    actionLog.forEach(l => { if (l.details?.clientId) usedClientIds.add(l.details.clientId); });
    const opts = ['<option value="all">全部業主</option>'];
    state.clients.forEach(c => {
      if (usedClientIds.has(c.id)) opts.push(`<option value="${c.id}">${escapeHtml(c.name)}</option>`);
    });
    clientSel.innerHTML = opts.join('');
  }
  document.getElementById('action-log-count').textContent = actionLog.length;
  renderActionLog();
  document.getElementById('action-log-modal').classList.add('open');
}

function clearActionLog() {
  if (!confirm('確定清空所有操作日誌？（無法復原，但不影響業主/案件資料）')) return;
  actionLog = [];
  saveActionLog();
  renderActionLog();
  toast('已清空操作日誌');
}

function fmtLogTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function fmtLogDateLabel(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const that = new Date(d); that.setHours(0,0,0,0);
  const diffDays = Math.round((today - that) / 86400000);
  if (diffDays === 0) return '📅 今天';
  if (diffDays === 1) return '📅 昨天';
  return `📅 ${d.getMonth()+1}/${d.getDate()}`;
}

function renderActionLog() {
  const box = document.getElementById('action-log-list');
  if (!box) return;
  const ft = document.getElementById('log-filter-type')?.value || 'all';
  const fc = document.getElementById('log-filter-client')?.value || 'all';
  const fd = document.getElementById('log-filter-date')?.value || 'all';

  const now = Date.now();
  let cutoff = 0;
  if (fd === 'today') {
    const t = new Date(); t.setHours(0,0,0,0);
    cutoff = t.getTime();
  } else if (fd === 'yesterday') {
    const t = new Date(); t.setDate(t.getDate() - 1); t.setHours(0,0,0,0);
    const e = new Date(t); e.setHours(23,59,59,999);
    cutoff = t.getTime();
    // 篩選時也要排除今天的（特殊處理在 filter）
  } else if (fd === 'week') {
    cutoff = now - 7 * 86400000;
  } else if (fd === 'month') {
    cutoff = now - 30 * 86400000;
  }

  let list = [...actionLog].reverse();  // 最新在前
  if (ft !== 'all') list = list.filter(l => l.type === ft);
  if (fc !== 'all') list = list.filter(l => l.details?.clientId === fc);
  if (fd === 'today') list = list.filter(l => l.ts >= cutoff);
  else if (fd === 'yesterday') {
    const yStart = new Date(); yStart.setDate(yStart.getDate() - 1); yStart.setHours(0,0,0,0);
    const yEnd = new Date(yStart); yEnd.setHours(23,59,59,999);
    list = list.filter(l => l.ts >= yStart.getTime() && l.ts <= yEnd.getTime());
  }
  else if (fd === 'week' || fd === 'month') list = list.filter(l => l.ts >= cutoff);

  if (!list.length) {
    box.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--muted); font-size: 13px;">沒有符合條件的操作紀錄</div>';
    return;
  }

  // 依日期分組
  const groups = {};
  list.forEach(l => {
    const key = fmtLogDateLabel(l.ts);
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  });

  box.innerHTML = Object.entries(groups).map(([dateLabel, items]) => {
    const rows = items.map(l => {
      const meta = ACTION_LABELS[l.type] || { icon: '·', label: l.type };
      const d = l.details || {};
      let primary = '';
      let secondary = '';
      let onClick = '';
      // 文字內容
      if (l.type.startsWith('job-')) {
        primary = `「${escapeHtml(d.title || '(無標題)')}」`;
        if (d.amount != null) primary += ` ${fmt(d.amount)}`;
        secondary = d.clientName ? `(${escapeHtml(d.clientName)})` : '';
        if (d.jobId && state.jobs.find(j => j.id === d.jobId)) onClick = `editJob('${d.jobId}'); document.getElementById('action-log-modal').classList.remove('open');`;
      } else if (l.type.startsWith('client-')) {
        primary = `「${escapeHtml(d.name || '?')}」`;
        if (d.clientId && state.clients.find(c => c.id === d.clientId)) onClick = `editClient('${d.clientId}'); document.getElementById('action-log-modal').classList.remove('open');`;
      } else if (l.type.startsWith('bulk-')) {
        primary = `${d.count || 0} 筆`;
        if (d.amount != null) primary += ` (${fmt(d.amount)})`;
      } else if (l.type === 'sync-pull' || l.type === 'sync-push') {
        primary = d.summary ? escapeHtml(d.summary) : '';
      } else if (l.type === 'snapshot-restore') {
        primary = d.snapshotId ? `ID ${d.snapshotId}` : '';
      } else if (l.type === 'data-import') {
        primary = d.summary || '';
      }
      const arrow = onClick ? `<button class="btn btn-ghost btn-sm" onclick="${onClick}" style="padding: 0 8px; color: var(--primary);">→</button>` : '';
      return `<div style="display: flex; gap: 6px; align-items: center; padding: 5px 0; border-bottom: 1px dashed var(--border);">
        <span style="color: var(--muted); min-width: 42px; font-family: monospace; font-size: 12px;">${fmtLogTime(l.ts)}</span>
        <span style="min-width: 18px; text-align: center;">${meta.icon}</span>
        <span style="flex: 1; min-width: 0;">${escapeHtml(meta.label)} ${primary} <span style="color: var(--muted); font-size: 12px;">${secondary}</span></span>
        ${arrow}
      </div>`;
    }).join('');
    return `<div style="margin-bottom: 10px;">
      <div style="font-size: 12px; color: var(--muted); padding: 4px 0; border-bottom: 1px solid var(--border); font-weight: 600;">${dateLabel} (${items.length})</div>
      ${rows}
    </div>`;
  }).join('');
}

// ============== Snapshot Diff（v2.9.5）==============
const SNAPSHOT_FIELD_LABELS = {
  // 業主
  name: '名稱', color: '顏色', note: '備註',
  commissionRate: '抽成%', commissionTo: '介紹人',
  prepaidMode: '儲值制', prepayments: '儲值紀錄',
  billingDay: '請款日', billingRemindDays: '請款日提前提醒',
  unpaidRemindDaysOverride: '未收款提醒天數',
  // 案件
  title: '標題', clientId: '業主', date: '日期', endDate: '截止日',
  details: '說明', amount: '金額', tag: '類型',
  done: '完成', doneAt: '完成日', paid: '已收款', paidAt: '收款日',
  cancelled: '已取消', isEstimate: '估價單',
  hoursWorked: '工時', timeSpentMs: '計時器累計',
  discountType: '折扣類型', discountValue: '折扣值',
  payments: '收款紀錄', writeOff: '呆帳',
  subtasks: '子任務'
};

const CLIENT_FIELDS = ['name','color','note','commissionRate','commissionTo','prepaidMode','prepayments','billingDay','billingRemindDays','unpaidRemindDaysOverride'];
const JOB_FIELDS    = ['title','clientId','date','endDate','details','amount','tag','done','doneAt','paid','paidAt','cancelled','isEstimate','hoursWorked','timeSpentMs','discountType','discountValue','payments','writeOff','subtasks'];

function diffFields_(a, b, fields) {
  const diff = {};
  fields.forEach(f => {
    const av = a?.[f];
    const bv = b?.[f];
    const isObj = (typeof av === 'object' && av !== null) || (typeof bv === 'object' && bv !== null);
    if (isObj) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) diff[f] = { before: av, after: bv };
    } else if (av !== bv) {
      // 把 undefined 跟空字串等價處理，避免雜訊
      if ((av === undefined || av === null || av === '') && (bv === undefined || bv === null || bv === '')) return;
      diff[f] = { before: av, after: bv };
    }
  });
  return diff;
}

function computeSnapshotDiff(currentClients, currentJobs, snapClients, snapJobs) {
  const result = {
    clients: { added: [], removed: [], changed: [] },
    jobs:    { added: [], removed: [], changed: [] }
  };
  const curC = new Map((currentClients || []).map(c => [c.id, c]));
  const snapC = new Map((snapClients || []).map(c => [c.id, c]));
  const curJ = new Map((currentJobs || []).map(j => [j.id, j]));
  const snapJ = new Map((snapJobs || []).map(j => [j.id, j]));

  (snapClients || []).forEach(c => {
    if (!curC.has(c.id)) result.clients.added.push(c);
    else {
      const fd = diffFields_(curC.get(c.id), c, CLIENT_FIELDS);
      if (Object.keys(fd).length) result.clients.changed.push({ id: c.id, before: curC.get(c.id), after: c, fieldDiff: fd });
    }
  });
  (currentClients || []).forEach(c => { if (!snapC.has(c.id)) result.clients.removed.push(c); });

  (snapJobs || []).forEach(j => {
    if (!curJ.has(j.id)) result.jobs.added.push(j);
    else {
      const fd = diffFields_(curJ.get(j.id), j, JOB_FIELDS);
      if (Object.keys(fd).length) result.jobs.changed.push({ id: j.id, before: curJ.get(j.id), after: j, fieldDiff: fd });
    }
  });
  (currentJobs || []).forEach(j => { if (!snapJ.has(j.id)) result.jobs.removed.push(j); });

  return result;
}

function formatDiffValue_(field, value, snapClients) {
  if (value === undefined || value === null || value === '') return '<i style="color:var(--muted);">(空)</i>';
  if (Array.isArray(value)) {
    if (field === 'payments' || field === 'prepayments') {
      const total = value.reduce((s, p) => s + (+p.amount || 0), 0);
      return `${value.length} 筆 (${fmt(total)})`;
    }
    if (field === 'subtasks') {
      const done = value.filter(s => s.done).length;
      return `${value.length} 項 (${done} 完成)`;
    }
    return JSON.stringify(value).slice(0, 60);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (field === 'clientId') {
    const c = (snapClients || state.clients).find(x => x.id === value);
    return c ? escapeHtml(c.name) : `<i style="color:var(--muted);">(未知)</i>`;
  }
  if (field === 'discountType') return ({ none: '無', fixed: '折扣金額', percent: '折扣百分比' })[value] || value;
  return escapeHtml(String(value));
}

function renderFieldDiffHtml(fieldDiff, snapClients) {
  return Object.keys(fieldDiff).map(f => {
    const label = SNAPSHOT_FIELD_LABELS[f] || f;
    const before = formatDiffValue_(f, fieldDiff[f].before, snapClients);
    const after = formatDiffValue_(f, fieldDiff[f].after, snapClients);
    return `<div style="font-size: 12px; padding: 2px 0;">
      <span style="color: var(--muted);">${label}</span>:
      <span style="color: var(--danger); text-decoration: line-through;">${before}</span>
      →
      <span style="color: var(--success);">${after}</span>
    </div>`;
  }).join('');
}

async function previewSnapshot(id) {
  const cfg = config.sheetConfig;
  toastProgress('📂 載入預覽...');
  try {
    const resp = await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'getSnapshot', token: cfg.apiToken, snapshotId: id })
    });
    const data = await resp.json();
    if (!data.ok) {
      // v2.9.3: JSON 解析失敗（之前 4-chunk 截斷的舊 snapshot）→ 友善提示
      if (data.error && data.error.includes('Snapshot 解析失敗')) {
        alert('⚠️ 此 snapshot 已損壞（之前 4-chunk 上限導致截斷，無法還原）\n\n以後新的 snapshot（10-chunk 上限）不會再有此問題。\n\n建議：刪除此筆並用最近建立的 snapshot 還原。');
        return;
      }
      alert('失敗：' + data.error);
      return;
    }
    const snap = data.snapshot;
    const d = snap.data;
    const snapClients = d.clients || [];
    const snapJobs = d.jobs || [];

    // v2.9.5: 計算 diff
    const diff = computeSnapshotDiff(state.clients, state.jobs, snapClients, snapJobs);
    showSnapshotDiffModal(snap, snapClients, snapJobs, diff, id);
    toast('');
  } catch (err) {
    alert('錯誤：' + err.message);
  }
}

// v2.9.5: Snapshot diff 預覽 modal
const DIFF_PREVIEW_LIMIT = 10;

function showSnapshotDiffModal(snap, snapClients, snapJobs, diff, snapshotId) {
  const curTotalAmt = state.jobs.reduce((s,j) => s + (+j.amount || 0), 0);
  const snapTotalAmt = snapJobs.reduce((s,j) => s + (+j.amount || 0), 0);
  const totalDelta = snapTotalAmt - curTotalAmt;
  const deltaSign = totalDelta > 0 ? '+' : (totalDelta < 0 ? '−' : '');

  const tierLabels = { force: '🔒 每日強制', manual: '✋ 手動', restore: '↩️ 還原前', auto: '⚙️ 自動', legacy: '📦 舊版' };
  const tierLabel = tierLabels[snap.tier] || snap.tier || '';

  const clientName = (id, sourceClients) => {
    const c = (sourceClients || state.clients).find(x => x.id === id);
    return c ? escapeHtml(c.name) : `<i style="color:var(--muted);">(未知)</i>`;
  };

  const renderJobRow = (j, sourceClients) => {
    return `<li style="padding: 3px 0;">${j.date || '-'} ${escapeHtml(j.title || '(無標題)')} ${fmt(+j.amount||0)} <span style="color:var(--muted);">${clientName(j.clientId, sourceClients)}</span></li>`;
  };

  const addedClientsHtml = diff.clients.added.length
    ? `<ul style="margin: 4px 0 0 12px; font-size: 12px;">${diff.clients.added.slice(0, DIFF_PREVIEW_LIMIT).map(c => `<li>${escapeHtml(c.name)}</li>`).join('')}${diff.clients.added.length > DIFF_PREVIEW_LIMIT ? `<li style="color:var(--muted);">…還有 ${diff.clients.added.length - DIFF_PREVIEW_LIMIT} 位</li>` : ''}</ul>`
    : '';
  const addedJobsHtml = diff.jobs.added.length
    ? `<ul style="margin: 4px 0 0 12px; font-size: 12px;">${diff.jobs.added.slice(0, DIFF_PREVIEW_LIMIT).map(j => renderJobRow(j, snapClients)).join('')}${diff.jobs.added.length > DIFF_PREVIEW_LIMIT ? `<li style="color:var(--muted);">…還有 ${diff.jobs.added.length - DIFF_PREVIEW_LIMIT} 筆</li>` : ''}</ul>`
    : '';

  const removedClientsHtml = diff.clients.removed.length
    ? `<ul style="margin: 4px 0 0 12px; font-size: 12px;">${diff.clients.removed.slice(0, DIFF_PREVIEW_LIMIT).map(c => `<li>${escapeHtml(c.name)}</li>`).join('')}${diff.clients.removed.length > DIFF_PREVIEW_LIMIT ? `<li style="color:var(--muted);">…還有 ${diff.clients.removed.length - DIFF_PREVIEW_LIMIT} 位</li>` : ''}</ul>`
    : '';
  const removedJobsHtml = diff.jobs.removed.length
    ? `<ul style="margin: 4px 0 0 12px; font-size: 12px;">${diff.jobs.removed.slice(0, DIFF_PREVIEW_LIMIT).map(j => renderJobRow(j, state.clients)).join('')}${diff.jobs.removed.length > DIFF_PREVIEW_LIMIT ? `<li style="color:var(--muted);">…還有 ${diff.jobs.removed.length - DIFF_PREVIEW_LIMIT} 筆</li>` : ''}</ul>`
    : '';

  const changedClientsHtml = diff.clients.changed.length
    ? diff.clients.changed.slice(0, DIFF_PREVIEW_LIMIT).map(c => `
        <div style="margin-top: 8px; padding: 6px; background: var(--bg); border-radius: 6px;">
          <div style="font-weight: 600; font-size: 13px;">${escapeHtml(c.before.name || c.after.name)}</div>
          ${renderFieldDiffHtml(c.fieldDiff, snapClients)}
        </div>`).join('') + (diff.clients.changed.length > DIFF_PREVIEW_LIMIT ? `<div style="color:var(--muted); font-size: 12px; margin-top: 4px;">…還有 ${diff.clients.changed.length - DIFF_PREVIEW_LIMIT} 位</div>` : '')
    : '';
  const changedJobsHtml = diff.jobs.changed.length
    ? diff.jobs.changed.slice(0, DIFF_PREVIEW_LIMIT).map(j => `
        <div style="margin-top: 8px; padding: 6px; background: var(--bg); border-radius: 6px;">
          <div style="font-weight: 600; font-size: 13px;">${j.after.date || j.before.date || '-'} ${escapeHtml(j.after.title || j.before.title || '')} <span style="font-weight: 400; color: var(--muted);">${clientName(j.after.clientId || j.before.clientId, snapClients)}</span></div>
          ${renderFieldDiffHtml(j.fieldDiff, snapClients)}
        </div>`).join('') + (diff.jobs.changed.length > DIFF_PREVIEW_LIMIT ? `<div style="color:var(--muted); font-size: 12px; margin-top: 4px;">…還有 ${diff.jobs.changed.length - DIFF_PREVIEW_LIMIT} 筆</div>` : '')
    : '';

  const html = `
    <div style="font-size: 13px; color: var(--muted); margin-bottom: 8px;">
      ${snap.timestamp}　${snap.dataSize ? Math.round(snap.dataSize / 1024) + ' KB' : ''}　${tierLabel}　${escapeHtml(snap.device || '')}
    </div>

    <div style="background: var(--bg); padding: 10px; border-radius: 8px; margin-bottom: 12px;">
      <div style="font-size: 12px; color: var(--muted); margin-bottom: 4px;">數字差異</div>
      <table style="width: 100%; font-size: 13px;">
        <tr><td>業主</td><td style="text-align: right;">${state.clients.length}</td><td style="text-align: center; color: var(--muted);">→</td><td style="text-align: right;"><b>${snapClients.length}</b></td><td style="text-align: right; color: ${snapClients.length === state.clients.length ? 'var(--muted)' : (snapClients.length < state.clients.length ? 'var(--danger)' : 'var(--success)')};">(${snapClients.length - state.clients.length >= 0 ? '+' : ''}${snapClients.length - state.clients.length})</td></tr>
        <tr><td>案件</td><td style="text-align: right;">${state.jobs.length}</td><td style="text-align: center; color: var(--muted);">→</td><td style="text-align: right;"><b>${snapJobs.length}</b></td><td style="text-align: right; color: ${snapJobs.length === state.jobs.length ? 'var(--muted)' : (snapJobs.length < state.jobs.length ? 'var(--danger)' : 'var(--success)')};">(${snapJobs.length - state.jobs.length >= 0 ? '+' : ''}${snapJobs.length - state.jobs.length})</td></tr>
        <tr><td>總額</td><td style="text-align: right;">${fmt(curTotalAmt)}</td><td style="text-align: center; color: var(--muted);">→</td><td style="text-align: right;"><b>${fmt(snapTotalAmt)}</b></td><td style="text-align: right; color: ${totalDelta === 0 ? 'var(--muted)' : (totalDelta < 0 ? 'var(--danger)' : 'var(--success)')};">(${deltaSign}${fmt(Math.abs(totalDelta)).replace('NT$','').trim()})</td></tr>
      </table>
    </div>

    <div style="margin-bottom: 8px;">
      <details ${diff.clients.added.length + diff.jobs.added.length > 0 ? 'open' : ''} style="background: var(--success-light); padding: 8px; border-radius: 6px; margin-bottom: 6px;">
        <summary style="cursor: pointer; font-size: 13px; font-weight: 600; color: var(--success);">
          🟢 還原後會「復活」：${diff.clients.added.length} 業主、${diff.jobs.added.length} 案件
        </summary>
        ${diff.clients.added.length ? `<div style="margin-top: 6px;"><b style="font-size: 12px;">業主：</b>${addedClientsHtml}</div>` : ''}
        ${diff.jobs.added.length ? `<div style="margin-top: 6px;"><b style="font-size: 12px;">案件：</b>${addedJobsHtml}</div>` : ''}
        ${!diff.clients.added.length && !diff.jobs.added.length ? '<div style="font-size: 12px; color: var(--muted); margin-top: 4px;">（無）</div>' : ''}
      </details>

      <details style="background: var(--danger-light); padding: 8px; border-radius: 6px; margin-bottom: 6px;">
        <summary style="cursor: pointer; font-size: 13px; font-weight: 600; color: var(--danger);">
          🔴 還原後會「消失」：${diff.clients.removed.length} 業主、${diff.jobs.removed.length} 案件
        </summary>
        ${diff.clients.removed.length ? `<div style="margin-top: 6px;"><b style="font-size: 12px;">業主：</b>${removedClientsHtml}</div>` : ''}
        ${diff.jobs.removed.length ? `<div style="margin-top: 6px;"><b style="font-size: 12px;">案件：</b>${removedJobsHtml}</div>` : ''}
        ${!diff.clients.removed.length && !diff.jobs.removed.length ? '<div style="font-size: 12px; color: var(--muted); margin-top: 4px;">（無）</div>' : ''}
      </details>

      <details style="background: var(--warning-light); padding: 8px; border-radius: 6px;">
        <summary style="cursor: pointer; font-size: 13px; font-weight: 600; color: var(--warning);">
          🟡 還原後會「變動」：${diff.clients.changed.length} 業主、${diff.jobs.changed.length} 案件
        </summary>
        ${diff.clients.changed.length ? `<div style="margin-top: 6px;"><b style="font-size: 12px;">業主變動：</b>${changedClientsHtml}</div>` : ''}
        ${diff.jobs.changed.length ? `<div style="margin-top: 6px;"><b style="font-size: 12px;">案件變動：</b>${changedJobsHtml}</div>` : ''}
        ${!diff.clients.changed.length && !diff.jobs.changed.length ? '<div style="font-size: 12px; color: var(--muted); margin-top: 4px;">（無）</div>' : ''}
      </details>
    </div>

    <div style="font-size: 12px; color: var(--muted); padding: 6px; background: var(--bg); border-radius: 6px; margin-bottom: 8px;">
      ⚠️ 還原前會自動把現在的資料先備份起來（restore tier，永久保留）
    </div>
  `;

  const box = document.getElementById('snapshot-diff-content');
  if (box) box.innerHTML = html;
  document.getElementById('snapshot-diff-confirm-btn').onclick = () => {
    document.getElementById('snapshot-diff-modal').classList.remove('open');
    restoreSnapshot(snapshotId);
  };
  document.getElementById('snapshot-diff-modal').classList.add('open');
}

async function restoreSnapshot(id) {
  const cfg = config.sheetConfig;
  if (!confirm(`即將還原 snapshot: ${id}\n\nSheet 當前內容會先備份再還原。\n還原後，本地會重新從 Sheet 拉取。\n\n確定？`)) return;
  toastProgress('⏳ 還原中，請勿關閉視窗...');
  try {
    const resp = await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'restoreSnapshot', token: cfg.apiToken, snapshotId: id })
    });
    const data = await resp.json();
    if (!data.ok) { alert('還原失敗：' + data.error); return; }
    logAction('snapshot-restore', { snapshotId: id, restoredAt: data.result.restoredAt, clientCount: data.result.clientCount, jobCount: data.result.jobCount });
    alert(`✓ 已還原\n\n還原時間：${data.result.restoredAt}\n業主：${data.result.clientCount} 位\n案件：${data.result.jobCount} 筆\n\n即將重新拉取資料到本地。`);
    await pullFromSheet(false);
  } catch (err) {
    alert('錯誤：' + err.message);
  }
}

// ============== 網頁版本偵測 ==============
// APP_VERSION 已在檔案頂端宣告（v2.2 新增）；此處不再重複宣告
const APP_VERSION_KEY = 'freelance-tracker-app-version';
let serverAppVersion = null;  // 由 pollAppVersion 更新，給 UI 顯示用

// v2.7.5+: 終極強制刷新 — 清掉所有可能讓網頁卡舊版的東西
// （但保留 localStorage 業主案件設定）
// v2.10.10: 加保險超時（清快取卡住也會 reload）+ skipWaiting message + 最後 fallback 用 reload(true)
async function hardReload() {
  toastProgress('🔄 清除快取中…');
  console.log('[hardReload] start');

  // 全程最多 4 秒，超時就直接強制 reload，避免任何 await 卡死害用戶以為「沒反應」
  const SAFETY_MS = 4000;
  let done = false;
  const safetyTimer = setTimeout(() => {
    if (done) return;
    console.warn('[hardReload] safety timeout — forcing reload');
    forceReload();
  }, SAFETY_MS);

  function forceReload() {
    done = true;
    clearTimeout(safetyTimer);
    // 用 query string 破 HTTP / SW cache，replace 避免 history 殘留
    const url = location.pathname + '?_=' + Date.now() + '&hr=1';
    try {
      location.replace(url);
    } catch (_) {
      // 最後 fallback：reload(true)（有些瀏覽器仍支援 forced reload）
      try { location.reload(true); } catch (_) { location.href = url; }
    }
  }

  // 1. 叫所有 SW skipWaiting + unregister（不 await 太久，超時就放）
  try {
    if ('serviceWorker' in navigator) {
      const regs = await Promise.race([
        navigator.serviceWorker.getRegistrations(),
        new Promise(r => setTimeout(() => r([]), 1500))
      ]);
      regs.forEach(r => {
        try { r.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
      });
      await Promise.race([
        Promise.all(regs.map(r => r.unregister())),
        new Promise(r => setTimeout(r, 1500))
      ]);
    }
  } catch (err) { console.error('[hardReload] SW step failed:', err); }

  // 2. 刪除所有 Cache API 快取
  try {
    if ('caches' in window) {
      const keys = await Promise.race([
        caches.keys(),
        new Promise(r => setTimeout(() => r([]), 1000))
      ]);
      await Promise.race([
        Promise.all(keys.map(k => caches.delete(k))),
        new Promise(r => setTimeout(r, 1000))
      ]);
    }
  } catch (err) { console.error('[hardReload] cache delete failed:', err); }

  // 3. 清空 sessionStorage（不動 localStorage）
  try { sessionStorage.clear(); } catch (_) {}

  // 4. 清掉 cookies（這個網域下的）
  try {
    document.cookie.split(';').forEach(c => {
      const eq = c.indexOf('=');
      const name = (eq > -1 ? c.slice(0, eq) : c).trim();
      if (!name) return;
      const expire = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
      document.cookie = `${name}=; ${expire}; path=/`;
      document.cookie = `${name}=; ${expire}; path=${location.pathname}`;
      document.cookie = `${name}=; ${expire}; path=/; domain=${location.hostname}`;
      document.cookie = `${name}=; ${expire}; path=/; domain=.${location.hostname}`;
    });
  } catch (_) {}

  // 5. 嘗試清掉 IndexedDB（部分瀏覽器支援，不卡 reload）
  try {
    if (indexedDB && indexedDB.databases) {
      await Promise.race([
        indexedDB.databases().then(dbs => Promise.all(dbs.map(db => new Promise(resolve => {
          const req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = req.onerror = req.onblocked = resolve;
        })))),
        new Promise(r => setTimeout(r, 1000))
      ]);
    }
  } catch (_) {}

  console.log('[hardReload] cleanup done — reloading');
  forceReload();
}

// 更新 header 的版本標籤
function updateVersionBadge() {
  const el = document.getElementById('app-version-badge');
  if (!el) return;
  const local = APP_VERSION.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  // v2.10.1: 改用 compareAppVersion 做數字版號比較
  if (serverAppVersion && compareAppVersion(serverAppVersion, APP_VERSION) > 0) {
    const remote = serverAppVersion.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    el.innerHTML = `${local} · <span style="color: var(--warning); font-weight: 600;">🆕 ${remote} 點此更新</span>`;
    el.style.cursor = 'pointer';
  } else {
    el.innerHTML = `${local} · <span style="color: var(--muted);">最新</span>`;
    el.style.cursor = 'pointer';
    el.title = '點擊強制刷新（清除快取）';
  }
}

function checkAppVersionUpdate() {
  // 啟動時：如果 localStorage 有舊版本記錄且不同 → 提示
  const lastSeen = localStorage.getItem(APP_VERSION_KEY);
  if (lastSeen && lastSeen !== APP_VERSION) {
    setTimeout(() => {
      toast(`✨ APP 已更新到 ${APP_VERSION}`, 4000);
    }, 1000);
  }
  localStorage.setItem(APP_VERSION_KEY, APP_VERSION);
}

// 每 5 分鐘 fetch 一次自己的 HTML 比對版本
async function pollAppVersion() {
  try {
    const resp = await fetch(location.href, { cache: 'no-store' });
    const html = await resp.text();
    const match = html.match(/<meta name="app-version" content="([^"]+)"/);
    if (!match) return;
    serverAppVersion = match[1];
    updateVersionBadge();
    // v2.10.1: 改用 compareAppVersion 做數字版號比較（修 v2.9 vs v2.10 字串 bug）
    if (compareAppVersion(serverAppVersion, APP_VERSION) > 0) {
      const remind = document.getElementById('version-remind');
      if (!remind) {
        const div = document.createElement('div');
        div.id = 'version-remind';
        div.className = 'version-remind';
        div.innerHTML = `🆕 APP 有新版本（${serverAppVersion}），<a onclick="hardReload()" style="color:#fff;text-decoration:underline;cursor:pointer;">點此強制更新</a>`;
        document.body.appendChild(div);
      }
    } else {
      // 本地 >= 伺服器 → 移除可能殘留的橫幅
      document.getElementById('version-remind')?.remove();
    }
  } catch (err) {
    // 靜默失敗
  }
}

// ============== 雲端優先模式 + 自動 polling ==============
function saveCloudFirstMode() {
  config.cloudFirstMode = document.getElementById('cloud-first').checked;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  toast(config.cloudFirstMode ? '✓ 雲端優先模式已啟用' : '已關閉雲端優先模式');
  if (config.cloudFirstMode && !config.sheetSyncEnabled) {
    if (confirm('雲端優先需要搭配「自動同步」一起使用。\n\n要現在啟用自動同步嗎？')) {
      enableSheetSync();
    }
  }
}

function saveAutoPollToggle() {
  config.autoPollEnabled = document.getElementById('auto-poll-toggle').checked;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  setupAutoPoll();
  toast(config.autoPollEnabled ? '✓ 已啟用自動偵測（每 30 秒）' : '已關閉自動偵測');
}

let autoPollTimer = null;
function setupAutoPoll() {
  if (autoPollTimer) { clearInterval(autoPollTimer); autoPollTimer = null; }
  if (!config.autoPollEnabled) return;
  if (!config.sheetConfig?.apiUrl || !config.sheetConfig?.apiToken) return;
  autoPollTimer = setInterval(checkCloudForUpdate, 30 * 1000);
}

async function checkCloudForUpdate() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) return;
  if (syncStatus === 'syncing') return;  // 別跟正在進行的同步衝突
  try {
    const resp = await fetch(cfg.apiUrl + '?action=getMeta&token=' + encodeURIComponent(cfg.apiToken));
    const data = await resp.json();
    if (!data.ok || !data.meta) return;
    const cloudVer = +data.meta.version || 0;
    const localCloudVer = +cfg.cloudVersion || 0;
    if (cloudVer > localCloudVer) {
      // 雲端有新版本
      toast(`☁️ 雲端有新版本 (v${cloudVer})，自動下載中...`, 3500);
      await pullFromSheet(true);
      toast(`✓ 已同步雲端最新（v${cloudVer}）`, 3500);
    }
  } catch (err) {
    // 靜默失敗
  }
}

// ============== Apps Script 後端（Sheet URL + API URL）==============
function loadSheetConfigUI() {
  const g = (id) => document.getElementById(id);
  if (!g('sheet-api')) return;
  g('sheet-api').value = config.sheetConfig?.apiUrl || '';
  g('sheet-url').value = config.sheetConfig?.sheetUrl || '';
  loadDeviceNameUI();
  updateLabModeUI();
  // 雲端優先 + 自動偵測已強制永久開啟，無 UI
}

function saveSheetConfig() {
  config.sheetConfig = config.sheetConfig || {};
  config.sheetConfig.apiUrl = document.getElementById('sheet-api').value.trim();
  config.sheetConfig.sheetUrl = document.getElementById('sheet-url').value.trim();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  toast('✓ 已儲存');
}

async function testSheetConnection() {
  const apiUrl = document.getElementById('sheet-api').value.trim();
  if (!apiUrl) { toast('請先填入 API URL'); return; }
  const token = prompt('請輸入 API Token');
  if (!token) return;
  toastProgress('🔌 正在測試雲端連線...');
  try {
    const resp = await fetch(apiUrl + '?action=ping&token=' + encodeURIComponent(token));
    const data = await resp.json();
    if (data.ok) {
      config.sheetConfig = config.sheetConfig || {};
      config.sheetConfig.apiUrl = apiUrl;
      config.sheetConfig.apiToken = token;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      alert(`✓ 連線成功！\n\n伺服器時間：${data.time}\n\nToken 已記錄，之後不用再輸入。`);
    } else {
      alert('✗ 連線失敗：' + data.error);
    }
  } catch (err) {
    alert('✗ 連線錯誤：' + err.message);
  }
}

// ============== Google Calendar 同步 ==============

/**
 * 解析 calReminderMode 為實際的提醒分鐘數
 *   'follow'  → dueSoonDays * 1440
 *   '0'       → 0（不提醒）
 *   '60' 等   → 60
 *   未設定    → 預設 follow → dueSoonDays * 1440
 */
function getCalReminderMinutes() {
  const mode = config.calReminderMode || 'follow';
  if (mode === 'follow') {
    const days = Math.max(1, +config.dueSoonDays || 3);
    return days * 24 * 60;
  }
  const n = +mode;
  return isNaN(n) ? (3 * 24 * 60) : Math.max(0, n);
}

function describeCalReminder() {
  const min = getCalReminderMinutes();
  if (min === 0) return '不提醒';
  if (min < 60) return `${min} 分鐘前`;
  if (min < 1440) return `${Math.round(min / 60)} 小時前`;
  const days = Math.round(min / 1440 * 10) / 10;
  return `${days} 天前`;
}

function loadCalendarConfigUI() {
  const g = (id) => document.getElementById(id);
  if (g('cal-enabled')) g('cal-enabled').checked = !!config.calEnabled;
  if (g('cal-id')) g('cal-id').value = config.calId || '';
  if (g('cal-autosync')) g('cal-autosync').checked = !!config.calAutoSync;
  // 提醒模式
  if (g('cal-reminder-mode')) {
    g('cal-reminder-mode').value = config.calReminderMode || 'follow';
  }
  updateCalendarReminderHint();
  updateCalendarStatusBadge();
  renderCalendarSyncStatus();
}

function updateCalendarReminderHint() {
  const hint = document.getElementById('cal-reminder-hint');
  if (!hint) return;
  const days = +config.dueSoonDays || 3;
  const desc = describeCalReminder();
  hint.innerHTML = `目前提醒：<b>${desc}</b>　·　套用範圍：Google 行事曆同步事件、iCal 訂閱通知<br><span style="font-size: 11px;">「跟隨即將到期」目前對應 ${days} 天前（在「提醒設定」可調整）</span>`;
}

function updateCalendarStatusBadge() {
  const badge = document.getElementById('cal-status-badge');
  if (!badge) return;
  if (!config.calId) {
    badge.textContent = '未設定';
    badge.style.color = 'var(--muted)';
  } else if (!config.calEnabled) {
    badge.textContent = '已關閉';
    badge.style.color = 'var(--muted)';
  } else {
    badge.textContent = '✓ 同步中';
    badge.style.color = 'var(--success)';
  }
}

function renderCalendarSyncStatus() {
  const el = document.getElementById('cal-sync-status');
  if (!el) return;
  if (!config.calLastSyncAt) {
    el.innerHTML = '<span style="color: var(--muted);">尚未同步過</span>';
    return;
  }
  const when = config.calLastSyncAt;
  const count = config.calLastSyncCount || 0;
  el.innerHTML = `✓ 上次同步：${when}　已建立 ${count} 個事件`;
}

function saveCalendarConfig() {
  config.calEnabled = document.getElementById('cal-enabled').checked;
  config.calId = document.getElementById('cal-id').value.trim();
  config.calAutoSync = document.getElementById('cal-autosync').checked;
  const reminderEl = document.getElementById('cal-reminder-mode');
  if (reminderEl) config.calReminderMode = reminderEl.value || 'follow';
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  updateCalendarStatusBadge();
  updateCalendarReminderHint();
  toast('✓ 已儲存設定');
}

async function testCalendarConnection() {
  const calId = document.getElementById('cal-id').value.trim();
  if (!calId) { toast('請先填入 Calendar ID'); return; }
  const apiUrl = (config.sheetConfig && config.sheetConfig.apiUrl) || '';
  if (!apiUrl) {
    alert('請先到「進階設定 → ☁️ 雲端同步」填入 Apps Script API URL 並測試連線成功。\n\n（行事曆同步需要透過後端執行）');
    return;
  }
  const token = prompt('請輸入 API Token（首次測試時填，之後會記下來）', config.sheetConfig?.apiToken || '');
  if (!token) return;

  toastProgress('🔌 正在測試行事曆連線...');
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'testCalendar', token, calendarId: calId })
    });
    const data = await resp.json();
    if (data.ok) {
      // 儲存 token
      config.sheetConfig = config.sheetConfig || {};
      config.sheetConfig.apiToken = token;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      alert(`✓ 連線成功！\n\nCalendar 名稱：${data.result.name}\n時區：${data.result.timezone}\n擁有者：${data.result.ownedBy}`);
    } else {
      alert('✗ 連線失敗：\n\n' + data.error);
    }
  } catch (err) {
    alert('✗ 連線錯誤：\n\n' + err.message + '\n\n請檢查 Apps Script URL 是否正確。');
  }
}

/**
 * v2.10.2：建立「提醒事件」清單
 * 把 App 提醒設定裡所有 enabled 的提醒類型，產生為要送上 Google Calendar 的事件
 * 各事件帶 type 標記，後端可分類 emoji/顏色
 *
 * 回傳：[{ date: 'YYYY-MM-DD', type, title, desc }]
 *   type: 'overdue' | 'unpaid-long' | 'month-end' | 'billing-day' | 'slow-pay'
 */
function buildReminderEvents() {
  const events = [];
  const today = todayStr();
  const active = activeJobs();
  const clientById = {};
  state.clients.forEach(c => { clientById[c.id] = c; });
  const fmtMoney = (n) => 'NT$' + (+n || 0).toLocaleString();

  // 1. 完成已久未收款 → 在 doneAt + N 天當天建提醒
  if (config.enableUnpaidLongAlert !== false) {
    active.forEach(j => {
      if (!j.done || j.paid || !j.doneAt) return;
      const c = clientById[j.clientId];
      const days = (c?.unpaidRemindDaysOverride != null) ? c.unpaidRemindDaysOverride : (config.unpaidRemindDays || 7);
      const remindDate = addDays(new Date(j.doneAt), days);
      events.push({
        date: remindDate,
        type: 'unpaid-long',
        title: `🟠 ${c?.name || '?'} 已完成 ${days} 天仍未收款：${j.title}`,
        desc: `業主：${c?.name || '?'}\n案件：${j.title}\n金額：${fmtMoney(j.amount)}\n完成日：${j.doneAt}\n— App 提醒：完成已久未收款 —`
      });
    });
  }

  // 2. 月底提醒：未來 12 個月，每月 day N 建一個事件
  if (config.enableMonthEndAlert !== false) {
    const startDay = config.monthEndReminderDay || 25;
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const dt = new Date(now.getFullYear(), now.getMonth() + i, startDay);
      // 處理月份天數不足
      if (dt.getMonth() !== ((now.getMonth() + i) % 12 + 12) % 12) continue;
      if (dt < new Date(today)) continue;
      events.push({
        date: toDateStr(dt),
        type: 'month-end',
        title: `📅 月底提醒：可開始整理請款`,
        desc: `每月 ${startDay} 號之後可開始整理本月可請款案件\n— App 提醒：月底提醒 —`
      });
    }
  }

  // 3. 業主固定請款日：每個有 billingDay 的業主，未來 12 個月建月度提醒
  if (config.enableBillingDayAlert !== false) {
    const now = new Date();
    state.clients.forEach(c => {
      if (!c.billingDay || c.billingDay < 1 || c.billingDay > 31) return;
      const remindDays = +c.billingRemindDays || 3;
      for (let i = 0; i < 12; i++) {
        let billingDate = new Date(now.getFullYear(), now.getMonth() + i, c.billingDay);
        // 處理月份天數不足（例如 2 月 31 號 → 該月最後一天）
        if (billingDate.getMonth() !== ((now.getMonth() + i) % 12 + 12) % 12) {
          billingDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
        }
        const remindDate = addDays(billingDate, -remindDays);  // 已是 YYYY-MM-DD 字串
        if (remindDate < today) continue;
        events.push({
          date: remindDate,
          type: 'billing-day',
          title: `📋 ${c.name} 請款日提醒（${billingDate.getMonth()+1}/${c.billingDay} 前 ${remindDays} 天）`,
          desc: `業主：${c.name}\n固定請款日：每月 ${c.billingDay} 號\n請於 ${toDateStr(billingDate)} 前送出請款單\n— App 提醒：業主固定請款日 —`
        });
      }
    });
  }

  // 4. 智慧拖款警告：命中今天，建今日提醒
  if (config.enableSlowPayAlert !== false) {
    const slowJobs = computeSlowPayJobs(active);
    slowJobs.forEach(j => {
      const c = clientById[j.clientId];
      events.push({
        date: today,
        type: 'slow-pay',
        title: `🐢 拖款警告：${c?.name || '?'} - ${j.title}`,
        desc: `業主：${c?.name || '?'}\n案件：${j.title}\n金額：${fmtMoney(j.amount)}\n完成日：${j.doneAt}\n已過 ${j.daysSince} 天（該業主平均 ${j.avgDays} 天）\n— App 提醒：智慧拖款警告 —`
      });
    });
  }

  return events;
}

// 工具：Date → 'YYYY-MM-DD'
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function syncCalendarNow() {
  const calId = document.getElementById('cal-id').value.trim();
  if (!calId) { toast('請先填入 Calendar ID'); return; }
  const apiUrl = (config.sheetConfig && config.sheetConfig.apiUrl) || '';
  if (!apiUrl) {
    alert('請先到「進階設定 → ☁️ 雲端同步」填入 Apps Script API URL');
    return;
  }
  let token = config.sheetConfig?.apiToken;
  if (!token) {
    token = prompt('請輸入 API Token');
    if (!token) return;
  }

  if (!confirm(`即將同步 ${state.jobs.length} 筆案件到 Calendar。\n\n注意：會先刪除 Calendar 上所有由本工具建立的舊事件，再重新建立。\n\n確定？`)) return;

  toastProgress('📅 同步行事曆中（可能需要 10-30 秒）...');
  try {
    const reminderMinutes = getCalReminderMinutes();
    // v2.10.2: 額外把 App 提醒（完成已久未收款 / 月底 / 業主請款日 / 智慧拖款）一起送上行事曆
    const reminderEvents = buildReminderEvents();
    // 也把 enableOverdueAlert 開關傳給後端，讓主事件能依此標記 🔴
    const enableOverdue = config.enableOverdueAlert !== false;
    const resp = await fetch(apiUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'syncCalendar',
        token,
        calendarId: calId,
        jobs: state.jobs,
        clients: state.clients,
        reminderMinutes: reminderMinutes,
        reminderEvents: reminderEvents,
        enableOverdue: enableOverdue
      })
    });
    const data = await resp.json();
    if (data.ok) {
      const r = data.result;
      config.calLastSyncAt = new Date().toLocaleString('zh-TW');
      config.calLastSyncCount = r.created;
      config.sheetConfig = config.sheetConfig || {};
      config.sheetConfig.apiToken = token;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      renderCalendarSyncStatus();
      const remPart = r.reminderCreated > 0 ? `\n建立提醒事件：${r.reminderCreated} 個` : '';
      alert(`✓ 同步完成！\n\nCalendar：${r.calendarName}\n刪除舊事件：${r.deleted} 個\n建立案件事件：${r.created} 個${remPart}${r.errors?.length ? '\n\n錯誤：\n' + r.errors.slice(0, 3).join('\n') : ''}`);
    } else {
      alert('✗ 同步失敗：\n\n' + data.error);
    }
  } catch (err) {
    alert('✗ 同步錯誤：\n\n' + err.message);
  }
}

// ============== 初次使用引導 ==============
function maybeShowOnboarding() {
  // 條件：完全乾淨（無業主、無案件、無 Sheet 設定）+ 沒看過
  const isClean = state.clients.length === 0 && state.jobs.length === 0;
  const noSheet = !config.sheetConfig?.apiUrl;
  const notSeen = !config.onboardingDone;
  if (isClean && noSheet && notSeen) {
    document.getElementById('onboarding-modal').classList.add('open');
  }
}

function onboardingChoose(choice) {
  document.getElementById('onboarding-modal').classList.remove('open');
  config.onboardingDone = true;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

  if (choice === 'import-settings') {
    document.getElementById('settings-import-file').click();
    switchTab('settings');
  } else if (choice === 'demo') {
    loadDemo();
  } else if (choice === 'blank') {
    switchTab('settings');
    setTimeout(() => {
      const myinfo = document.getElementById('card-myinfo');
      if (myinfo && myinfo.classList.contains('collapsed')) myinfo.classList.remove('collapsed');
      toast('💡 建議先到「我的資料」填寫姓名與匯款資訊');
    }, 300);
  }
}

function showOnboardingAgain() {
  document.getElementById('onboarding-modal').classList.add('open');
}

// ============== 自動儲存（設定頁的 input 失焦自動存）==============
function setupAutoSave() {
  // 我的資料：6 個欄位 + 1 個 textarea
  ['me-name', 'me-phone', 'me-email', 'me-title', 'me-bank', 'me-account', 'me-note'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('blur', () => {
      // 自動觸發儲存（不顯示 toast，靜默）
      if (typeof saveUserInfo === 'function') {
        config.userInfo = config.userInfo || {};
        config.userInfo[id.replace('me-', '').replace('title', 'invoiceTitle').replace('account', 'account')] = el.value.trim();
        // 統一用 saveUserInfo 比較簡單
        const tmpToast = window.toast;
        window.toast = () => {};  // 暫時關掉 toast
        saveUserInfo();
        window.toast = tmpToast;
      }
    });
  });

  // 提醒設定
  const unpaidEl = document.getElementById('cfg-unpaid-days-input');
  if (unpaidEl) unpaidEl.addEventListener('blur', () => {
    const tmpToast = window.toast;
    window.toast = () => {};
    saveConfig();
    window.toast = tmpToast;
  });

  // Sheet 設定
  ['sheet-api', 'sheet-url'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('blur', () => {
      const tmpToast = window.toast;
      window.toast = () => {};
      saveSheetConfig();
      window.toast = tmpToast;
    });
  });

  // Calendar 設定
  const calIdEl = document.getElementById('cal-id');
  if (calIdEl) calIdEl.addEventListener('blur', () => {
    const tmpToast = window.toast;
    window.toast = () => {};
    saveCalendarConfig();
    window.toast = tmpToast;
  });
  const calEnabledEl = document.getElementById('cal-enabled');
  if (calEnabledEl) calEnabledEl.addEventListener('change', () => saveCalendarConfig());
  const calAutoEl = document.getElementById('cal-autosync');
  if (calAutoEl) calAutoEl.addEventListener('change', () => saveCalendarConfig());
  const calReminderEl = document.getElementById('cal-reminder-mode');
  if (calReminderEl) calReminderEl.addEventListener('change', () => saveCalendarConfig());
}

// ============== Init ==============
load();
loadActionLog();   // v2.9.5
loadReminderConfigUI();   // v2.7.9: 提醒設定（取代舊的單欄）
loadUserInfoUI();
loadSheetConfigUI();
loadCalendarConfigUI();
loadInvoiceStatusUI();   // v2.10.4: 請款單狀態篩選
updateSheetSyncBadge();
buildRangeOptions();
setupAutoSave();
checkAppVersionUpdate();
updateVersionBadge();           // v2.7.5: 先把當前版號顯示出來
setTimeout(pollAppVersion, 2000);  // 啟動 2 秒後檢查一次（不擋首次載入）
setInterval(pollAppVersion, 5 * 60 * 1000);  // 每 5 分鐘檢查網頁新版
renderAll();  // 啟動時全部畫一次

// 啟動時抓 IP 地理位置（24h 快取，失敗不擋）
fetchDeviceLocation();

// v2.2: 月初自動產生月報 snapshot（每月 1～3 號開頁時，且當月還沒產過）
function maybeGenerateMonthlySnapshot() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken || !config.sheetSyncEnabled) return;
  if (isLabMode()) return;
  const now = new Date();
  if (now.getDate() > 3) return;  // 只在 1~3 號跑（給跨日緩衝）
  const monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const lastKey = localStorage.getItem('ftLastMonthlyReport_v1');
  if (lastKey === monthKey) return;  // 本月已產過

  // 上個月的數字
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lmKey = lastMonth.getFullYear() + '-' + String(lastMonth.getMonth() + 1).padStart(2, '0');
  const lmJobs = state.jobs.filter(j => !j.cancelled && getMonth(jobBelongMonth(j)) === lmKey);
  const total = lmJobs.reduce((s,j) => s + jobFinalAmount(j), 0);
  const paid = lmJobs.reduce((s,j) => s + jobPaidTotal(j), 0);
  const note = `${lmKey} 月報：${lmJobs.length} 案件、總額 ${fmt(total)}、已收 ${fmt(paid)}、未收 ${fmt(total - paid)}`;

  fetch(cfg.apiUrl, {
    method: 'POST',
    body: JSON.stringify({
      action: 'manualSnapshot',
      token: cfg.apiToken,
      note: '[monthly] ' + note,
      deviceLabel: getDeviceLabelForUpload()
    })
  }).then(r => r.json()).then(data => {
    if (data.ok) {
      localStorage.setItem('ftLastMonthlyReport_v1', monthKey);
      toast('📊 已自動產生 ' + lmKey + ' 月報備份', 5000);
    }
  }).catch(() => {});
}

// v2.2: 啟動時套用主題 + Lab Mode UI
loadThemeUI();
updateThemeToggleIcon();
updateLabModeUI();
updateNotifUI();
// v2.5: 開頁掃一次推通知（一天一次）
setTimeout(maybeFireNotifications, 4000);

// 啟動時若同步已啟用，自動從 Sheet 拉取最新資料
if (config.sheetSyncEnabled && config.sheetConfig?.apiUrl && config.sheetConfig?.apiToken) {
  setTimeout(async () => {
    const ok = await pullFromSheet(true);
    if (config.cloudFirstMode && !ok) {
      toast('⚠️ 雲端優先模式：無法連線雲端，目前為唯讀狀態', 5000);
      setSyncStatus('offline', '雲端優先模式 - 唯讀中');
    }
    setupAutoPoll();
    // 同步運作後再提醒設裝置名（避免新使用者一進來就被多個 modal 蓋）
    setTimeout(maybeShowDeviceNamePrompt, 1500);
    // v2.2: 月初自動產月報
    setTimeout(maybeGenerateMonthlySnapshot, 3000);
  }, 500);
} else {
  setSyncStatus('idle');
  setTimeout(maybeShowOnboarding, 300);
}

// 網路恢復時自動補推
window.addEventListener('online', () => {
  if (config.sheetPendingPush && config.sheetSyncEnabled) {
    pushToSheet(true);
  }
});

// 視窗縮放時重繪收益圖表（SVG 會依父容器寬度調整）
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!document.getElementById('tab-revenue').classList.contains('hidden')) {
      renderRevenue();
    }
  }, 200);
});
