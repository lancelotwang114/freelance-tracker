/* =========================================
   外包收益與排程管理 - 主程式 v0.3
   新增：收益統計（月/年/業主切換、SVG 圖表、業主貢獻排行）
         我的資料 → 請款單
         備份提醒（14 天沒匯出會警示）
         Google Sheet 同步欄位預留
   ========================================= */

// ============== Data Layer ==============
const STORAGE_KEY = 'freelance-tracker-v1';
const CONFIG_KEY = 'freelance-tracker-config';
const COLORS = ['#ef4444','#f59e0b','#10b981','#2563eb','#8b5cf6','#ec4899','#14b8a6','#64748b'];

let state = {
  clients: [],
  jobs: [],
  filters: { clientId: 'all', month: 'current', status: 'all' }
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
    lastPullAt: null
  },
  sheetSyncEnabled: false,
  sheetPendingPush: false,  // 有待同步但離線時為 true

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

// 收益頁模式
let revenueState = {
  mode: 'month',        // 'month' | 'year'
  clientId: 'all',
  range: 12
};

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = Object.assign(state, JSON.parse(raw)); } catch(e) {}
  }
  const cfgRaw = localStorage.getItem(CONFIG_KEY);
  if (cfgRaw) {
    try { config = Object.assign(config, JSON.parse(cfgRaw)); } catch(e) {}
  }
  // 舊資料升級：確保每筆 job 都有 paid / doneAt / paidAt / cancelled
  state.jobs = (state.jobs || []).map(j => ({
    ...j,
    paid: j.paid ?? false,
    cancelled: j.cancelled ?? false,
    doneAt: j.doneAt ?? (j.done ? (j.date || todayStr()) : null),
    paidAt: j.paidAt ?? (j.paid ? (j.date || todayStr()) : null)
  }));

  // 若網址帶 ?client=xxx，進入業主唯讀模式
  const params = new URLSearchParams(location.search);
  const cid = params.get('client');
  if (cid) enterClientMode(cid);
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
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

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function jobStatus(j) {
  if (j.cancelled) return 'cancelled';
  if (j.paid) return 'paid';
  if (j.done) return 'done-unpaid';
  return 'pending';
}

// 用於統計：取消的案件不計入
function activeJobs() {
  return state.jobs.filter(j => !j.cancelled);
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
  if (!confirm(`將選中的 ${bulkSelected.size} 筆案件標記為「已收款」（含完成）？`)) return;
  let n = 0;
  state.jobs.forEach(j => {
    if (bulkSelected.has(j.id) && !j.paid) {
      j.done = true;
      j.paid = true;
      j.doneAt = j.doneAt || todayStr();
      j.paidAt = todayStr();
      n++;
    }
  });
  bulkSelected.clear();
  save(); render();
  toast(`💰 ${n} 筆已標記收款`);
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
  // 2.5 秒後清除
  setTimeout(() => { highlightJobIds = new Set(); }, 2600);
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
      onClick: () => { setHighlightJobs(overdue.map(j=>j.id)); setFilter('status','pending'); setFilter('month','all'); switchTab('jobs'); }
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
      onClick: () => { setHighlightJobs(dueSoon.map(j=>j.id)); setFilter('status','pending'); setFilter('month','all'); switchTab('jobs'); }
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
      onClick: () => { setHighlightJobs(unpaidLong.map(j=>j.id)); setFilter('status','done-unpaid'); setFilter('month','all'); switchTab('jobs'); }
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
        onClick: () => switchTab('invoice')
      });
    }
  }

  // 5. 備份提醒（> N 天沒匯出備份 + 有資料時才提示）
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
  const hl = highlightJobIds.has(j.id) ? ' highlight' : '';
  const isSelected = bulkSelected.has(j.id);
  const selCls = isSelected ? ' selected' : '';

  // 批次模式：顯示批次 checkbox 取代雙勾，整個 row 點擊變成 toggle 選取
  if (bulkMode) {
    return `<div class="row state-${status}${hl}${selCls}" data-job-id="${j.id}" onclick="toggleBulkSelect('${j.id}')">
      <div class="bulk-checkbox ${isSelected?'checked':''}"></div>
      <div class="dot" style="background:${color}"></div>
      <div class="info">
        <div class="title">${escapeHtml(j.title || '（無標題）')}${cancelBadge}</div>
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
      <div class="title">${escapeHtml(j.title || '（無標題）')}${cancelBadge}</div>
      <div class="meta">${name} · ${j.date || '無日期'}</div>
    </div>
    <div class="amount">${fmt(+j.amount||0)}</div>
  </div>`;
}

