# Claude Project 自訂指令（Custom Instructions）

> 把下方「=== 開始 ===」和「=== 結束 ===」之間的內容，完整複製貼到 Claude.ai 的 Project → Settings → Custom Instructions 欄位。
>
> **最後更新：2026-04-27（對齊 v2.10.5）**

---

=== 開始 ===

## 專案：外包收益與排程管理工具（freelance-tracker）

這是一個給個人接案工作者使用的輕量網頁工具，用來取代 Google Sheet 的記帳 + 月底截圖請款流程。使用者是自由接案工作者，原本用 Google Sheet 管理，2026-04 搬成單機網頁 MVP 後一路迭代到 v2.10.x，目前已經是「localStorage + 自架 Google Apps Script + Google Calendar」的多端同步工具。

## 使用者背景

- 身分：個人自由接案工作者（非開發團隊）
- 技術程度：略懂程式、偏好省力方案；**會寫但不想自己從零開始**
- 語言偏好：**繁體中文**（回答、UI、註解一律繁中）
- 工作流程：
  1. 收到業主需求
  2. 安排日期
  3. 表格上記錄細項 + 金額（給業主看）
  4. 完成打勾
  5. 月底截圖總額請款（給業主看）

## 技術決策（已定案，勿擅自更改）

- **前端：** Vanilla HTML / CSS / JS，**不用框架**（不用 React、Vue、Tailwind CDN），保持單純、零建置
- **本機儲存：** 瀏覽器 localStorage，key = `freelance-tracker-v1`，目前 schema 版本 **7**（含 migration 機制）
- **雲端後端（已上線）：** 自架 Google Apps Script + Google Sheet 當資料庫，雙向同步、10-chunk snapshot（~450KB / 次）、每日 03:00 自動備份 trigger
- **行事曆同步：** Google Calendar 雙向 + iCal feed
- **第三方依賴（CDN）：** `html2canvas`、`jsPDF`（請款單 PDF / 圖片匯出用），其他一律不加
- **部署：** GitHub Pages（已上線：`https://lancelotwang114.github.io/freelance-tracker/`）
- **離線：** Service Worker + PWA manifest，可加到主畫面、離線可用
- **檔案結構：** `index.html` + `css/style.css` + `js/app.js` + `service-worker.js` + `manifest.json` + `backend/apps-script.gs`，**不要再拆**

## 已完成（v0.1 → v2.10.5）

完整 CHANGELOG 在 `CHANGELOG.md`。摘要：

- **核心：** 業主 / 案件 CRUD、雙狀態勾勾（完成 / 收款）、payments[] 多次部分收款、業主儲值制（預付）、批次操作、業主搜尋與排序
- **儀表 / 報表：** 月度趨勢、業主貢獻排行、堆疊柱狀圖、GitHub 風時間熱圖、案件類型派圖、跨業主月度報表、業主活躍度時間軸
- **請款單：** 自動帶入「我的資料」、多月合併、5 種狀態篩選預設（請款 / 對帳 / 進度 / 全部 / 自訂）+ checkbox 細調、列印 / PDF / 圖片下載 / **複製圖片到剪貼簿**
- **雲端：** Apps Script 雙向同步、snapshot 分層保留、編輯鎖、idle 保護、跨裝置設定檔匯出 / 匯入、備份歷史 + 還原 diff 預覽、雲端容量監控
- **行事曆：** Google Calendar 同步全部 6 種提醒（逾期 / 即將到期 / 完成已久未收 / 月底 / 業主請款日 / 智慧拖款）、提醒時間可調、iCal 訂閱
- **提醒：** 7 種類型、業主層級覆寫、智慧拖款警告、桌面通知（PWA）
- **體驗：** PWA、暗色 / 淺色 / 系統三模式、全域搜尋、操作日誌（最近 500 筆，可篩選）
- **安全：** schema 版本化、寫入回退、SCHEMA_TOO_OLD 拒絕、Lab 開發模式（暫停 push）

## 待辦（依優先順序）

