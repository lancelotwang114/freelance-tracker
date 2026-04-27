# 後端部署教學（Google Sheet + Apps Script）

整個過程大約 **15 分鐘**，不用寫一行程式，只需要複製貼上。

---

## 🎯 要做什麼

- 建立一個 Google Sheet 當資料倉庫
- 把 Apps Script 部署成一個 Web API
- 取得 API URL + Token，之後貼到前端就完成連接

---

## 步驟 1 — 建立 Google Sheet

1. 打開 [https://sheets.google.com](https://sheets.google.com)
2. 點 **空白** 建立新的試算表
3. 把檔案名稱改成 `freelance-tracker-data`（左上角預設是「未命名的試算表」，點一下改掉）

> 💡 這個 Sheet 你**不需要自己建分頁**，Apps Script 執行時會自動幫你建好 `clients` / `jobs` / `config` 三個分頁。

---

## 步驟 2 — 打開 Apps Script 編輯器

1. 在 Sheet 上方選單點 **擴充功能 → Apps Script**
2. 會跳出新分頁，叫 Apps Script 編輯器，左邊是檔案列表，中間是程式碼
3. 左上角的檔案名稱叫「未命名的專案」，點一下改成 `freelance-tracker-api`

---

## 步驟 3 — 貼上程式碼

1. 中間那個 `Code.gs` 檔案點進去
2. **全選現有內容**（Ctrl+A / Cmd+A）**全部刪掉**
3. 打開你專案裡的 `backend/apps-script.gs`（在 `D:\lab\GITHUB\TASK\freelance-tracker\backend\apps-script.gs`）
4. **全選複製**整份內容
5. **貼到 Code.gs**

---

## 步驟 4 — 改 Token（非常重要）

程式碼最上方有這行：

```js
const API_TOKEN = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING';
```

**改掉它**。這個 Token 是你的 API 密碼，有這串字的人就能讀寫你全部資料。

建議做法：
- 用 [https://www.random.org/strings/](https://www.random.org/strings/) 產生一串 32 字元的隨機字串
- 或者瀏覽器按 F12 → Console 貼 `crypto.randomUUID()` 也可以

範例格式（**請自己產一組，不要 copy 下面這個**）：
```js
const API_TOKEN = '<YOUR_RANDOM_32_CHAR_TOKEN_HERE>';
```

改完按 **儲存**（磁碟圖示 / Ctrl+S）。

---

## 步驟 5 — 初始化 Sheet 分頁

1. 上方有個函式下拉選單，預設是 `doGet`
2. **切換到 `initSheets`**
3. 按 **執行** 鈕（▶）
4. 第一次會跳 **需要授權** → 按 **審查權限**
5. 跳到 Google 登入頁 → 選你的帳號
6. 會警告「Google 尚未驗證這個應用程式」 → 點 **進階 → 前往 freelance-tracker-api（不安全）**
   - 這個警告是正常的，因為這是你自己寫的個人工具，Google 不可能「驗證」它
7. 最後按 **允許**
8. 執行紀錄會顯示「✓ 已建立 clients / jobs / config 三個分頁」
9. 回到你的 Sheet 檢查：底部應該多了三個分頁，每個分頁第一列都有標題

---

## 步驟 6 — 測試資料寫入（可選）

1. 函式下拉選到 `testWrite` → 按執行
2. 回到 Sheet 看：`clients` 應該有一筆 A 公司，`jobs` 有一筆首頁改版
3. 再執行 `testRead` → 看執行紀錄，應該會看到 JSON 格式的全部資料

確認沒問題再執行一次 `writeAll_({clients:[],jobs:[],config:{}})` 清空測試資料，或者手動刪掉那兩列。

---

## 步驟 7 — 部署為 Web App

1. 右上角 **部署 → 新增部署**
2. 左邊齒輪圖示選 **網路應用程式**
3. 設定：
   - **說明**：`v1`（隨便填，方便辨識）
   - **執行身分**：**我（你的 email）**
   - **誰可以存取**：**任何人**
     - ⚠️ 「任何人」聽起來很可怕，但我們有 Token 保護，沒 Token 一律拒絕
4. 按 **部署**
5. 會跳出 **Web App URL**，長這樣：
   ```
   https://script.google.com/macros/s/AKfycbx.../exec
   ```
6. **複製這串 URL**（同時把你的 Token 也留著）

## 步驟 8 — 測試 API 通不通

把剛剛的 URL 後面加 `?action=ping&token=你的TOKEN`，貼到瀏覽器網址列，例如：

```
https://script.google.com/macros/s/AKfycbx.../exec?action=ping&token=<YOUR_TOKEN>
```

按 Enter，應該會看到：

```json
{"ok":true,"pong":true,"time":"2026-04-24T..."}
```

✅ 這樣就成功了！

如果看到 `{"ok":false,"error":"Invalid or missing token"}`，是 Token 拼錯了，檢查網址列那串和你的 Token 一不一樣。

---

## 步驟 9 — 前端連接

1. 打開 APP → 設定頁 → **「☁️ Sheet 雙向同步（跨裝置資料）」** 區塊
2. **API URL**：貼上剛剛步驟 7 的網址
3. 按 **「測試連線」** → 輸入 Token → 看到 ✓ 成功
4. 按 **「儲存設定」**
5. 按 **「🚀 啟用自動同步」** → 彈出確認視窗 → 確定
6. 看到 alert「✓ 同步已啟用！」就完成了

完成後：
- 右上角的 **同步狀態指示器** 會變成綠色「✓ 已同步」
- 每次改案件 / 業主 2 秒內會自動推到 Sheet
- 其他裝置只要填一樣的 URL + Token 就能同步

---

## 🌐 跨裝置使用（公司、家裡、手機）

### 在新裝置上第一次使用

1. 打開 APP（GitHub Pages 網址）
2. 設定頁 → Sheet 雙向同步
3. 填入**同樣的 API URL**
4. 按「測試連線」→ 輸入**同樣的 Token**
5. 按「⬇️ 手動從 Sheet 拉取」 ← **第一次要先拉，不然會把空資料推上去蓋掉**
6. 看到資料都有了，再按「🚀 啟用自動同步」

### 之後每次打開 APP

- APP 啟動時**自動從 Sheet 拉最新資料**（約 1-2 秒）
- 看到右上角變綠色「✓ 已同步」就 OK
- 做任何改動都會在 2 秒內自動推回 Sheet
- 離線時會顯示「⚠ 離線」，連網後自動補推

### 離線安全

- 每次操作會**先存 localStorage**（即使斷網也能改）
- 網路不通時，APP 會把「待同步」flag 打開
- 網路恢復後（`online` 事件）自動補推
- 不用怕改完就斷網

---

## 🛡️ 零遺失機制（snapshots 分頁）

從版本開始，**每次推送到 Sheet 前，Apps Script 會自動在 `snapshots` 分頁備份當前 Sheet 內容**。

- 最多保留 **最近 20 個備份**（超過會刪最舊的）
- 每個備份含：id（短碼）、timestamp、note、完整 JSON 資料
- 前端可以透過「🗂️ 檢視 / 還原備份」按鈕查看並還原

**什麼時候會建立備份？**
- 每次前端推送資料（`action=save`）之前
- 每次還原 snapshot 之前（先備份當前狀態再還原）

**怎麼手動還原？**
1. 設定頁 → Sheet 雙向同步 → 「🗂️ 檢視/還原備份」
2. 看到 snapshot 清單，最新在上
3. 輸入想還原的 snapshot ID → 確認
4. Sheet 會還原到那個版本，本地也會重新拉取

**Sheet 原生版本歷史（額外保護）：**
Google Sheet 自己會保留 30 天的編輯歷史。若 snapshots 分頁也出事，可以到 Sheet 的「檔案 → 版本記錄」找回來。

---

## ⚠️ 安全提醒

- **Token 不要放在 GitHub 公開 repo 裡**。前端的 Token 是存在瀏覽器 localStorage，只有你自己看得到，但如果你截圖設定頁發到網路上就會曝光
- **如果 Token 曝光**，到 Apps Script 編輯器改 `API_TOKEN` 再重新部署一次就好（舊 Token 失效）
- **Google 帳號的雙重驗證** 一定要開，保護好帳號比什麼都重要

---

## 🔄 後續怎麼改後端程式

如果之後需要調整 API（加新欄位、改邏輯等）：

1. 打開 Apps Script 編輯器
2. 改程式碼 → 儲存
3. **部署 → 管理部署** → 點鉛筆圖示 → **版本：新版本** → 部署
4. Web App URL **不會變**，前端不用改

如果你有改 `doGet` / `doPost` 的邏輯但忘了發新版本，前端打的還是舊邏輯。

---

## 🆘 常見問題

**Q: 按「部署」時 Google 要我驗證，很多警告**
A: 正常，那是給對外發布的 App 用的驗證流程。個人用工具按「進階 → 繼續」就好。

**Q: `testWrite` 跑了但 Sheet 沒反應？**
A: 檢查函式選單是不是選到 `testWrite`；執行紀錄有沒有錯誤；Sheet 有沒有選對帳號。

**Q: 我可以建多個 Sheet 給不同用途嗎？**
A: 可以，每個 Sheet 各自跑一套 Apps Script，各自有自己的 API URL + Token。適合例如你想分「個人接案」跟「工作室接案」。

**Q: 資料會不會被 Google 看到？**
A: 資料存在你個人的 Google Drive，Google 技術上能存取所有 Drive 資料（就跟你把 Word 存在 Drive 一樣），但不會主動看。Apps Script 也跑在你自己的帳號下。

**Q: Apps Script 有使用量限制嗎？**
A: 個人帳號免費額度：**每天 20,000 次 URL Fetch + 6 小時執行時間**。個人用絕對用不完（你一天頂多開 APP 幾十次）。
