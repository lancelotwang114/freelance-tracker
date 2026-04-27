# 專案緣起與決策摘要

> 這份文件記錄這個專案從「一個 Google Sheet」演化成「網頁工具」的對話脈絡與決策理由。上傳到 Claude Project 當知識檔，之後跟 Claude 協作時它會有完整背景。
>
> **最後更新：2026-04-27（對齊 v2.10.5）**
>
> 第一～九節是 2026-04 初 v0.1 MVP 階段的設計決策紀錄；**第十節之後**補上 v0.2 → v2.10 的演進摘要。

## 一、原始需求

使用者想做一個 App 或網頁工具，替換現有的 Google Sheet（[原始 Sheet](https://docs.google.com/spreadsheets/d/1JJvSIOfyTYTxjvo48byhWf5zkt9Lneon6M745NQ8Pyc/edit?gid=222820314#gid=222820314)）來記錄外包收益與工作排程。

**使用者原本的工作流程：**

```
收到業主需求
    ↓
安排日期
    ↓
表格上記錄細項 + 金額（給業主看）
    ↓
完成打勾
    ↓
月底截圖總額請款（給業主看）
```

## 二、釐清階段的問答

Claude 給了四個方案：

1. 進階版 Google Sheets（Apps Script 自動化）
2. Notion / AirTable
3. 自建輕量網頁工具
4. 現成 Freelancer 工具（Bonsai、HoneyBook）

**使用者的選擇：**

| 問題 | 答案 |
|------|------|
| 理想中的工具形式？ | 輕量網頁工具 |
| Google Sheet 最痛的點？ | 全部都痛（月底手動截圖算總額、多業主管理混亂、手機不方便、沒有統計報表） |
| 技術背景？ | 略懂但想省力 |

## 三、技術決策

基於上述回答，定案：

| 面向 | 決策 | 理由 |
|------|------|------|
| 前端 | Vanilla HTML/CSS/JS | 使用者略懂、想省力，不該引入 React 等複雜度 |
| 儲存（MVP） | localStorage | 零成本、立刻能用、方便驗證流程 |
| 儲存（下一步） | Google Sheet + Apps Script | 保留使用者熟悉的 Sheet 當備份，免伺服器維護 |
| 部署 | GitHub Pages / Vercel | 免費、靜態站、門檻低 |
| UI 語言 | 繁體中文 | 使用者是台灣接案工作者 |

**不選 Notion 的理由：** 雖然能滿足功能，但月費、不夠客製、對業主分享檢視較受限。

**不選現成 SaaS 的理由：** 多半英文界面、業主不一定習慣；也是 overkill。

## 四、MVP 實作內容（v0.1）

做了一個單檔 HTML 原型，然後拆成正式專案結構：

```
freelance-tracker/
├── index.html              主畫面
├── css/style.css           樣式
├── js/app.js               邏輯
├── docs/ROADMAP.md         路線圖
├── README.md               專案說明
├── .gitignore
└── claude-project/         Claude Project 設定包
```

## 五、痛點對應表

| 使用者原本的痛 | 工具怎麼解 |
|--------------|-----------|
| 月底要手動截圖、算總額 | 請款單分頁一鍵產生，可列印/存 PDF/複製純文字 |
| 多個業主管理混亂 | 每個業主可設顏色；有分享連結讓業主只看自己那份 |
| 手機上操作不方便 | 響應式設計、右下角 FAB 按鈕、Modal 直接從下方滑出 |
| 沒有收入統計 / 報表 | 總覽頁有本月已完成/待完成/年度累計 + 月度趨勢條 |

## 六、流程對應表

| 原工作流程 | 新工具操作 |
|-----------|-----------|
| 收到業主需求 | 「業主」分頁 → 新增業主（只需一次） |
| 安排日期 | 新增案件時填日期欄位 |
| 表格細項+金額 | 新增案件時填標題、細項、金額 |
| 給業主看 | 「業主」分頁 → 複製分享連結 |
| 完成打勾 | 點案件前方的方框 |
| 月底截圖請款 | 「請款單」分頁 → 選業主+月份 → 列印 / 存 PDF |

## 七、關鍵資料結構

```json
{
  "clients": [
    {
      "id": "短 ID（隨機 8 碼）",
      "name": "業主名稱",
      "color": "業主顏色 HEX",
      "note": "備註（聯絡人、匯款帳號等）"
    }
  ],
  "jobs": [
    {
      "id": "短 ID",
      "clientId": "關聯業主 ID",
      "date": "YYYY-MM-DD",
      "title": "案件名稱",
      "details": "細項說明（業主看得到）",
      "amount": 數字金額,
      "done": true/false
    }
  ]
}
```

**儲存位置：** 瀏覽器 localStorage，key 為 `freelance-tracker-v1`。

## 八、下一步待辦（v0.1 當時規劃，已過時）

> ⚠️ 這是 v0.1 完成時定下的下一步；**目前實際版本已迭代到 v2.10.5**，本節清單裡的東西全都做完且超過了。現行 ROADMAP 看根目錄 `ROADMAP.md`。

1. ~~v0.2 Google Sheet 後端~~ → 已於 v2.0 完成
2. ~~v0.3 部署~~ → 已部署到 `https://lancelotwang114.github.io/freelance-tracker/`
3. ~~v0.4 請款單強化~~ → 「我的資料」帶入完成；稅率 / 二代健保保留未做
4. ~~v0.5 進階~~ → PWA、深色模式、圖表完成；甘特圖未做（已歸入 v2.6 子任務範疇）

## 九、協作約定（給 Claude 看的提醒）

- 回答、程式碼註解、UI 文字一律繁體中文
- 避免過度設計；使用者是「略懂但想省力」
- 重大決策前先問再做（用 AskUserQuestion 給選項）
- 不擅自引入新框架 / 依賴
- 不擅自修改資料結構（schema 改動要同步 migration + Apps Script COLS）
- 金額用 `NT$` + 千分位；日期用 `YYYY-MM-DD`
- 暗色模式下請款單必須維持白底深字（紙張外觀）

## 十、v0.1 之後的演進摘要（2026-04 持續迭代）

| 版本群 | 月份 | 主題 | 重點 |
|------|------|------|------|
| v0.2 ~ v0.3 | 2025-12 ~ 2026-01 | 雙狀態 + 收益分頁 | `paid` / `doneAt` / `paidAt`、堆疊柱狀圖、業主貢獻排行、備份提醒、iCal 訂閱、行事曆月檢視 |
| v1.0 | 2026-02 | 解耦完成 / 收款 + 業主儲值制 | 雙勾勾、批次操作、業主搜尋與排序、多月合併請款、月份階層篩選 |
| v2.0 | 2026-03 | 雲端同步 | Apps Script 雙向同步、snapshot 備份系統、每日 03:00 自動 trigger、同步狀態指示器、Lab 模式 |
| v2.5 | 2026-04 上 | 跨裝置 + 衝突保護 | 跨裝置設定檔匯出 / 匯入、ABC 衝突保護機制 |
| v2.7 | 2026-04 上 | 業主洞見 | 業主健康度、初次使用引導、分潤系統、CSV 匯出、時間熱圖、案件類型派圖、跨業主月報 |
| v2.9 | 2026-04 中 | 操作日誌 + 部分收款 | 最近 500 筆操作日誌、備份還原 diff 預覽、`payments[]` 多筆部分收款、業主固定請款日、智慧拖款警告 |
| v2.10 | 2026-04-27 | Calendar 同步 + 請款單篩選 | Google Calendar 同步全 6 種提醒、提醒時間可調、請款單狀態篩選 UI（preset + checkbox）、暗色模式請款單修復、複製圖片到剪貼簿 |

## 十一、目前的技術現況（v2.10.5）

- **前端：** 純 HTML / CSS / 原生 JS，無框架；只引入 `html2canvas` + `jsPDF` 兩個 CDN 套件
- **資料層：** localStorage（schema v7，含 migration）+ Google Apps Script + Google Sheet 雙向同步
- **離線：** Service Worker + PWA manifest，可加到主畫面、版本更新偵測
- **部署：** GitHub Pages（`https://lancelotwang114.github.io/freelance-tracker/`）
- **行事曆：** Google Calendar 雙向 + iCal 訂閱（已隱藏 UI 但程式碼保留）
- **檔案結構：**
  ```
  index.html / css/style.css / js/app.js
  service-worker.js / manifest.json
  backend/apps-script.gs（+ SETUP.md / CALENDAR-SETUP.md）
  docs/ROADMAP.md（v0.x 歷史）/ ROADMAP.md（現行）
  CHANGELOG.md / README.md
  claude-project/（Claude Project 設定包，本目錄）
  ```

## 十二、下一步（v2.5+，現行）

詳見根目錄 `ROADMAP.md`。摘要：

1. **v2.5 — 業主洞見 + 通知**（進行中）：業主健康度儀表板、瀏覽器原生通知、iCal 訂閱輸出
2. **v2.6 — 工作流自動化**：估價單、子任務 / Checklist、番茄鐘 / 計時器
3. **v2.7 — 資料分析**：忙閒週期、個人時薪趨勢、模糊重複偵測
4. **v2.8 — UX 優化**：自訂顏色主題、拖曳排序、Undo / Redo