// ============== Jobs Tab ==============
function renderJobs() {
  const fb = document.getElementById('job-filter');
  const months = ['current','all', ...[...new Set(state.jobs.map(j => getMonth(j.date)).filter(Boolean))].sort().reverse()];
  const monthLabels = { current: '本月', all: '全部月份' };
  const statusOptions = [
    { v: 'all', label: '全部狀態' },
    { v: 'pending', label: '未完成' },
    { v: 'done-unpaid', label: '完成待收款' },
    { v: 'paid', label: '已收款' },
    { v: 'cancelled', label: '🚫 已取消' }
  ];
  fb.innerHTML =
    '<span class="filter-bar-label">月份</span>' +
    months.map(m => `<button class="chip ${state.filters.month===m?'active':''}" onclick="setFilter('month','${m}')">${monthLabels[m]||m}</button>`).join('') +
    '<span class="filter-bar-label" style="margin-left: 6px;">狀態</span>' +
    statusOptions.map(s => `<button class="chip ${state.filters.status===s.v?'active':''}" onclick="setFilter('status','${s.v}')">${s.label}</button>`).join('') +
    '<span class="filter-bar-label" style="margin-left: 6px;">業主</span>' +
    `<button class="chip ${state.filters.clientId==='all'?'active':''}" onclick="setFilter('clientId','all')">全部</button>` +
    state.clients.map(c => `<button class="chip ${state.filters.clientId===c.id?'active':''}" onclick="setFilter('clientId','${c.id}')" style="${state.filters.clientId===c.id?'':'border-left: 3px solid '+c.color+';'}">${escapeHtml(c.name)}</button>`).join('');

  let jobs = [...state.jobs];
  if (state.filters.month === 'current') jobs = jobs.filter(j => getMonth(j.date) === thisMonth());
  else if (state.filters.month !== 'all') jobs = jobs.filter(j => getMonth(j.date) === state.filters.month);
  if (state.filters.clientId !== 'all') jobs = jobs.filter(j => j.clientId === state.filters.clientId);
  if (state.filters.status !== 'all') jobs = jobs.filter(j => jobStatus(j) === state.filters.status);
  jobs.sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const container = document.getElementById('jobs-list');
  if (!jobs.length) { container.innerHTML = emptyState('沒有符合條件的案件', '換個篩選或新增一筆'); return; }
  // 計算合計時排除取消案件
  const activeInList = jobs.filter(j => !j.cancelled);
  const total = activeInList.reduce((s,j) => s + (+j.amount||0), 0);
  const paidTotal = activeInList.filter(j => j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const unpaidTotal = activeInList.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const cancelledCount = jobs.filter(j => j.cancelled).length;
  container.innerHTML =
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
  const ds = dateNorm.toISOString().slice(0,10);
  const isToday = ds === todayStr();
  const dow = dateNorm.getDay();
  const dowCls = dow===0?'sun':(dow===6?'sat':'');
  const jobs = state.jobs.filter(j => j.date === ds);
  const maxShow = 3;
  const chips = jobs.slice(0, maxShow).map(j => {
    const c = getClient(j.clientId);
    const bg = c ? c.color : '#999';
    const status = jobStatus(j);
    const cls = status === 'paid' ? 'paid' : (status === 'done-unpaid' ? 'done-unpaid' : '');
    return `<div class="cal-chip ${cls}" style="background:${bg}" onclick="event.stopPropagation(); editJob('${j.id}')" title="${escapeHtml(j.title)} · ${fmt(+j.amount||0)}">${escapeHtml(j.title)}</div>`;
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
    const mJobs = clientJobs.filter(j => getMonth(j.date) === m);
    const mPaid = mJobs.filter(j => j.paid).reduce((s,j)=>s+(+j.amount||0),0);
    const mUnpaid = mJobs.filter(j => j.done && !j.paid).reduce((s,j)=>s+(+j.amount||0),0);
    const allUnpaid = clientJobs.filter(j => j.done && !j.paid).reduce((s,j)=>s+(+j.amount||0),0);
    return `<div style="padding: 14px 0; border-bottom: 1px solid var(--border);">
      <div class="client-header">
        <div class="dot" style="background:${c.color}; width: 12px; height: 12px;"></div>
        <div style="font-weight: 600; flex: 1;">
          ${escapeHtml(c.name)}
          ${allUnpaid > 0 ? `<span class="client-owes">待收 ${fmt(allUnpaid)}</span>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="editClient('${c.id}')">編輯</button>
      </div>
      <div style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">
        本月已收 ${fmt(mPaid)} · 待收 ${fmt(mUnpaid)} · 累計 ${clientJobs.length} 筆
      </div>
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
  // 年度模式下 range 選單改變
  const rangeSel = document.getElementById('rev-range');
  if (mode === 'year') {
    rangeSel.innerHTML = `
      <option value="3">最近 3 年</option>
      <option value="5" selected>最近 5 年</option>
      <option value="all">全部</option>`;
    revenueState.range = 5;
  } else {
    rangeSel.innerHTML = `
      <option value="6">最近 6 個月</option>
      <option value="12" selected>最近 12 個月</option>
      <option value="24">最近 24 個月</option>
      <option value="all">全部</option>`;
    revenueState.range = 12;
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
    revenueState.range = rangeSel.value === 'all' ? 'all' : +rangeSel.value;
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
  // 年月範圍：如果沒資料也至少填當期
  if (!keys.length) keys = [revenueState.mode==='year' ? String(new Date().getFullYear()) : thisMonth()];

  // 補齊空月/空年
  const filled = fillEmptyBuckets(keys, revenueState.mode);
  filled.forEach(k => { if (!buckets[k]) buckets[k] = { paid: 0, unpaid: 0, pending: 0 }; });

  // 取最後 N 筆
  let displayKeys = filled;
  if (revenueState.range !== 'all') {
    displayKeys = filled.slice(-revenueState.range);
  }

  const data = displayKeys.map(k => ({ label: k, ...buckets[k] }));

  // 標題
  const modeLabel = revenueState.mode === 'year' ? '年度' : '月度';
  document.getElementById('rev-chart-title').textContent = `${modeLabel}收益趨勢（${data.length} 期）`;

  // 摘要
  renderRevSummary(data);

  // 主圖表
  drawRevChart(data);

  // 業主貢獻排行
  renderClientRank(jobs, revenueState.range === 'all' ? null : displayKeys);
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
    if (!byClient[cid]) byClient[cid] = { paid: 0, unpaid: 0, pending: 0, count: 0 };
    if (j.paid) byClient[cid].paid += (+j.amount||0);
    else if (j.done) byClient[cid].unpaid += (+j.amount||0);
    else byClient[cid].pending += (+j.amount||0);
    byClient[cid].count++;
  });

  const rows = Object.entries(byClient)
    .map(([cid, d]) => {
      const c = getClient(cid);
      return { ...d, total: d.paid + d.unpaid, cid, name: c ? c.name : '未指定', color: c ? c.color : '#ccc' };
    })
    .filter(r => r.total > 0)
    .sort((a,b) => b.total - a.total);

  if (!rows.length) {
    box.innerHTML = emptyState('期間內沒有收益資料', '');
    return;
  }

  const maxTotal = rows[0].total;
  box.innerHTML = rows.map(r => {
    const paidPct = r.total ? r.paid / r.total * 100 : 0;
    const unpaidPct = r.total ? r.unpaid / r.total * 100 : 0;
    const barScale = r.total / maxTotal * 100;
    return `<div class="client-rank-row">
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
  // 要收款必須先完成
  if (!j.paid && !j.done) {
    j.done = true;
    j.doneAt = todayStr();
  }
  j.paid = !j.paid;
  j.paidAt = j.paid ? todayStr() : null;
  save(); render();
  toast(j.paid?'💰 已標記收款':'已改為待收款');
}

// ----- Job Modal -----
let editingJobId = null;

function openJobModal() {
  if (!state.clients.length) { toast('請先新增業主'); switchTab('clients'); openClientModal(); return; }
  editingJobId = null;
  document.getElementById('job-modal-title').textContent = '新增案件';
  document.getElementById('job-delete-btn').classList.add('hidden');
  const cs = document.getElementById('job-client');
  cs.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (!document.getElementById('job-date').value) {
    document.getElementById('job-date').value = todayStr();
  }
  document.getElementById('job-title').value = '';
  document.getElementById('job-details').value = '';
  document.getElementById('job-amount').value = '';
  document.getElementById('job-done').checked = false;
  document.getElementById('job-paid').checked = false;
  document.getElementById('job-cancelled').checked = false;
  document.getElementById('job-modal').classList.add('open');
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
  document.getElementById('job-title').value = j.title || '';
  document.getElementById('job-details').value = j.details || '';
  document.getElementById('job-amount').value = j.amount || '';
  document.getElementById('job-done').checked = !!j.done;
  document.getElementById('job-paid').checked = !!j.paid;
  document.getElementById('job-cancelled').checked = !!j.cancelled;
  document.getElementById('job-modal').classList.add('open');
}

function closeJobModal() {
  document.getElementById('job-modal').classList.remove('open');
  document.getElementById('job-date').value = '';  // 清空避免殘留快速新增的日期
}

function saveJob() {
  const isDone = document.getElementById('job-done').checked;
  const isPaid = document.getElementById('job-paid').checked;
  const isCancelled = document.getElementById('job-cancelled').checked;
  const payload = {
    clientId: document.getElementById('job-client').value,
    date: document.getElementById('job-date').value,
    title: document.getElementById('job-title').value.trim(),
    details: document.getElementById('job-details').value.trim(),
    amount: +document.getElementById('job-amount').value || 0,
    done: isDone || isPaid,  // 若打勾收款但沒勾完成，自動補上
    paid: isPaid,
    cancelled: isCancelled
  };
  if (!payload.title) { toast('請輸入案件名稱'); return; }
  if (editingJobId) {
    const j = state.jobs.find(x => x.id === editingJobId);
    // 狀態變更時更新時間戳
    if (!j.done && payload.done) payload.doneAt = todayStr(); else payload.doneAt = j.doneAt;
    if (!j.paid && payload.paid) payload.paidAt = todayStr(); else payload.paidAt = j.paidAt;
    if (!payload.done) { payload.doneAt = null; payload.paid = false; payload.paidAt = null; }
    if (!payload.paid) payload.paidAt = null;
    Object.assign(j, payload);
  } else {
    payload.doneAt = payload.done ? todayStr() : null;
    payload.paidAt = payload.paid ? todayStr() : null;
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

function openClientModal() {
  editingClientId = null;
  document.getElementById('client-modal-title').textContent = '新增業主';
  document.getElementById('client-delete-btn').classList.add('hidden');
  document.getElementById('client-name').value = '';
  document.getElementById('client-note').value = '';
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
  renderColorPicker(c.color);
  document.getElementById('client-modal').classList.add('open');
}

function closeClientModal() { document.getElementById('client-modal').classList.remove('open'); }

function renderColorPicker(selected) {
  pickedColor = selected;
  const box = document.getElementById('color-picker');
  box.innerHTML = COLORS.map(col => `<div onclick="pickColor('${col}')" style="width: 32px; height: 32px; border-radius: 50%; background: ${col}; cursor: pointer; border: 3px solid ${col===selected?'var(--text)':'transparent'};"></div>`).join('');
}

function pickColor(col) { renderColorPicker(col); }

function saveClient() {
  const name = document.getElementById('client-name').value.trim();
  const note = document.getElementById('client-note').value.trim();
  if (!name) { toast('請輸入業主名稱'); return; }
  if (editingClientId) {
    const c = getClient(editingClientId);
    Object.assign(c, { name, note, color: pickedColor });
  } else {
    state.clients.push({ id: uid(), name, note, color: pickedColor });
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
    _version: 'v0.4',
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

// ============== 跨裝置設定檔（攜帶 API URL、Token、我的資料）==============
function exportSettings() {
  // 只匯出設定，不含 clients/jobs（那些走 Sheet 同步）
  const settings = {
    _exportedAt: new Date().toISOString(),
    _version: 'v0.4',
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
  const map = {
    idle:    { icon: '☁️',  text: '未連雲端',  cls: 'idle' },
    syncing: { icon: '⏳',  text: '同步中',     cls: 'syncing' },
    synced:  { icon: '✓',   text: '已同步',     cls: 'synced' },
    offline: { icon: '⚠',   text: '沒網路',     cls: 'offline' },
    error:   { icon: '✗',   text: '連線失敗',   cls: 'error' }
  };
  const s = map[status] || map.idle;
  el.className = `sync-indicator sync-${s.cls}`;
  el.innerHTML = `${s.icon} ${s.text}`;
  el.title = err ? `錯誤：${err}` : (config.sheetConfig?.lastSyncAt ? `上次同步：${config.sheetConfig.lastSyncAt}` : '尚未同步');
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
  try {
    const url = cfg.apiUrl + '?action=list&token=' + encodeURIComponent(cfg.apiToken);
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) {
      setSyncStatus('error', data.error);
      if (!silent) alert('拉取失敗：' + data.error);
      return false;
    }
    // 覆蓋本地
    state.clients = data.data.clients || [];
    state.jobs = (data.data.jobs || []).map(j => ({
      ...j,
      paid: j.paid ?? false,
      doneAt: j.doneAt ?? (j.done ? (j.date || todayStr()) : null),
      paidAt: j.paidAt ?? (j.paid ? (j.date || todayStr()) : null)
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ clients: state.clients, jobs: state.jobs }));
    config.sheetConfig.lastPullAt = data.listedAt || new Date().toISOString();
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    setSyncStatus('synced');
    render();
    if (!silent) toast(`✓ 從 Sheet 拉到 ${state.jobs.length} 筆案件`);
    return true;
  } catch (err) {
    setSyncStatus('offline', err.message);
    if (!silent) alert('網路錯誤：' + err.message);
    return false;
  }
}

async function pushToSheet(silent = false) {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) {
    if (!silent) toast('請先設定 API URL + Token');
    return false;
  }
  // 注意：sheetSyncEnabled 檢查只在 schedulePush（自動推送）時做，
  // 手動按按鈕不受限制，方便使用者在「停用」狀態下也能手動操作
  setSyncStatus('syncing');
  try {
    const resp = await fetch(cfg.apiUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'save',
        token: cfg.apiToken,
        snapshotNote: `from ${getDeviceLabel()}`,
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
    config.sheetPendingPush = false;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    setSyncStatus('synced');
    if (!silent) toast('✓ 已推送到 Sheet');
    return true;
  } catch (err) {
    setSyncStatus('offline', err.message);
    config.sheetPendingPush = true;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return false;
  }
}

function schedulePush() {
  // 只有「啟用自動同步」狀態下才會自動推
  if (!config.sheetSyncEnabled) return;
  clearTimeout(syncTimer);
  setSyncStatus('syncing');
  syncTimer = setTimeout(() => pushToSheet(true), 2000);
}

function getDeviceLabel() {
  const ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua)) return 'mobile';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Win/i.test(ua)) return 'windows';
  return 'unknown';
}

async function enableSheetSync() {
  const cfg = config.sheetConfig;
  if (!cfg?.apiUrl || !cfg?.apiToken) {
    alert('請先設定 Apps Script URL 並測試連線成功');
    return;
  }
  const msg =
    '【啟用 Sheet 雙向同步】\n\n' +
    `即將把本地 ${state.clients.length} 位業主、${state.jobs.length} 筆案件推送到 Sheet。\n\n` +
    '✅ 安全機制（重要）：\n' +
    '• Apps Script 會先把 Sheet 目前內容備份到 snapshots 分頁\n' +
    '• 即使推錯，都可還原回來\n' +
    '• snapshots 保留最近 20 個版本\n\n' +
    '啟用後：\n' +
    '• 每次改動 2 秒內自動推送到 Sheet\n' +
    '• 開 APP 時自動從 Sheet 拉取最新資料\n' +
    '• 其他裝置只要填同樣的 URL + Token 即可同步\n\n' +
    '確定要啟用嗎？';
  if (!confirm(msg)) return;

  // 先啟用 flag 再推送
  config.sheetSyncEnabled = true;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

  const ok = await pushToSheet(false);
  if (ok) {
    updateSheetSyncBadge();
    alert('✓ 同步已啟用！\n\n之後不用管它，改東西會自動推送。\n\n跨裝置使用：在其他電腦 / 手機打開 APP，到「設定 → Apps Script 後端」填一樣的 URL + Token，然後按「從 Sheet 拉取」，就能看到同樣的資料。');
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
  toast('讀取中...');
  try {
    const url = cfg.apiUrl + '?action=listSnapshots&token=' + encodeURIComponent(cfg.apiToken);
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) { alert('失敗：' + data.error); return; }
    const list = data.snapshots;
    if (!list.length) { alert('目前沒有任何 snapshot'); return; }
    const msg = 'Snapshots（最新在上）：\n\n' +
      list.map((s, i) => `${i+1}. ${s.timestamp}\n   ${s.note}\n   ID: ${s.id}`).join('\n\n') +
      '\n\n要還原某個 snapshot？輸入它的 ID，取消則關閉。';
    const id = prompt(msg);
    if (!id) return;
    await restoreSnapshot(id.trim());
  } catch (err) {
    alert('錯誤：' + err.message);
  }
}

async function restoreSnapshot(id) {
  const cfg = config.sheetConfig;
  if (!confirm(`即將還原 snapshot: ${id}\n\nSheet 當前內容會先備份再還原。\n還原後，本地會重新從 Sheet 拉取。\n\n確定？`)) return;
  toast('還原中...');
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

// ============== Apps Script 後端（Sheet URL + API URL）==============
function loadSheetConfigUI() {
  const g = (id) => document.getElementById(id);
  if (!g('sheet-api')) return;
  g('sheet-api').value = config.sheetConfig?.apiUrl || '';
  g('sheet-url').value = config.sheetConfig?.sheetUrl || '';
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
  toast('測試連線中...');
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
    alert('請先在「Google Sheet 同步（v0.4 預留）」區塊填入 Apps Script URL，才能呼叫後端。\n\n（Calendar 同步需要透過 Apps Script 後端執行）');
    return;
  }
  const token = prompt('請輸入 API Token（首次測試時填，之後會記下來）', config.sheetConfig?.apiToken || '');
  if (!token) return;

  toast('測試連線中...');
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
    alert('請先在「Google Sheet 同步（v0.4 預留）」區塊填入 Apps Script URL');
    return;
  }
  let token = config.sheetConfig?.apiToken;
  if (!token) {
    token = prompt('請輸入 API Token');
    if (!token) return;
  }

  if (!confirm(`即將同步 ${state.jobs.length} 筆案件到 Calendar。\n\n注意：會先刪除 Calendar 上所有由本工具建立的舊事件，再重新建立。\n\n確定？`)) return;

  toast('同步中，請稍候...');
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
setupAutoSave();
render();

// 啟動時若同步已啟用，自動從 Sheet 拉取最新資料
if (config.sheetSyncEnabled && config.sheetConfig?.apiUrl && config.sheetConfig?.apiToken) {
  setTimeout(() => pullFromSheet(true), 500);
} else {
  setSyncStatus('idle');
  // 初次使用引導（只在沒設定 Sheet 同步時顯示）
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
