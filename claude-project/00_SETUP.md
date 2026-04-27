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
- [ ] `ROADMAP.md` — 現行開發路線圖（**根目錄那份**，不是 `docs/ROADMAP.md`，後者是 v0.x 歷史檔）
- [ ] `CHANGELOG.md` — 完整版本歷史
- [ ] `index.html` — 主畫面原始碼
- [ ] `css/style.css` — 樣式
- [ ] `js/app.js` — 程式邏輯
- [ ] `backend/apps-script.gs` — Apps Script 後端（要動雲端同步時必傳）

**可選（之後需要時再傳）：**

- [ ] 你的歷史 Google Sheet 匯出（CSV / XLSX），讓 Claude 幫你寫匯入工具時有樣本
- [ ] 業主範本 / 合約範本（如果之後要產正式請款單）

## 步驟 4 — 驗證

在 Project 裡開新對話，問：

> 我現在的專案進度到哪？下一步要做什麼？

Claude 應該會回答：目前是 **v2.10.5**，下一階段是 v2.5（業主洞見 + 通知）。如果它能答出這個，代表設定成功。

## 步驟 5 — 往下走

之後就可以在這個 Project 裡持續工作，例如：

- 「幫我做業主健康度儀表板」（v2.5）
- 「加估價單功能」（v2.6）
- 「忙閒週期分析怎麼做」（v2.7）
- 「請款單 PDF 樣式想調整」
- 「Apps Script 同步偶爾出錯，幫我看 log」

Claude 會記得所有背景，不用再解釋。

---

## 維護建議

- 每次發新版本，記得更新 `CHANGELOG.md` + `ROADMAP.md`，並重新上傳到 Project 替換
- 大改 schema 時記得同步 `01_project_instructions.md` 裡的「資料結構」區塊
- 程式碼改動比較大時，記得同步更新 Project 裡的 `index.html` / `app.js` / `style.css` / `backend/apps-script.gs`

## 檔案清單

```
claude-project/
├── 00_SETUP.md                    本檔：設定教學
├── 01_project_instructions.md     要貼到 Claude.ai 的自訂指令
└── 02_conversation_summary.md     要上傳的知識檔（對話脈絡）
```
