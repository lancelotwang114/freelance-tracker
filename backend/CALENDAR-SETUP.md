# Google Calendar 同步設定教學

這份教學分三段：

1. **基礎：** 同步到 Apps Script 帳號的 Calendar（最簡單）
2. **進階：** 同步到其他 Google 帳號的 Calendar（例如你的主 Gmail）
3. **TimeTree：** 把 Google Calendar 訂閱到 TimeTree

---

## 前置條件

- 已經照 `SETUP.md` 部署好 Apps Script（有 Web App URL + Token）
- 前端 APP 也連上後端了（設定頁「Apps Script 後端」區塊填好、測試連線成功）

---

## 情境 1：同步到 Apps Script 帳號的 Calendar（最簡單）

**適合：** Apps Script 部署的 Google 帳號 = 你常看 Google Calendar 的帳號。

### 步驟

1. 打開 [Google Calendar](https://calendar.google.com)（用 **Apps Script 部署的帳號** 登入）
2. 左側「我的日曆」可以看到預設日曆（通常是你 Email）
3. 點預設日曆右邊的 **⋮ → 設定和共用**
4. 往下滑到「**整合日曆**」區塊
5. 複製「**日曆 ID**」（通常就是你的 Email 地址）
6. 回到 APP 設定頁「**Google Calendar 同步**」區塊
7. 貼上 Calendar ID → 按「測試連線」→ 看到 ✓ 成功
8. 啟用開關打開 → 按「**🔄 立即同步**」
9. 回 Google Calendar 看，所有案件都會出現（依業主顏色標記）

---

## 情境 2：同步到其他 Google 帳號的 Calendar ⭐ 推薦

**適合：** Apps Script 部署的帳號 ≠ 你看 Calendar 的帳號（例如部署在備用帳號，看 Calendar 用主帳號）。

### 架構說明

```
你的主帳號 (例: you@gmail.com)
  ├─ 建立一個日曆「外包案件」
  └─ 把這個日曆「分享」給 Apps Script 帳號（給編輯權限）

Apps Script 帳號 (例: backup@gmail.com)
  └─ 收到分享 → 有權限寫入主帳號的日曆 → 同步案件
```

### 步驟

#### A. 在「主帳號」建立新日曆

1. 登入**主帳號**（你常看的）→ 打開 [Google Calendar](https://calendar.google.com)
2. 左側「其他日曆」旁邊的 **+ 號 → 建立新日曆**
3. 名稱：`外包案件`（或你喜歡的名字）
4. 建立完後會出現在左側「我的日曆」

#### B. 把這個日曆分享給 Apps Script 帳號

1. 新建日曆右邊的 **⋮ → 設定和共用**
2. 往下滑到「**與特定使用者或群組共用**」
3. 點 **+ 新增使用者或群組**
4. 填入 Apps Script 部署的那個 Google 帳號的 email（例如 `backup@gmail.com`）
5. 權限選 **「變更活動」**（這是寫入權限，重要！）
6. 按「**傳送**」

#### C. 取得 Calendar ID

1. 同一頁往下找「**整合日曆**」區塊
2. 複製「**日曆 ID**」（格式長這樣：`abc123xyz@group.calendar.google.com`）

#### D. 回到 APP 設定

1. APP 設定頁 → Google Calendar 同步
2. Calendar ID 貼上剛剛複製的
3. 按「測試連線」
4. 如果看到 ✓ 成功 + Calendar 名稱顯示「外包案件」，代表權限 OK
5. 啟用開關打開 → 按「🔄 立即同步」

這樣你用**主帳號**打開 Google Calendar 就能看到所有同步的案件。

---

## 情境 3：同步到多個日曆

如果想分工作日曆 / 個人日曆：
- 建多個日曆（例如「外包-業主A」、「外包-業主B」）
- 每次改 Calendar ID 再同步一次
- 或者之後我們可以做成「依業主分別同步到不同日曆」（需要程式擴充）

---

## 🕐 TimeTree 訂閱 Google Calendar

### 誠實說明：限制

TimeTree 的外部日曆功能**部分需要 Premium（付費）**。以下三個方法依「省錢 → 功能完整」排序：

### 方法 A：手機系統日曆（免費、推薦）

**其實你不一定要用 TimeTree**。你現在的設定下，手機上只要：

**iPhone 使用者：**
1. 打開「**設定 → 郵件 → 帳號 → 新增帳號 → Google**」
2. 登入你的 Google 帳號（就是剛剛同步到的那個）
3. 打開「**行事曆**」同步開關
4. 現在 iPhone 內建的「**行事曆**」App 就會顯示所有案件
5. 點事件 → 可設通知時間（預設前一天 18:00）

**Android 使用者：**
- **Google Calendar App** 直接登入帳號就看到了
- 事件會有原生系統通知

優點：
- 完全免費
- 通知是 iOS / Android 原生，很可靠
- 不需要額外 App

### 方法 B：TimeTree 連結 Google Calendar（Premium 付費）

如果你堅持要用 TimeTree 介面：

1. 開啟 TimeTree App
2. 設定 → **高級功能**（Premium）
3. 訂閱月費（台幣約 70 元/月，或年費約 700 元）
4. 進入「**連結其他日曆**」
5. 選 Google → 登入你的帳號 → 選要連結的日曆（例如「外包案件」）
6. TimeTree 內就會看到所有事件

### 方法 C：iCal 公開連結 + TimeTree 匯入（免費但不即時）

這是免費的迂迴做法，但 TimeTree 只支援**一次性匯入**，不是自動訂閱：

1. Google Calendar → 目標日曆設定 → **整合日曆**
2. 如果日曆是公開的，會有「**公開網址（iCal 格式）**」
3. 複製那個 `.ics` 連結，瀏覽器下載 `.ics` 檔
4. TimeTree → 設定 → 匯入 → 選 `.ics` 檔
5. 以後每次更新都要重複這個流程（**不會自動同步**）

**不推薦方法 C**，太麻煩。

---

## 🎯 我的建議

1. **短期：** 用**情境 2**（同步到主帳號 Calendar）+ **方法 A**（手機系統日曆）
   - 完全免費
   - 手機看行事曆有原生通知
   - 所有事件都在 Google Calendar 集中管理

2. **真的要 TimeTree：** 先免費試用方法 A，覺得 Google Calendar 夠用就不用花錢了。如果還是想用 TimeTree，再考慮付 Premium。

---

## 🎨 事件顯示效果

同步後，Google Calendar 上的事件長這樣：

```
[ftracker] 耀群醫美 - yt封面-隆乳層次 [✓完成 $已收]
2024-01-24 全天
```

**說明：**
- 前綴 `[ftracker]` 是辨識標記（用來識別是本工具建立的事件，重新同步時會先刪除舊的再建立新的，不會重複）
- 事件顏色會依業主顏色對應 Google Calendar 的 11 種預設色
- 事件內容（描述）包含：業主、金額、細項、狀態、完成日、收款日

---

## ⚙️ 同步邏輯

- **同步策略：** 刪除 + 重建（全量同步）
- **觸發時機：** 手動按「🔄 立即同步」；未來可啟用「自動同步」每次存檔後執行
- **執行位置：** 前端把資料送到 Apps Script，Apps Script 呼叫 Google Calendar API
- **執行時間：** 視案件數量，通常 10 秒內完成（100 筆以內）

### 重要注意事項

1. **每次同步會先刪除所有 `[ftracker]` 前綴的事件** — 如果你在 Google Calendar 手動加的事件**沒有這個前綴**，不會被刪除；**有前綴**就會被刪除。不要亂改同步過來事件的標題前綴。

2. **請勿把重要私人事件放在同一個日曆** — 雖然同步只刪除有 `[ftracker]` 前綴的，但建議**新建一個專屬日曆**（情境 2 的做法）才能隔離。

3. **離線改資料時不會同步** — 你在手機 APP 上改案件後，只有「線上且按了同步按鈕」才會真的推到 Calendar。

---

## 🆘 常見問題

**Q: 按「測試連線」失敗，錯誤訊息是「找不到此 Calendar」**
A: 檢查三個地方：
- Calendar ID 是否正確（沒有多餘空白）
- 如果是其他帳號的 Calendar，有沒有分享給 Apps Script 帳號（而且要「變更活動」權限，不是「只讀」）
- Apps Script 第一次執行 Calendar 操作時要授權，你可能沒完成授權流程

**Q: 同步成功但 Google Calendar 看不到事件**
A:
- 確認你打開的 Calendar 是正確的那一個（左側「我的日曆」清單裡要勾選顯示）
- 重新整理一次頁面
- 檢查事件日期範圍（`getEvents` 查詢是 -5 年 ~ +2 年，超過範圍不會顯示）

**Q: 可以同步到工作用的 Google Workspace 帳號嗎？（例如公司信箱）**
A: 可以，一樣用情境 2 的分享流程。但公司 IT 可能限制外部帳號共享，先問清楚 IT 政策。

**Q: 事件的通知時間可以設嗎？**
A: 目前同步過去的事件預設用 Google Calendar 帳戶的預設通知設定。若要客製（例如每個案件前一天 18:00 提醒），需要改 Apps Script 的 `syncCalendar_` 函式加 `event.addPopupReminder(minutes)` 之類。

**Q: 自動同步怎麼運作？**
A: 前端設定頁的「自動同步」開關打開後，每次你在 APP 新增 / 修改 / 刪除案件，會自動呼叫後端同步一次。代價是每次存檔有幾秒延遲（因為要等 Google 回應）。不急可以關掉，改用手動同步。
