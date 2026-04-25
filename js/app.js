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
  backupRemindDays: 14,  // 多久沒匯出就提醒

  // LINE Notify（v0.4 接上後端後生效）
  lineEnabled: false,
  lineToken: '',
  lineDailyTime: '09:00',
  lineWeeklySummary: false,
  lineNotifyToday: true,
  lineNotifyOverdue: true,
  lineNotifyDueSoon: true,
  lineDueSoonDays: 3,
  lineNotifyUnpaidLong: true,
  lineNotifyMonthEnd: true,
  lineMonthEndDay: 25
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
  // 舊資料升級：確保每筆 job 都有 paid / doneAt / paidAt
  state.jobs = (state.jobs || []).map(j => ({
    ...j,
    paid: j.paid ?? false,
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
  if (j.paid) return 'paid';
  if (j.done) return 'done-unpaid';
  return 'pending';
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

// ============== Reminders / Alerts ==============
function computeAlerts() {
  const today = todayStr();
  const in3 = addDays(new Date(), 3);
  const alerts = [];

  // 1. 逾期未完成
  const overdue = state.jobs.filter(j => !j.done && j.date && j.date < today);
  if (overdue.length) {
    const amt = overdue.reduce((s,j) => s + (+j.amount||0), 0);
    alerts.push({
      type: 'overdue',
      icon: '🔴',
      title: `${overdue.length} 筆逾期未完成`,
      desc: `最早日期 ${overdue.map(j=>j.date).sort()[0]}　涉及金額 ${fmt(amt)}`,
      onClick: () => { setFilter('status','pending'); setFilter('month','all'); switchTab('jobs'); }
    });
  }

  // 2. 未來 3 天內到期（含今天）
  const dueSoon = state.jobs.filter(j => !j.done && j.date && j.date >= today && j.date <= in3);
  if (dueSoon.length) {
    alerts.push({
      type: 'due-soon',
      icon: '🟡',
      title: `${dueSoon.length} 筆即將到期`,
      desc: `未來 3 天內要交件：${dueSoon.slice(0,2).map(j=>j.title).join('、')}${dueSoon.length>2?'…':''}`,
      onClick: () => { setFilter('status','pending'); setFilter('month','all'); switchTab('jobs'); }
    });
  }

  // 3. 已完成但超過 N 天未收款
  const threshold = addDays(new Date(), -config.unpaidRemindDays);
  const unpaidLong = state.jobs.filter(j => j.done && !j.paid && j.doneAt && j.doneAt <= threshold);
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
      onClick: () => { setFilter('status','done-unpaid'); setFilter('month','all'); switchTab('jobs'); }
    });
  }

  // 4. 月底提醒（每月 25 號後 + 有未收款的本月案件）
  const dom = new Date().getDate();
  if (dom >= 25) {
    const thisMonthUnpaid = state.jobs.filter(j => j.done && !j.paid && getMonth(j.date) === thisMonth());
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
  const monthJobs = state.jobs.filter(j => getMonth(j.date) === m);
  const paidAmt = monthJobs.filter(j => j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const unpaidAmt = monthJobs.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const pendingAmt = monthJobs.filter(j => !j.done).reduce((s,j) => s + (+j.amount||0), 0);
  const year = new Date().getFullYear();
  const yearAmt = state.jobs.filter(j => j.paid && j.date && j.date.startsWith(year+'')).reduce((s,j) => s + (+j.amount||0), 0);

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
  state.jobs.forEach(j => {
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

  state.jobs.forEach(j => {
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
  return `<div class="row state-${status}" onclick="editJob('${j.id}')">
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
      <div class="title">${escapeHtml(j.title || '（無標題）')}</div>
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
    { v: 'paid', label: '已收款' }
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
  const total = jobs.reduce((s,j) => s + (+j.amount||0), 0);
  const paidTotal = jobs.filter(j => j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const unpaidTotal = jobs.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  container.innerHTML =
    `<div style="padding: 8px 0 12px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted);">
       共 ${jobs.length} 筆　已收 <b style="color:var(--success)">${fmt(paidTotal)}</b>
       ${unpaidTotal ? `· 待收 <b style="color:var(--warning)">${fmt(unpaidTotal)}</b>` : ''}
       · 總計 ${fmt(total)}
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
  container.innerHTML = state.clients.map(c => {
    const clientJobs = state.jobs.filter(j => j.clientId === c.id);
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

  // 過濾業主
  let jobs = [...state.jobs];
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

  // 趨勢線
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

  const mSel = document.getElementById('inv-month');
  const curM = mSel.value;
  const allMonths = [...new Set(state.jobs.map(j => getMonth(j.date)).filter(Boolean))].sort().reverse();
  if (!allMonths.length) allMonths.push(thisMonth());
  mSel.innerHTML = allMonths.map(m => `<option value="${m}">${m}</option>`).join('');
  if (curM) mSel.value = curM; else mSel.value = thisMonth();

  drawInvoice();
}

function drawInvoice() {
  const cid = document.getElementById('inv-client').value;
  const mm = document.getElementById('inv-month').value;
  const c = getClient(cid);
  const v = document.getElementById('invoice-view');
  if (!c) { v.innerHTML = '<div class="card empty">請先新增業主</div>'; return; }
  const jobs = state.jobs.filter(j => j.clientId === cid && getMonth(j.date) === mm).sort((a,b) => (a.date||'').localeCompare(b.date||''));
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
        <h2>${mm} 工作明細</h2>
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
  j.done = !j.done;
  j.doneAt = j.done ? todayStr() : null;
  // 取消完成 → 自動取消收款
  if (!j.done) { j.paid = false; j.paidAt = null; }
  save(); render();
  toast(j.done?'✓ 已標記完成':'已改為進行中');
}

function togglePaid(id) {
  const j = state.jobs.find(x => x.id === id); if (!j) return;
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
  document.getElementById('job-modal').classList.add('open');
}

function closeJobModal() {
  document.getElementById('job-modal').classList.remove('open');
  document.getElementById('job-date').value = '';  // 清空避免殘留快速新增的日期
}

function saveJob() {
  const isDone = document.getElementById('job-done').checked;
  const isPaid = document.getElementById('job-paid').checked;
  const payload = {
    clientId: document.getElementById('job-client').value,
    date: document.getElementById('job-date').value,
    title: document.getElementById('job-title').value.trim(),
    details: document.getElementById('job-details').value.trim(),
    amount: +document.getElementById('job-amount').value || 0,
    done: isDone || isPaid,  // 若打勾收款但沒勾完成，自動補上
    paid: isPaid
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
  const mm = document.getElementById('inv-month').value;
  const c = getClient(cid); if (!c) return;
  const jobs = state.jobs.filter(j => j.clientId === cid && getMonth(j.date) === mm).sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const paid = jobs.filter(j => j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const unpaid = jobs.filter(j => j.done && !j.paid).reduce((s,j) => s + (+j.amount||0), 0);
  const txt = `${mm} ${c.name} 工作明細\n\n` +
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
  const blob = new Blob([JSON.stringify({clients: state.clients, jobs: state.jobs, config}, null, 2)], {type: 'application/json'});
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
  const el = document.getElementById('backup-status');
  if (!el) return;
  const last = config.lastExportAt;
  if (!last) {
    el.innerHTML = '<span style="color: var(--danger);">⚠️ 尚未匯出任何備份</span>';
  } else {
    const days = daysBetween(last, todayStr());
    if (days === 0) {
      el.innerHTML = `<span style="color: var(--success);">✓ 今日已備份（${last}）</span>`;
    } else if (days <= 7) {
      el.innerHTML = `<span style="color: var(--success);">✓ ${days} 天前備份過（${last}）</span>`;
    } else if (days <= config.backupRemindDays) {
      el.innerHTML = `<span style="color: var(--warning);">⏱️ ${days} 天前備份過（${last}）</span>`;
    } else {
      el.innerHTML = `<span style="color: var(--danger);">⚠️ 已超過 ${days} 天沒備份（上次 ${last}）</span>`;
    }
  }
}

function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!confirm(`將匯入 ${d.clients?.length||0} 位業主、${d.jobs?.length||0} 筆案件，會覆蓋現有資料。確定？`)) return;
      state.clients = d.clients || [];
      state.jobs = (d.jobs || []).map(j => ({
        ...j,
        paid: j.paid ?? false,
        doneAt: j.doneAt ?? (j.done ? (j.date || todayStr()) : null),
        paidAt: j.paidAt ?? (j.paid ? (j.date || todayStr()) : null)
      }));
      save(); render(); toast('✓ 已匯入');
    } catch(err) { alert('檔案格式錯誤'); }
  };
  r.readAsText(f);
}

function loadDemo() {
  if (state.clients.length && !confirm('會覆蓋現有資料。確定？')) return;
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
  if (!confirm('確定要清空所有資料？無法復原。')) return;
  state.clients = []; state.jobs = [];
  save(); render(); toast('已清空');
}

// ============== 事件監聽 ==============
document.getElementById('inv-client').addEventListener('change', drawInvoice);
document.getElementById('inv-month').addEventListener('change', drawInvoice);

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
    idle:    { icon: '○',  text: '未啟用',    cls: 'idle' },
    syncing: { icon: '⏳', text: '同步中',     cls: 'syncing' },
    synced:  { icon: '✓',  text: '已同步',     cls: 'synced' },
    offline: { icon: '⚠',  text: '離線',       cls: 'offline' },
    error:   { icon: '✗',  text: '錯誤',       cls: 'error' }
  };
  const s = map[status] || map.idle;
  el.className = `sync-indicator sync-${s.cls}`;
  el.innerHTML = `${s.icon} ${s.text}`;
  el.title = err ? `錯誤：${err}` : (config.sheetConfig?.lastSyncAt ? `上次同步：${config.sheetConfig.lastSyncAt}` : '尚未同步');
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
    el.innerHTML = '<span style="color: var(--muted);">未設定 API URL</span>';
  } else if (!config.sheetSyncEnabled) {
    el.innerHTML = '<span style="color: var(--muted);">同步已停用</span>';
  } else {
    const when = cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toLocaleString('zh-TW') : '尚未';
    el.innerHTML = `<span style="color: var(--success);">✓ 自動同步已啟用</span><br><span style="font-size: 11px; color: var(--muted);">上次推送：${when}</span>`;
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
  } else if (!config.calEnabled) {
    badge.textContent = '已停用';
  } else {
    badge.textContent = '✓ 已啟用';
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

// ============== LINE（已停用）==============
function loadLineConfigUI() {
  // LINE Notify 已停用 - 此函式保留避免 init 出錯
  const g = (id) => document.getElementById(id);
  if (!g('line-enabled')) return;
  g('line-enabled').checked = !!config.lineEnabled;
  g('line-token').value = config.lineToken || '';
  g('line-daily-time').value = config.lineDailyTime || '09:00';
  g('line-weekly').checked = !!config.lineWeeklySummary;
  g('line-notify-today').checked = config.lineNotifyToday !== false;
  document.getElementById('line-notify-overdue').checked = config.lineNotifyOverdue !== false;
  document.getElementById('line-notify-duesoon').checked = config.lineNotifyDueSoon !== false;
  document.getElementById('line-duesoon-days').value = config.lineDueSoonDays || 3;
  document.getElementById('line-notify-unpaid').checked = config.lineNotifyUnpaidLong !== false;
  document.getElementById('line-notify-monthend').checked = config.lineNotifyMonthEnd !== false;
  document.getElementById('line-monthend-day').value = config.lineMonthEndDay || 25;
  updateLineStatusBadge();
}

function updateLineStatusBadge() {
  const badge = document.getElementById('line-status-badge');
  if (!config.lineToken) {
    badge.textContent = '未設定';
    badge.style.background = 'rgba(255,255,255,0.2)';
  } else if (!config.lineEnabled) {
    badge.textContent = '已停用';
    badge.style.background = 'rgba(255,255,255,0.3)';
  } else {
    badge.textContent = '✓ 已啟用（等 v0.3 後端）';
    badge.style.background = 'rgba(255,255,255,0.4)';
  }
}

function saveLineConfig() {
  config.lineEnabled = document.getElementById('line-enabled').checked;
  config.lineToken = document.getElementById('line-token').value.trim();
  config.lineDailyTime = document.getElementById('line-daily-time').value;
  config.lineWeeklySummary = document.getElementById('line-weekly').checked;
  config.lineNotifyToday = document.getElementById('line-notify-today').checked;
  config.lineNotifyOverdue = document.getElementById('line-notify-overdue').checked;
  config.lineNotifyDueSoon = document.getElementById('line-notify-duesoon').checked;
  config.lineDueSoonDays = Math.max(1, Math.min(14, +document.getElementById('line-duesoon-days').value || 3));
  config.lineNotifyUnpaidLong = document.getElementById('line-notify-unpaid').checked;
  config.lineNotifyMonthEnd = document.getElementById('line-notify-monthend').checked;
  config.lineMonthEndDay = Math.max(1, Math.min(31, +document.getElementById('line-monthend-day').value || 25));
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  updateLineStatusBadge();
  toast('✓ 已儲存 LINE 設定');
}

function toggleTokenVisibility() {
  const input = document.getElementById('line-token');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function sendTestNotification() {
  if (!config.lineToken) {
    toast('請先填入 LINE Notify Token');
    return;
  }
  alert(
    '🚧 尚未連接後端\n\n' +
    '要真的發送 LINE 訊息需要 Google Apps Script 當後端定時任務，' +
    '這是 v0.3 的工作項目。\n\n' +
    '目前你可以先：\n' +
    '1. 把 Token 和偏好設定填好（會存著）\n' +
    '2. 按「預覽訊息」看每天會收到什麼樣的訊息\n' +
    '3. 等 v0.3 Apps Script 做完後，會自動用這些設定啟動推播'
  );
}

// 產生會推播的 LINE 訊息內容（依目前資料）
function buildLineMessage() {
  const lines = [];
  const today = todayStr();
  const now = new Date();
  const timeStr = now.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
  lines.push(`☀️ 早安！${timeStr}`);
  lines.push('');

  // 1. 今日排程
  if (config.lineNotifyToday) {
    const todayJobs = state.jobs.filter(j => !j.done && j.date === today);
    if (todayJobs.length) {
      lines.push(`📅 今日排程（${todayJobs.length} 筆）：`);
      todayJobs.forEach(j => {
        const c = getClient(j.clientId);
        lines.push(`・${c?c.name:'未指定'} - ${j.title} ${fmt(+j.amount||0)}`);
      });
      lines.push('');
    }
  }

  // 2. 逾期未完成
  if (config.lineNotifyOverdue) {
    const overdue = state.jobs.filter(j => !j.done && j.date && j.date < today);
    if (overdue.length) {
      lines.push(`🔴 逾期未完成（${overdue.length} 筆）：`);
      overdue.forEach(j => {
        const days = daysBetween(j.date, today);
        lines.push(`・${j.title} (超過 ${days} 天)`);
      });
      lines.push('');
    }
  }

  // 3. 即將到期
  if (config.lineNotifyDueSoon) {
    const until = addDays(new Date(), config.lineDueSoonDays);
    const soon = state.jobs.filter(j => !j.done && j.date > today && j.date <= until);
    if (soon.length) {
      lines.push(`🟡 未來 ${config.lineDueSoonDays} 天到期：`);
      soon.forEach(j => {
        lines.push(`・${j.date.slice(5)} ${j.title}`);
      });
      lines.push('');
    }
  }

  // 4. 待收款過久
  if (config.lineNotifyUnpaidLong) {
    const threshold = addDays(new Date(), -config.unpaidRemindDays);
    const unpaid = state.jobs.filter(j => j.done && !j.paid && j.doneAt && j.doneAt <= threshold);
    if (unpaid.length) {
      const byClient = {};
      unpaid.forEach(j => {
        const c = getClient(j.clientId);
        const name = c ? c.name : '未指定';
        if (!byClient[name]) byClient[name] = { amt: 0, cnt: 0 };
        byClient[name].amt += (+j.amount||0);
        byClient[name].cnt += 1;
      });
      lines.push(`💰 待收款（完成 > ${config.unpaidRemindDays} 天）：`);
      Object.entries(byClient).forEach(([name, d]) => {
        lines.push(`・${name} ${fmt(d.amt)} (${d.cnt} 筆)`);
      });
      const total = unpaid.reduce((s,j) => s + (+j.amount||0), 0);
      lines.push(`　合計 ${fmt(total)}`);
      lines.push('');
    }
  }

  // 5. 月底提醒
  if (config.lineNotifyMonthEnd && now.getDate() >= config.lineMonthEndDay) {
    const mm = thisMonth();
    const monthUnpaid = state.jobs.filter(j => j.done && !j.paid && getMonth(j.date) === mm);
    if (monthUnpaid.length) {
      const amt = monthUnpaid.reduce((s,j) => s + (+j.amount||0), 0);
      lines.push(`📨 月底將至！本月可請款：`);
      lines.push(`　${monthUnpaid.length} 筆　共 ${fmt(amt)}`);
      lines.push(`　→ 記得產生請款單寄給業主`);
      lines.push('');
    }
  }

  if (lines.length <= 2) {
    lines.push('🎉 今天沒有待辦，繼續保持！');
  }

  return lines.join('\n').trim();
}

function previewLineMessage() {
  const msg = buildLineMessage();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  document.getElementById('line-preview-body').innerHTML = `
    <div class="line-msg-time">${timeStr}</div>
    <div class="line-msg-bubble">${escapeHtml(msg)}</div>
  `;
  document.getElementById('line-preview-modal').classList.add('open');
}

function closeLinePreview() {
  document.getElementById('line-preview-modal').classList.remove('open');
}

// ============== Init ==============
load();
document.getElementById('cfg-unpaid-days').textContent = config.unpaidRemindDays;
document.getElementById('cfg-unpaid-days-input').value = config.unpaidRemindDays;
loadUserInfoUI();
loadSheetConfigUI();
loadCalendarConfigUI();
loadLineConfigUI();
updateSheetSyncBadge();
render();

// 啟動時若同步已啟用，自動從 Sheet 拉取最新資料
if (config.sheetSyncEnabled && config.sheetConfig?.apiUrl && config.sheetConfig?.apiToken) {
  setTimeout(() => pullFromSheet(true), 500);
} else {
  setSyncStatus('idle');
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
