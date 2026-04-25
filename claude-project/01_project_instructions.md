# Claude Project 自訂指令（Custom Instructions）

> 把下方「=== 開始 ===」和「=== 結束 ===」之間的內容，完整複製貼到 Claude.ai 的 Project → Settings → Custom Instructions 欄位。

---

=== 開始 ===

## 專案：外包收益與排程管理工具（freelance-tracker）

這是一個給個人接案工作者使用的輕量網頁工具，用來取代 Google Sheet 的記帳 + 月底截圖請款流程。使用者是自由接案工作者，原本用 Google Sheet 管理，我們在 2026-04 把它搬成一個單機網頁 MVP，下一步計畫接 Google Sheet 當後端。

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
- **儲存（目前）：** 瀏覽器 localStorage，key = `freelance-tracker-v1`
- **儲存（下一步）：** Google Apps Script + Google Sheet 當後端，非 Firebase / Supabase
- **部署規劃：** GitHub Pages 或 Vercel（免費、免伺服器）
- **檔案結構：** `index.html` + `css/style.css` + `js/app.js`，分成三個檔案即可，不要再拆

## 已完成（v0.1 MVP）

- 案件 CRUD（日期、業主、標題、細項、金額、完成狀態）
- 業主 CRUD（名稱、顏色、備註）
- 儀表板（本月已完成 / 待完成 / 年度累計 / 月度趨勢條）
- 案件清單（月份 + 業主篩選）
- 請款單產生（選業主 + 月份，可列印 / 存 PDF / 複製純文字）
- 業主分享連結（`?client=xxx` 進入唯讀檢視，業主只看自己那份）
- JSON 匯出 / 匯入備份
- 範例資料一鍵載入

## 待辦（依優先順序）

1. **v0.2 Google Sheet 後端：** 寫 Apps Script，讓資料跨裝置同步
2. **v0.3 部署：** 推上 GitHub Pages，讓業主可以直接用網址打開
3. **v0.4 請款單強化：** 加使用者資料（姓名、匯款帳號、LOGO）、二代健保補充保費計算、請款編號
4. **v0.5 進階：** PWA、深色模式、甘特圖、各業主貢獻度餅圖

完整路線圖在 `docs/ROADMAP.md`。

## 資料結構

```json
{
  "clients": [
    { "id": "ab12cd", "name": "A 公司", "color": "#ef4444", "note": "月結" }
  ],
  "jobs": [
    {
      "id": "xy34ef",
      "clientId": "ab12cd",
      "date": "2026-04-15",
      "title": "首頁改版",
      "details": "首頁 + 3 內頁",
      "amount": 18000,
      "done": true
    }
  ]
}
```

## 跟 Claude 協作的規則

- **語言：** 一律繁體中文（回答、程式碼註解、UI 文字）
- **風格：** 避免過度設計。使用者要的是「略懂但想省力」的水準，不要引入複雜框架或架構
- **決策點：** 有重大變動（例如換技術、改資料結構、加大功能）**先問再做**，用 AskUserQuestion 給 2~4 個選項
- **金額顯示：** 一律 `NT$` 前綴 + 千分位
- **日期格式：** `YYYY-MM-DD`；月份 `YYYY-MM`
- **配色：** 跟 `css/style.css` 裡的 CSS 變數保持一致，主色 `#2563eb`（藍）、成功 `#10b981`（綠）
- **不要：**
  - 不要把單檔 HTML 拆得比「index + css + js」更細
  - 不要加不必要的依賴（npm package、CDN 套件）
  - 不要未經同意就改資料結構
  - 不要刪除或覆蓋使用者的資料備份檔（`freelance-backup-*.json`）

## 常見請求的處理方式

- 「幫我加 XX 功能」 → 先確認屬於哪個 v 版本、是否跟 ROADMAP 一致，再動工
- 「接 Google Sheet」 → 走 v0.2 路線，用 Apps Script doGet/doPost
- 「部署」 → 用 GitHub Pages（靜態站，直接 push 就好）
- 「匯入舊資料」 → 寫一次性轉檔腳本，把 Google Sheet 的欄位對映到我們的 JSON 結構

=== 結束 ===

---

## 用法

1. 到 [claude.ai](https://claude.ai) → 左側 Projects → Create Project
2. 取名：`外包收益管理工具` 或 `freelance-tracker`
3. 進入 Project → Settings → **Custom Instructions**
4. 把上面「=== 開始 ===」到「=== 結束 ===」之間的內容貼進去
5. 儲存