完整路線圖在 `ROADMAP.md`（**注意：根目錄那份才是現行版**，`docs/ROADMAP.md` 是 v0.x 歷史檔）。

1. **v2.5（進行中）— 業主洞見 + 通知：** 業主健康度儀表板、瀏覽器原生通知、iCal 訂閱輸出
2. **v2.6 — 工作流自動化：** 估價單、子任務 / Checklist、番茄鐘 / 計時器
3. **v2.7 — 資料分析：** 忙閒週期、個人時薪趨勢、模糊重複偵測
4. **v2.8 — UX 優化：** 自訂顏色主題、拖曳排序、Undo / Redo、操作日誌強化

## 資料結構（Schema v7，重點欄位）

```json
{
  "clients": [
    {
      "id": "ab12cd",
      "name": "A 公司",
      "color": "#ef4444",
      "note": "月結",
      "billingDay": 25,
      "prepaid": { "balance": 0, "history": [] }
    }
  ],
  "jobs": [
    {
      "id": "xy34ef",
      "clientId": "ab12cd",
      "date": "2026-04-15",
      "endDate": "2026-04-20",
      "title": "首頁改版",
      "details": "首頁 + 3 內頁",
      "amount": 18000,
      "tag": "design",
      "done": true,
      "doneAt": "2026-04-18",
      "paid": false,
      "paidAt": null,
      "payments": [
        { "date": "2026-04-22", "amount": 9000 }
      ],
      "cancelled": false
    }
  ]
}
```

> 改 schema **必須先問**，且要同步處理 migration（`js/app.js` 內的 `migrateSchema()`）+ Apps Script 端 `COLS` 定義 + `_extra` JSON 防呆欄位。

## 跟 Claude 協作的規則

- **語言：** 一律繁體中文（回答、程式碼註解、UI 文字）
- **風格：** 避免過度設計。使用者要的是「略懂但想省力」的水準，不要引入複雜框架或架構
- **決策點：** 有重大變動（例如換技術、改資料結構、加大功能）**先問再做**，用 AskUserQuestion 給 2~4 個選項
- **金額顯示：** 一律 `NT$` 前綴 + 千分位
- **日期格式：** `YYYY-MM-DD`；月份 `YYYY-MM`
- **配色：** 跟 `css/style.css` 裡的 CSS 變數保持一致，主色 `#2563eb`（藍）、成功 `#10b981`（綠）；暗色模式請尊重 `[data-theme="dark"]` 與 `prefers-color-scheme`
- **不要：**
  - 不要把單檔 HTML 拆得比「index + css + js + service-worker + manifest + backend/apps-script.gs」更細
  - 不要加不必要的依賴（npm package、新 CDN 套件）；現有依賴只有 `html2canvas` + `jsPDF`
  - 不要未經同意就改資料結構
  - 不要刪除或覆蓋使用者的資料備份檔（`freelance-backup-*.json`、`imports/` 都在 `.gitignore`）
  - 不要動 schema migration 邏輯而沒升 SCHEMA_VERSION

## 常見請求的處理方式

- 「幫我加 XX 功能」 → 先確認屬於哪個 v 版本、是否跟 ROADMAP 一致，再動工
- 「Apps Script 端要改」 → 改 `backend/apps-script.gs`，記得同步前端 `pullFromSheet` / `pushToSheet`，並用 `compareAppVersion()` 判斷版本
- 「請款單樣式調整」 → 注意暗色模式下請款單必須維持紙張外觀（白底深字）
- 「同步出問題 / snapshot 太大」 → 先看 chunk 切分（目前 10-chunk = ~450KB 上限）與 `_extra` 欄位
- 「匯入舊資料」 → 寫一次性轉檔腳本放 `imports/`，把欄位對映到 schema v7 結構

=== 結束 ===

---

## 用法

1. 到 [claude.ai](https://claude.ai) → 左側 Projects → Create Project
2. 取名：`外包收益管理工具` 或 `freelance-tracker`
3. 進入 Project → Settings → **Custom Instructions**
4. 把上面「=== 開始 ===」到「=== 結束 ===」之間的內容貼進去
5. 儲存
