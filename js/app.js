/* =========================================
   外包收益與排程管理 - 主程式 v1.4
   ========================================= */

// ============== Data Layer ==============
const STORAGE_KEY = 'freelance-tracker-v1';
const CONFIG_KEY = 'freelance-tracker-config';
const COLORS = ['#ef4444','#f59e0b','#10b981','#2563eb','#8b5cf6','#ec4899','#14b8a6','#64748b'];

let state = {
  clients: [],
  jobs: [],
  filters: { clientId: 'all', month: 'current', status: 'all', tag: 'all', expandedYear: null, jobIdsOnly: null, jobIdsOnlyLabel: '' }
};

let config = {
  unpaidRemindDays: 7,  // 完成超過幾天未收款就提醒（App 內 + LINE 共用）

  // 我的資料（顯示在請款單）
  userInfo: {
    name: '',
    phone: '',
    email: '',
    invoiceTitle: '',
    bank: '',
    account: '',
    note: ''
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

  // Google Calendar 同步
  calEnabled: false,
  calId: '',
  calAutoSync: false,
  calLastSyncAt: null,
  calLastSyncCount: 0,

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
const CURRENT_SCHEMA_VERSION = 4;

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

  // 自動 migration：Esthé One 從備註轉換成儲值制（一次性）
  state.clients.forEach(c => {
    if (c.name === 'Esthé One' && !c.prepaidMode && (c.note || '').includes('儲值')) {
      c.prepaidMode = true;
      c.prepayments = [
        { id: uid(), date: '2025-09-12', amount: 2000, note: 'LINEPAY' },
        { id: uid(), date: '2025-09-15', amount: 3000, note: 'LINEPAY' }
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
  const days = +document.getElementById('cfg-unpaid-days-input').value || 7;
  config.unpaidRemindDays = Math.max(1, Math.min(60, days));
  document.getElementById('cfg-unpaid-days').textContent = config.unpaidRemindDays;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  render();
  toast('✓ 已儲存設定');
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
// 顯示一個會持續到下次 toast 的「進行中」訊息（例如「同步中...」）
function toastProgress(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
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
  return state.jobs.filter(j => !j.cancelled);
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

function switchTab(tab) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['dashboard','jobs','calendar','revenue','clients','invoice','settings'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('hidden', t !== tab);
  });
  const fab = document.getElementById('fab-add');
  if (tab === 'settings' || tab === 'invoice' || tab === 'revenue') {
    fab.style.display = 'none';
  } else {
    fab.style.display = 'block';
    fab.onclick = (tab === 'clients') ? openClientModal : openJobModal;
  }
  render();
}

// ============== Render (main) ==============
function render() {
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

function computeAlerts() {
  const today = todayStr();
  const in3 = addDays(new Date(), 3);
  const alerts = [];
  const active = activeJobs();  // 排除取消的案件

  // 1. 逾期未完成
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

  // 2. 未來 3 天內到期（含今天）
  const dueSoon = active.filter(j => !j.done && j.date && j.date >= today && j.date <= in3);
  if (dueSoon.length) {
    alerts.push({
      type: 'due-soon',
      icon: '🟡',
      title: `${dueSoon.length} 筆即將到期`,
      desc: `未來 3 天內要交件：${dueSoon.slice(0,2).map(j=>j.title).join('、')}${dueSoon.length>2?'…':''}`,
      onClick: () => { lockJobsToIds(dueSoon.map(j=>j.id), `🟡 未來 3 天到期（${dueSoon.length} 筆）`); switchTab('jobs'); }
    });
  }

  // 3. 已完成但超過 N 天未收款
  const threshold = addDays(new Date(), -config.unpaidRemindDays);
  const unpaidLong = active.filter(j => j.done && !j.paid && j.doneAt && j.doneAt <= threshold);
  if (unpaidLong.length) {
    const amt = unpaidLong.reduce((s,j) => s + (+j.amount||0), 0);
    // 依業主分組
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
      title: `${unpaidLong.length} 筆完成超過 ${config.unpaidRemindDays} 天未收款`,
      desc: clientsStr,
      amt: fmt(amt),
      onClick: () => { lockJobsToIds(unpaidLong.map(j=>j.id), `🟠 完成超過 ${config.unpaidRemindDays} 天未收款（${unpaidLong.length} 筆）`); switchTab('jobs'); }
    });
  }

  // 4. 月底提醒（每月 25 號後 + 有未收款的本月案件）
  const dom = new Date().getDate();
  if (dom >= 25) {
    const thisMonthUnpaid = active.filter(j => j.done && !j.paid && getMonth(j.date) === thisMonth());
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
  const paidAmt = monthJobs.filter(j => j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const unpaidAmt = monthJobs.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const pendingAmt = monthJobs.filter(j => !j.done).reduce((s,j) => s + (+j.amount||0), 0);
  const year = new Date().getFullYear();
  const yearAmt = active.filter(j => j.paid && j.date && j.date.startsWith(year+'')).reduce((s,j) => s + (+j.amount||0), 0);

  document.getElementById('stat-paid').textContent = fmt(paidAmt);
  document.getElementById('stat-paid-sub').textContent = monthJobs.filter(j=>j.paid).length + ' 筆';
  document.getElementById('stat-unpaid').textContent = fmt(unpaidAmt);
  document.getElementById('stat-unpaid-sub').textContent = monthJobs.filter(j=>j.done&&!j.paid).length + ' 筆';
  document.getElementById('stat-pending').textContent = fmt(pendingAmt);
  document.getElementById('stat-pending-sub').textContent = monthJobs.filter(j=>!j.done).length + ' 筆';
  document.getElementById('stat-year').textContent = fmt(yearAmt);
  document.getElementById('stat-year-sub').textContent = year + ' 年已收款';

  // 近期案件
  const recent = [...state.jobs].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 6);
  document.getElementById('recent-jobs').innerHTML = recent.length
    ? recent.map(jobRow).join('')
    : emptyState('還沒有案件', '點右下角 + 新增第一筆');

  // 月度圖：改成最近 6 個「日曆月份」（空月顯示為 0）
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
  for (let i = 5; i >= 0; i--) {
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

  activeJobs().forEach(j => {
    if (!j.paid || !j.date) return;
    const y = j.date.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + (+j.amount||0);
    if (+y === thisYear - 1 && j.date.slice(5) <= sameMonthDay) {
      lastYearSamePeriod += (+j.amount||0);
    }
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
function jobRow(j) {
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
  const hl = highlightJobIds.has(j.id) ? ' highlight' : '';
  const isSelected = bulkSelected.has(j.id);
  const selCls = isSelected ? ' selected' : '';

  // 批次模式：顯示批次 checkbox 取代雙勾，整個 row 點擊變成 toggle 選取
  if (bulkMode) {
    return `<div class="row state-${status}${hl}${selCls}" data-job-id="${j.id}" onclick="toggleBulkSelect('${j.id}')">
      <div class="bulk-checkbox ${isSelected?'checked':''}"></div>
      <div class="dot" style="background:${color}"></div>
      <div class="info">
        <div class="title">${escapeHtml(j.title || '（無標題）')}${tagBadge}${dueBadge}${cancelBadge}</div>
        <div class="meta">${name} · ${j.date || '無日期'}</div>
      </div>
      <div class="amount">${fmt(+j.amount||0)}</div>
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
      <div class="title">${escapeHtml(j.title || '（無標題）')}${tagBadge}${dueBadge}${cancelBadge}</div>
      <div class="meta">${name} · ${j.date || '無日期'}</div>
    </div>
    <div class="amount">${fmt(+j.amount||0)}</div>
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
    { v: 'paid', label: '已完成已收款' },
    { v: 'cancelled', label: '🚫 已取消' }
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

  let jobs = [...state.jobs];

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
  if (state.filters.status !== 'all') jobs = jobs.filter(j => jobStatus(j) === state.filters.status);
  if (state.filters.tag && state.filters.tag !== 'all') jobs = jobs.filter(j => j.tag === state.filters.tag);
  jobs.sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const container = document.getElementById('jobs-list');
  if (!jobs.length) { container.innerHTML = emptyState('沒有符合條件的案件', '換個篩選或新增一筆'); return; }
  // 計算合計時排除取消案件
  const activeInList = jobs.filter(j => !j.cancelled);
  const total = activeInList.reduce((s,j) => s + (+j.amount||0), 0);
  const paidTotal = activeInList.filter(j => j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const unpaidTotal = activeInList.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
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
    const totalAmt = clientJobs.reduce((s,j) => s + (+j.amount||0), 0);
    const unpaidAmt = clientJobs.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
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
    const mPaid = mJobs.filter(j => j.paid).reduce((s,j)=>s+(+j.amount||0),0);
    const mUnpaid = mJobs.filter(j => j.done && !j.paid).reduce((s,j)=>s+(+j.amount||0),0);
    const allUnpaid = clientJobs.filter(j => j.done && !j.paid).reduce((s,j)=>s+(+j.amount||0),0);
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
    // 近 12 個月活躍度時間軸
    const tlMonths = [];
    const tlNow = new Date();
    tlNow.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const dd = new Date(tlNow);
      dd.setMonth(dd.getMonth() - i);
      const mmKey = dd.getFullYear() + '-' + String(dd.getMonth()+1).padStart(2,'0');
      tlMonths.push(mmKey);
    }
    const tlAmounts = {};
    clientJobs.forEach(j => {
      const mm = jobBelongMonth(j);
      tlAmounts[mm] = (tlAmounts[mm] || 0) + (+j.amount||0);
    });
    const tlMax = Math.max(...tlMonths.map(m => tlAmounts[m] || 0), 1);
    const timelineHtml = `<div class="client-timeline" title="近 12 個月活躍度">${
      tlMonths.map(m => {
        const amt = tlAmounts[m] || 0;
        const pct = amt > 0 ? Math.max(0.1, amt / tlMax) : 0;
        const opacity = pct > 0 ? Math.max(0.25, pct).toFixed(2) : 0;
        return `<div class="client-timeline-cell ${amt?'has-job':''}" title="${m}: ${fmt(amt)}" style="background-color: ${amt ? c.color : 'transparent'}; opacity: ${amt ? opacity : 1};"></div>`;
      }).join('')
    }</div>`;

    const isExpanded = expandedClients.has(c.id);
    const expandIcon = isExpanded ? '▼' : '▶';

    // 展開時顯示該業主的案件清單（最近 50 筆）
    let expandedJobsHtml = '';
    if (isExpanded) {
      const recent = clientJobs.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 50);
      expandedJobsHtml = `<div style="margin-top: 10px; padding: 10px; background: var(--bg); border-radius: 8px;">
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

  // 依模式分組
  const buckets = {};
  jobs.forEach(j => {
    if (!j.date) return;
    const key = revenueState.mode === 'year' ? j.date.slice(0,4) : j.date.slice(0,7);
    if (!buckets[key]) buckets[key] = { paid: 0, unpaid: 0, pending: 0 };
    if (j.paid) buckets[key].paid += (+j.amount||0);
    else if (j.done) buckets[key].unpaid += (+j.amount||0);
    else buckets[key].pending += (+j.amount||0);
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
    if (!j.paid) return;
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

  // 計算每天的收款金額
  const byDay = {};
  activeJobs().forEach(j => {
    if (!j.paid || !j.paidAt) return;
    byDay[j.paidAt] = (byDay[j.paidAt] || 0) + jobNetAmount(j);
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
    if (j.paid) byClient[cid].paid += (+j.amount||0);
    else if (j.done) byClient[cid].unpaid += (+j.amount||0);
    else byClient[cid].pending += (+j.amount||0);
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

  // 請款單排除取消的案件
  const jobs = activeJobs().filter(j => {
    if (j.clientId !== cid) return false;
    const m = getMonth(j.date);
    return m >= rangeStart && m <= rangeEnd;
  }).sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const paidTotal = jobs.filter(j => j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const unpaidTotal = jobs.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const pendingTotal = jobs.filter(j => !j.done).reduce((s,j) => s + (+j.amount||0), 0);

  const u = config.userInfo || {};
  const hasMyInfo = u.name || u.email || u.phone;
  const hasPayInfo = u.bank || u.account;

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
        <div class="meta">共 ${jobs.length} 筆</div>
      </div>
    </div>
    ${jobs.length ? `<table>
      <thead><tr><th>日期</th><th>項目</th><th>說明</th><th class="num">金額</th><th>狀態</th></tr></thead>
      <tbody>
        ${jobs.map(j => {
          const st = jobStatus(j);
          const stLabel = st === 'paid' ? '<span class="badge-status paid">✓ 已收款</span>' :
                          st === 'done-unpaid' ? '<span class="badge-status done-unpaid">$ 待收款</span>' :
                          '<span class="badge-status pending">進行中</span>';
          return `<tr>
            <td>${j.date||'-'}</td>
            <td>${escapeHtml(j.title||'-')}</td>
            <td style="color:var(--muted); font-size: 13px;">${escapeHtml(j.details||'')}</td>
            <td class="num">${fmt(+j.amount||0)}</td>
            <td>${stLabel}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="invoice-total">
      ${paidTotal ? `<div class="invoice-total-item paid">
        <div class="tot-label">已收款</div>
        <div class="tot-value">${fmt(paidTotal)}</div>
      </div>` : ''}
      ${unpaidTotal ? `<div class="invoice-total-item pending">
        <div class="tot-label">本次請款</div>
        <div class="tot-value">${fmt(unpaidTotal)}</div>
      </div>` : ''}
      ${pendingTotal ? `<div class="invoice-total-item" style="color: var(--muted);">
        <div class="tot-label">進行中（尚未請款）</div>
        <div class="tot-value" style="color: var(--muted);">${fmt(pendingTotal)}</div>
      </div>` : ''}
    </div>

    ${hasPayInfo ? `<div class="invoice-payment">
      <div class="invoice-payment-title">Payment Information 匯款資訊</div>
      ${u.bank ? `<div class="invoice-payment-row"><span class="lbl">銀行</span><span class="val">${escapeHtml(u.bank)}</span></div>` : ''}
      ${u.account ? `<div class="invoice-payment-row"><span class="lbl">帳號</span><span class="val" style="font-family: monospace;">${escapeHtml(u.account)}</span></div>` : ''}
      ${u.name ? `<div class="invoice-payment-row"><span class="lbl">戶名</span><span class="val">${escapeHtml(u.name)}</span></div>` : ''}
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

function toggleDone(id) {
  const j = state.jobs.find(x => x.id === id); if (!j) return;
  if (j.cancelled) { toast('案件已取消，請先取消「已取消」狀態'); return; }
  j.done = !j.done;
  j.doneAt = j.done ? todayStr() : null;
  // 取消完成 → 自動取消收款
  if (!j.done) { j.paid = false; j.paidAt = null; }
  save(); render();
  toast(j.done?'✓ 已標記完成':'已改為進行中');
}

function togglePaid(id) {
  const j = state.jobs.find(x => x.id === id); if (!j) return;
  if (j.cancelled) { toast('案件已取消，請先取消「已取消」狀態'); return; }
  if (j.paid) {
    // 取消收款：直接清除
    j.paid = false;
    j.paidAt = null;
    save(); render();
    toast('已改為待收款');
  } else {
    // 勾收款：跳日期 modal
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
    if (ids.includes(j.id) && !j.paid) {
      j.paid = true;
      j.paidAt = dateStr;
      n++;
    }
  });
  if (ids.length > 1) bulkSelected.clear();
  closePaidDateModal();
  save(); render();
  toast(`💰 ${n} 筆已標記收款 (${dateStr})`, 3000);
}

// ----- Job Modal -----
let editingJobId = null;

async function openJobModal() {
  if (!state.clients.length) { toast('請先新增業主'); switchTab('clients'); openClientModal(); return; }
  await tryAcquireLockOrWarn('案件');
  editingJobId = null;
  document.getElementById('job-modal-title').textContent = '新增案件';
  document.getElementById('job-delete-btn').classList.add('hidden');
  const cs = document.getElementById('job-client');
  cs.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
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
  document.getElementById('job-paid').checked = false;
  document.getElementById('job-cancelled').checked = false;
  document.getElementById('job-done-at').value = '';
  document.getElementById('job-paid-at').value = '';
  document.getElementById('job-duplicate-btn')?.classList.add('hidden');
  refreshTagSuggestions();
  onJobClientChange();
  updateJobHourlyHint();
  document.getElementById('job-modal').classList.add('open');
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
  cs.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  cs.value = j.clientId;
  document.getElementById('job-date').value = j.date || '';
  document.getElementById('job-end-date').value = j.endDate || '';
  document.getElementById('job-title').value = j.title || '';
  document.getElementById('job-tag').value = j.tag || '';
  document.getElementById('job-details').value = j.details || '';
  document.getElementById('job-amount').value = j.amount || '';
  document.getElementById('job-hours').value = j.hoursWorked || '';
  document.getElementById('job-done').checked = !!j.done;
  document.getElementById('job-paid').checked = !!j.paid;
  document.getElementById('job-cancelled').checked = !!j.cancelled;
  document.getElementById('job-done-at').value = j.doneAt || '';
  document.getElementById('job-paid-at').value = j.paidAt || '';
  document.getElementById('job-duplicate-btn')?.classList.remove('hidden');
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
  document.getElementById('job-modal').classList.remove('open');
  document.getElementById('job-date').value = '';  // 清空避免殘留快速新增的日期
  releaseEditLock();
}

function saveJob() {
  const isDone = document.getElementById('job-done').checked;
  const isPaid = document.getElementById('job-paid').checked;
  const isCancelled = document.getElementById('job-cancelled').checked;
  const endDate = document.getElementById('job-end-date').value;
  const hoursVal = document.getElementById('job-hours').value;
  const payload = {
    clientId: document.getElementById('job-client').value,
    date: document.getElementById('job-date').value,
    endDate: endDate || null,
    title: document.getElementById('job-title').value.trim(),
    tag: document.getElementById('job-tag').value.trim(),
    details: document.getElementById('job-details').value.trim(),
    amount: +document.getElementById('job-amount').value || 0,
    hoursWorked: hoursVal ? +hoursVal : null,  // 選填工時
    done: isDone,    // 解耦：完成獨立判斷
    paid: isPaid,    // 解耦：收款獨立判斷
    cancelled: isCancelled
  };
  if (!payload.title) { toast('請輸入案件名稱'); return; }
  // 新版：手動輸入的 doneAt / paidAt 優先採用
  const manualDoneAt = document.getElementById('job-done-at').value;
  const manualPaidAt = document.getElementById('job-paid-at').value;

  if (editingJobId) {
    const j = state.jobs.find(x => x.id === editingJobId);
    // 完成日：若手動填了用手動值；否則勾起來補今日 / 取消勾就清空
    if (manualDoneAt && payload.done) {
      payload.doneAt = manualDoneAt;
    } else if (!j.done && payload.done) {
      payload.doneAt = todayStr();
    } else if (!payload.done) {
      payload.doneAt = null;
    } else {
      payload.doneAt = j.doneAt;
    }
    // 收款日：同樣邏輯，但解耦 done/paid（可只勾收款不勾完成）
    if (manualPaidAt && payload.paid) {
      payload.paidAt = manualPaidAt;
    } else if (!j.paid && payload.paid) {
      payload.paidAt = todayStr();
    } else if (!payload.paid) {
      payload.paidAt = null;
    } else {
      payload.paidAt = j.paidAt;
    }
    Object.assign(j, payload);
  } else {
    payload.doneAt = payload.done ? (manualDoneAt || todayStr()) : null;
    payload.paidAt = payload.paid ? (manualPaidAt || todayStr()) : null;
    state.jobs.push({ id: uid(), ...payload });
  }
  save(); closeJobModal(); render(); toast('已儲存');
}

function deleteJob() {
  if (!editingJobId) return;
  if (!confirm('確定要刪除這筆案件？')) return;
  state.jobs = state.jobs.filter(j => j.id !== editingJobId);
  save(); closeJobModal(); render(); toast('已刪除');
}

// ----- Client Modal -----
let editingClientId = null;
let pickedColor = COLORS[0];

async function openClientModal() {
  await tryAcquireLockOrWarn('業主');
  editingClientId = null;
  document.getElementById('client-modal-title').textContent = '新增業主';
  document.getElementById('client-delete-btn').classList.add('hidden');
  document.getElementById('client-name').value = '';
  document.getElementById('client-note').value = '';
  document.getElementById('client-commission-rate').value = '';
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
  if (!name) { toast('請輸入業主名稱'); return; }
  const payload = {
    name, note, color: pickedColor,
    commissionRate, commissionTo,
    prepaidMode: paymentMode === 'prepaid',
    prepayments: paymentMode === 'prepaid' ? modalPrepayments : []
  };
  if (editingClientId) {
    const c = getClient(editingClientId);
    Object.assign(c, payload);
  } else {
    state.clients.push({ id: uid(), ...payload });
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
  const paid = jobs.filter(j => j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const unpaid = jobs.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const txt = `${periodLabel} ${c.name} 工作明細\n\n` +
    jobs.map(j => {
      const st = j.paid ? '✓已收' : (j.done ? '$待收' : '進行中');
      return `${j.date} | ${j.title} | ${fmt(+j.amount||0)} | ${st}${j.details?'\n  '+j.details:''}`;
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

// ============== 我的資料 ==============
function loadUserInfoUI() {
  const u = config.userInfo || {};
  const g = (id) => document.getElementById(id);
  if (g('me-name')) g('me-name').value = u.name || '';
  if (g('me-phone')) g('me-phone').value = u.phone || '';
  if (g('me-email')) g('me-email').value = u.email || '';
  if (g('me-title')) g('me-title').value = u.invoiceTitle || '';
  if (g('me-bank')) g('me-bank').value = u.bank || '';
  if (g('me-account')) g('me-account').value = u.account || '';
  if (g('me-note')) g('me-note').value = u.note || '';
}

function saveUserInfo() {
  config.userInfo = {
    name: document.getElementById('me-name').value.trim(),
    phone: document.getElementById('me-phone').value.trim(),
    email: document.getElementById('me-email').value.trim(),
    invoiceTitle: document.getElementById('me-title').value.trim(),
    bank: document.getElementById('me-bank').value.trim(),
    account: document.getElementById('me-account').value.trim(),
    note: document.getElementById('me-note').value.trim()
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  render();
  toast('✓ 已儲存我的資料，請款單會自動帶入');
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
      save(); render(); toast('✓ 已匯入');
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
  save(); render(); toast('✓ 已載入範例');
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
  state.clients = []; state.jobs = [];
  save(); render(); toast('已清空全部資料');
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
      updateSheetSyncBadge();
      document.getElementById('cfg-unpaid-days').textContent = config.unpaidRemindDays;
      document.getElementById('cfg-unpaid-days-input').value = config.unpaidRemindDays;
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
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    setSyncStatus('synced');
    render();
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
        data: { clients: state.clients, jobs: state.jobs }
      })
    });
    const data = await resp.json();
    if (!data.ok) {
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
async function previewSnapshot(id) {
  const cfg = config.sheetConfig;
  toastProgress('📂 載入預覽...');
  try {
    const resp = await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'getSnapshot', token: cfg.apiToken, snapshotId: id })
    });
    const data = await resp.json();
    if (!data.ok) { alert('失敗：' + data.error); return; }
    const snap = data.snapshot;
    const d = snap.data;
    const clients = d.clients || [];
    const jobs = d.jobs || [];

    // 統計：負金額案件
    const negativeJobs = jobs.filter(j => +j.amount < 0);
    const negativeInfo = negativeJobs.length
      ? '\n\n⚠️ 含負金額案件 (' + negativeJobs.length + ' 筆)：\n' +
        negativeJobs.slice(0, 5).map(j => {
          const c = clients.find(c => c.id === j.clientId);
          return `  • ${c?.name || '?'} | ${j.title} | ${fmt(+j.amount)}`;
        }).join('\n')
      : '';

    // 業主清單
    const clientList = clients.slice(0, 8).map(c => `  • ${c.name}`).join('\n');
    const moreClients = clients.length > 8 ? `\n  ...還有 ${clients.length - 8} 位` : '';

    // 案件總金額
    const total = jobs.reduce((s,j) => s + (+j.amount || 0), 0);

    alert(
      `備份內容預覽（${snap.timestamp}）\n` +
      '─────────────────────────────\n' +
      `業主：${clients.length} 位\n${clientList}${moreClients}\n\n` +
      `案件：${jobs.length} 筆\n` +
      `總金額：${fmt(total)}` +
      negativeInfo +
      '\n\n要還原這個版本？請按關閉預覽 → 點該筆的「⏮️ 還原」按鈕'
    );
    toast('');
  } catch (err) {
    alert('錯誤：' + err.message);
  }
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
    alert(`✓ 已還原\n\n還原時間：${data.result.restoredAt}\n業主：${data.result.clientCount} 位\n案件：${data.result.jobCount} 筆\n\n即將重新拉取資料到本地。`);
    await pullFromSheet(false);
  } catch (err) {
    alert('錯誤：' + err.message);
  }
}

// ============== 網頁版本偵測 ==============
const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || 'unknown';
const APP_VERSION_KEY = 'freelance-tracker-app-version';

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
    const remoteVersion = match[1];
    if (remoteVersion !== APP_VERSION) {
      const remind = document.getElementById('version-remind');
      if (!remind) {
        const div = document.createElement('div');
        div.id = 'version-remind';
        div.className = 'version-remind';
        div.innerHTML = `🆕 APP 有新版本（${remoteVersion}），<a onclick="location.reload(true)" style="color:#fff;text-decoration:underline;cursor:pointer;">重新整理</a>`;
        document.body.appendChild(div);
      }
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
function loadCalendarConfigUI() {
  const g = (id) => document.getElementById(id);
  if (g('cal-enabled')) g('cal-enabled').checked = !!config.calEnabled;
  if (g('cal-id')) g('cal-id').value = config.calId || '';
  if (g('cal-autosync')) g('cal-autosync').checked = !!config.calAutoSync;
  updateCalendarStatusBadge();
  renderCalendarSyncStatus();
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
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  updateCalendarStatusBadge();
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
    const resp = await fetch(apiUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'syncCalendar',
        token,
        calendarId: calId,
        jobs: state.jobs,
        clients: state.clients
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
      alert(`✓ 同步完成！\n\nCalendar：${r.calendarName}\n刪除舊事件：${r.deleted} 個\n建立新事件：${r.created} 個${r.errors?.length ? '\n\n錯誤：\n' + r.errors.slice(0, 3).join('\n') : ''}`);
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
}

// ============== Init ==============
load();
document.getElementById('cfg-unpaid-days').textContent = config.unpaidRemindDays;
document.getElementById('cfg-unpaid-days-input').value = config.unpaidRemindDays;
loadUserInfoUI();
loadSheetConfigUI();
loadCalendarConfigUI();
updateSheetSyncBadge();
buildRangeOptions();
setupAutoSave();
checkAppVersionUpdate();
setInterval(pollAppVersion, 5 * 60 * 1000);  // 每 5 分鐘檢查網頁新版
render();

// 啟動時抓 IP 地理位置（24h 快取，失敗不擋）
fetchDeviceLocation();

// 啟動時若同步已啟用，自動從 Sheet 拉取最新資料
if (config.sheetSyncEnabled && config.sheetConfig?.apiUrl && config.sheetConfig?.apiToken) {
  setTimeout(async () => {
    const ok = await pullFromSheet(true);
    if (config.cloudFirstMode && !ok) {
      // 雲端優先模式但 pull 失敗：唯讀
      toast('⚠️ 雲端優先模式：無法連線雲端，目前為唯讀狀態', 5000);
      setSyncStatus('offline', '雲端優先模式 - 唯讀中');
    }
    setupAutoPoll();
    // 同步運作後再提醒設裝置名（避免新使用者一進來就被多個 modal 蓋）
    setTimeout(maybeShowDeviceNamePrompt, 1500);
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
