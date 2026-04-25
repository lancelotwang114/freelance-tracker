# 如何把這段對話設為 Claude Project

照下面五個步驟做，大約 3 分鐘搞定。之後在這個 Project 裡開新對話，Claude 就會自動帶著完整背景，不用再解釋一次。

---

## 步驟 1 — 在 Claude.ai 建立 Project

1. 打開 [https://claude.ai](https://claude.ai) 並登入
2. 左側選單找到 **Projects**
3. 點 **+ Create Project**
4. 名稱：`外包收益管理工具`（或你喜歡的名字，例如 `freelance-tracker`）
5. 描述（可填可不填）：`個人接案收益與排程管理工具的開發專案`
6. 按 **Create Project**

## 步驟 2 — 設定自訂指令

1. 進入剛建的 Project，右上角（或設定圖示）找 **Set custom instructions** / **Project knowledge**
2. 打開 `01_project_instructions.md`
3. 複製檔案裡「=== 開始 ===」到「=== 結束 ===」**之間**的所有內容
4. 貼到 Claude.ai 的自訂指令欄位
5. 儲存

> 💡 這段指令告訴 Claude：使用者是誰、技術決策是什麼、做事的偏好。之後每次對話 Claude 都會自動遵守。

## 步驟 3 — 上傳知識檔案

Project 內找 **Add Content** / **+ Add files**，上傳以下檔案（順序不重要）：

**必要（一定要傳）：**

- [ ] `claude-project/02_conversation_summary.md` — 對話脈絡 + 決策記錄
- [ ] `README.md` — 專案說明
- [ ] `docs/ROADMAP.md` — 開發路線圖
- [ ] `index.html` — 主畫面原始碼
- [ ] `css/style.css` — 樣式
- [ ] `js/app.js` — 程式邏輯

**可選（之後需要時再傳）：**

- [ ] 你的歷史 Google Sheet 匯出（CSV / XLSX），讓 Claude 幫你寫匯入工具時有樣本
- [ ] 業主範本 / 合約範本（如果之後要產正式請款單）

## 步驟 4 — 驗證

在 Project 裡開新對話，問：

> 我現在的專案進度到哪？下一步要做什麼？

Claude 應該會回答：目前是 v0.1 MVP 完成，下一步是 v0.2 接 Google Sheet。如果它能答出這個，代表設定成功。

## 步驟 5 — 往下走

之後就可以在這個 Project 裡持續工作，例如：

- 「幫我寫 v0.2 的 Google Apps Script」
- 「把我舊的 Google Sheet 資料匯入」
- 「加個深色模式」
- 「我要部署到 GitHub Pages」

Claude 會記得所有背景，不用再解釋。

---

## 維護建議

- 每次完成一個版本（例如 v0.2 做完），把 `02_conversation_summary.md` 更新一下，然後重新上傳替換
- 或每做完一個階段，寫一份新的 `03_v02_summary.md`、`04_v03_summary.md` 疊上去
- 程式碼改動比較大時，記得同步更新 Project 裡的 `index.html` / `app.js` / `style.css`

## 檔案清單

```
claude-project/
├── 00_SETUP.md                    本檔：設定教學
├── 01_project_instructions.md     要貼到 Claude.ai 的自訂指令
└── 02_conversation_summary.md     要上傳的知識檔（對話脈絡）
```
