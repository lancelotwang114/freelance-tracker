# 外包收益與排程管理 (Freelance Tracker)

個人接案工作者的輕量網頁工具 — 取代 Google Sheet 記帳、月底截圖請款、跨裝置同步、案件提醒一站搞定。

🔗 **線上版**：https://lancelotwang114.github.io/freelance-tracker/

---

## ✨ 核心功能

### 案件 / 業主管理
- 案件雙狀態（完成 / 收款）獨立勾選，完整支援部分收款、結清、呆帳註記
- 業主可設顏色、固定請款日、儲值制（預付制）、介紹人分潤
- 案件批次操作（標完成 / 標收款 / 設折扣 / 取消）
- 業主搜尋、月份階層篩選、自訂月份範圍

### 收益分析
- 總覽：本月已收 / 待收、年度累計、近期案件、月度趨勢圖
- 收益分頁：堆疊柱狀圖（已收 + 待收）、業主貢獻排行、單價趨勢
- GitHub-style 時間熱圖、案件類型分佈派圖、業主活躍度時間軸
- 全期年度趨勢線、跨業主月度報表

### 請款單
- 選業主 + 月份（或月份區間）一鍵產生
- 5 種狀態篩選預設（請款 / 對帳 / 進度 / 全部）+ 自訂組合
- 下載 PDF / 下載圖片 / **直接複製圖片到剪貼簿**（貼給業主免下載）
- 自動帶入「我的資料」區塊的姓名、匯款資訊
- 多月合併請款、折扣欄位智慧顯示

### 雲端同步（Google Sheet）
- 自訂 Apps Script 後端 → 你自己的 Google Sheet 當資料庫
- 雲端優先模式 + 每 30 秒自動偵測 → 多裝置零衝突
- 10-chunk snapshot 系統（單次備份上限 ~450KB）
- 備份歷史 modal + 還原預覽（顯示 diff 比對）
- 每日強制備份（Apps Script trigger，凌晨 3:00 自動跑）
- 跨裝置設定檔匯出/匯入（換裝置免重填 token）

### 行事曆同步
- iCal 訂閱連結（手機原生行事曆訂閱）
- Google Calendar 雙向同步：把案件 + 6 種 App 提醒（逾期 / 即將到期 / 完成已久未收 / 月底 / 業主請款日 / 智慧拖款）一起寫進日曆
- 提醒時間可調（跟隨 App「即將到期」設定 / 自訂）
- 業主顏色自動對應到 Google Calendar 顏色

### 提醒系統
- 7 種提醒類型可獨立啟用/關閉、調整天數
- 業主層級可覆寫全域設定（例如某個業主寬限期較長）
- 智慧拖款警告：依該業主歷史平均收款週期判斷異常
- 桌面通知（PWA 模式下類似原生 APP）

### 操作日誌
- 最近 500 筆操作可查看（新增 / 編輯 / 刪除 / 同步 / 還原 / 批次）
- 支援類型 / 業主 / 日期篩選
- 從備份還原前可看 diff 預覽（避免還原錯版本）

### 其他
- 暗色 / 淺色 / 自動主題（右上快捷切換）
- PWA 安裝（手機 / 桌面）
- Service Worker 離線可用 + 版本更新偵測
- CSV 匯出（適合做帳）

---

## 🚀 快速上手

### 純本地使用（最簡單）

1. 下載 zip 解壓 → 用瀏覽器打開 `index.html`
2. 「設定」分頁 →「載入範例資料」看完整效果
3. 清空範例後從「業主」分頁新增第一個業主，開始記錄

### 部署到 GitHub Pages（推薦）

詳見 [`docs/PUBLISH-TO-GITHUB-PAGES.md`](docs/PUBLISH-TO-GITHUB-PAGES.md)

### 連雲端同步（多裝置 / 永久備份）

詳見 [`backend/SETUP.md`](backend/SETUP.md) — 步驟：

1. 建立你自己的 Google Sheet
2. 部署 [`backend/apps-script.gs`](backend/apps-script.gs) 為 Web App
3. 把 Web App URL + 自訂 token 填到 App「☁️ 雲端同步」設定

### 連 Google Calendar

詳見 [`backend/CALENDAR-SETUP.md`](backend/CALENDAR-SETUP.md)

---

## 📁 檔案結構

```
freelance-tracker/
├── index.html              主畫面 + 所有 modal
├── css/
│   └── style.css           完整樣式表（含暗色模式）
├── js/
│   └── app.js              所有邏輯（資料 / 渲染 / 同步 / 提醒）
├── service-worker.js       離線快取 + 版本管理
├── manifest.json           PWA 安裝設定
├── backend/
│   ├── apps-script.gs      Google Apps Script 後端
│   ├── SETUP.md            雲端同步部署教學
│   └── CALENDAR-SETUP.md   Google Calendar 同步教學
├── docs/
│   ├── ROADMAP.md          未來功能計畫
│   └── PUBLISH-TO-GITHUB-PAGES.md
├── CHANGELOG.md            版本更新歷史
└── README.md
```

> `imports/` 與 `freelance-backup-*.json` 已在 `.gitignore` — 真實業主資料不會上傳。

---

## 💾 資料儲存

| 層級 | 位置 | 用途 |
|------|------|------|
| 本機 | `localStorage` | 所有資料即時操作（離線可用） |
| 雲端（選用） | Google Sheet（自己的） | 跨裝置同步、永久備份、snapshot 歷史 |
| 行事曆（選用） | Google Calendar / iCal feed | 案件截止日提醒 |

**Schema 版本：** 7（含 migration 機制，舊資料自動升級）

**localStorage key：** `freelance-tracker-v1`

---

## 🔒 隱私與安全

- 所有資料只存在你自己的瀏覽器 + 你自己的 Google Sheet（沒有第三方伺服器）
- Apps Script API token 由你自訂，不分享給其他人
- iCal 訂閱連結含 token，請勿外流
- `跨裝置設定檔` 含連線密碼，請放隨身碟或密碼管理器，勿傳到 Email / 聊天群組
- `imports/`、備份 JSON 已在 `.gitignore`，不會被推到 GitHub

---

## 🛠 技術棧

- 純 HTML / CSS / 原生 JavaScript（無框架、無打包）
- Google Apps Script（後端）
- Google Sheet（資料庫）
- Service Worker（離線 + 快取版本控制）
- 第三方函式庫（CDN 載入）：`html2canvas`、`jsPDF`

---

## 📜 版本歷史

完整版本紀錄請見 [`CHANGELOG.md`](CHANGELOG.md)。

**目前版本：v2.10.5**

最近重點：
- v2.10：Google Calendar 雙向同步、提醒時間可調、暗色模式請款單修復、設定頁重組
- v2.9：操作日誌、備份歷史 modal + 還原 diff 預覽、payments 多次部分收款
- v2.8：smart late-pay 智慧拖款警告、業主固定請款日
- v2.7：業主健康度、初次使用引導
- v2.5：跨業主月度報表、時間熱圖
- v2.0：Google Sheet 雙向同步、snapshot 備份系統
- v1.0：解耦完成/收款狀態、業主儲值制
- v0.x：原型開發階段

---

## 📋 開發計畫

請見 [`docs/ROADMAP.md`](docs/ROADMAP.md)

---

## 📝 授權

個人使用專案，本人自用與迭代。歡迎 fork 後自行修改使用，但請自行承擔資料安全責任。
