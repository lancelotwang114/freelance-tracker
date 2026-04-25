# 上傳 GitHub Pages 教學

## 🚨 必讀：上傳前的安全檢查

**這個工具會用到 Token、Sheet 連結等敏感資訊。** 我已經幫你在 `.gitignore` 排除了所有可能含敏感資料的檔案，但你還是要自己確認一次：

### ✅ 上傳前 checklist

打勾確認後再 push：

- [ ] **`backend/apps-script.gs` 裡的 `API_TOKEN` 還是 `'CHANGE_ME_TO_A_LONG_RANDOM_STRING'`**（沒改成真實 Token）
- [ ] **沒有任何 `freelance-backup-*.json` 在專案內**
- [ ] **`imports/` 資料夾裡沒有 `freelance-import.json`、`SUMMARY.md`**（這些含真實業主與金額資料）
- [ ] **沒有截圖檔（`*.png`、`*.jpg`）暴露真實 Token、客戶名稱**
- [ ] **`README.md` 沒寫真實 Apps Script URL**

### 為什麼要小心？

GitHub repo 一旦 commit 過某個檔案，**即使之後刪掉，commit 歷史裡還在**，需要用 `git filter-branch` 等指令才能徹底清除。**最安全的做法：第一次 commit 前就確認乾淨**。

---

## 📋 你會用到的工具

- **GitHub 帳號**（如果還沒有，到 [github.com](https://github.com) 註冊）
- **Git 命令列** 或 **GitHub Desktop**（圖形界面）

下面教學以 **Git 命令列** 為主。如果你比較喜歡圖形界面，下載 [GitHub Desktop](https://desktop.github.com/)，操作很直觀。

---

## 步驟 1 — 在 GitHub 建立 repo

1. 登入 GitHub → 右上角 **+ 號 → New repository**
2. **Repository name**：`freelance-tracker`（或你喜歡的名字）
3. **Description**：`個人外包收益與排程管理工具`（可選）
4. **Public** 或 **Private**：
   - **Public**：所有人都能看你的程式碼（但看不到你的資料，因為資料不在 repo 裡）→ GitHub Pages 免費
   - **Private**：只有你能看 → GitHub Pages 在免費版需要付費（GitHub Pro $4/月）。新版有些限制，建議 Public
5. **不要**勾選「Add a README file」（你已經有了）
6. **不要**勾選「Add .gitignore」（你已經有了）
7. 按 **Create repository**

建立完會看到一頁說明，**先別關，等等用得到**（會有 `git remote add origin ...` 那行指令）。

---

## 步驟 2 — 選擇你要走的路：命令列 OR GitHub Desktop

你有兩條路，**選一條**：

- **A. 命令列（git 指令）** — 學一次受用一輩子，但要打字
- **B. GitHub Desktop（圖形界面）** ⭐ — 點按鈕就好，新手友善

如果不確定，**選 B**。下面兩條路徑都會講。

### 路徑 A：安裝 Git 命令列

#### Windows
下載 [Git for Windows](https://git-scm.com/download/win)，一路 Next 安裝完。

#### macOS
打開 Terminal，輸入 `git --version`，沒裝的話會跳出安裝提示，按確定。

#### 驗證
```bash
git --version
```
看到版本號就 OK。**繼續往下做步驟 3-6（命令列路徑）**

---

### 路徑 B：安裝 GitHub Desktop

1. 到 [desktop.github.com](https://desktop.github.com) 下載 → 安裝
2. 打開 GitHub Desktop → **Sign in to GitHub.com** → 瀏覽器授權 → 同意
3. 回到 GitHub Desktop，看到你的帳號名就成功了

> ⏭️ 用 GitHub Desktop 的話，**跳到 [步驟 4-B](#步驟-4-b--github-desktop-加入專案並推送)**。下面的步驟 3-6（命令列）可以略過。

---

## 步驟 3 — 初次設定 Git（每台電腦只需一次）

打開 **命令列 / Terminal**，輸入：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的GitHub email"
```

這個資訊會記在每筆 commit 上。

---

## 步驟 4 — 在專案資料夾初始化 Git

打開命令列，**`cd` 到 `freelance-tracker/` 資料夾**：

```bash
cd D:\lab\GITHUB\TASK\freelance-tracker
```

然後：

```bash
# 初始化 Git
git init

# 確認 .gitignore 生效（執行後不應該看到 imports/ 或 freelance-backup-*.json）
git status
```

`git status` 會列出所有「準備加入」的檔案，**仔細看一下**：

✅ 應該看到：
- `index.html`
- `css/style.css`
- `js/app.js`
- `backend/apps-script.gs`
- `backend/SETUP.md`
- `backend/CALENDAR-SETUP.md`
- `docs/ROADMAP.md`
- `docs/PUBLISH-TO-GITHUB-PAGES.md`（這個檔案）
- `README.md`
- `.gitignore`
- `claude-project/` 內的檔案（這些是 Claude Project 設定，不含真實資料，安全）

❌ **不該看到**：
- `imports/freelance-import.json`
- `imports/SUMMARY.md`
- `freelance-backup-*.json`

如果看到不該出現的，**停下來，檢查 .gitignore**。

---

## 步驟 5 — 第一次 commit

```bash
# 加入所有檔案（已被 .gitignore 排除的不會加）
git add .

# 再次確認要 commit 的內容
git status

# 送出第一個 commit
git commit -m "Initial commit: freelance tracker v0.4"
```

---

## 步驟 6 — 連到 GitHub repo 並推送

回到剛剛建立 repo 那頁，會看到類似這樣的指令（換成你自己的）：

```bash
git remote add origin https://github.com/你的帳號/freelance-tracker.git
git branch -M main
git push -u origin main
```

複製貼到命令列執行。第一次推送會跳出登入視窗（瀏覽器或輸入 token），照指示完成。

成功後重新整理 GitHub repo 頁面，就會看到所有檔案。

---

## 步驟 4-B — GitHub Desktop 加入專案並推送

> 走命令列路徑（A）的人**跳過這一段**，直接看步驟 7。

### 4-B.1 加入你的專案資料夾

1. 上方選單 **File → Add local repository...**
2. **Local path** 點 Choose... → 選 `D:\lab\GITHUB\TASK\freelance-tracker`
3. 它會說「This directory does not appear to be a Git repository」
4. 點藍字連結 **「create a repository」**
5. 跳出視窗：
   - **Name**：`freelance-tracker`
   - **Description**：`個人外包收益與排程管理工具`
   - **Initialize with README**：⚠️ **不要勾**（你已經有了）
   - **Git ignore**：選 **None**（你已經有 .gitignore）
   - **License**：可選 None 或 MIT
6. 點 **Create Repository**

### 4-B.2 檢查要 commit 的檔案 ⭐ 重要

左側「**Changes**」會列出所有檔案。**仔細看一下**，**不該出現**：
- `imports/...`
- 任何 `freelance-backup-*.json`
- `backup/...`

如果出現了，停下來檢查 .gitignore。

### 4-B.3 第一次 commit

左下角：
- **Summary**：填 `Initial commit`
- 點 **Commit to main**

### 4-B.4 發佈到 GitHub

上方會出現 **Publish repository** 按鈕（藍色），點它：
- **Name**：`freelance-tracker`
- **Keep this code private**：⚠️ **不勾**（公開比較方便，因為 Public 才能免費用 GitHub Pages）
- 點 **Publish Repository**

上方按鈕會變成 **Fetch origin**，代表 push 完成。

### 4-B.5 之後怎麼更新

每次改完程式：
1. GitHub Desktop 自動偵測，左側列出變動
2. 左下 Summary 填這次改了什麼（例如「修月度圖 bug」）
3. 點 **Commit to main**
4. 上方點 **Push origin**

GitHub Pages 會在 1-2 分鐘內自動更新。

---

## 步驟 7 — 開啟 GitHub Pages

> 用 GitHub Desktop 的人：上方選單 **Repository → View on GitHub** 會自動開瀏覽器到你的 repo 頁面，方便。

1. 在 repo 頁面，點上方 **Settings** 頁籤
2. 左側選單找 **Pages**
3. **Source** 區塊：
   - **Branch**：選 `main`
   - **Folder**：選 `/ (root)`
   - 按 **Save**
4. 等 1-2 分鐘
5. 重新整理頁面，最上面會出現綠色框：
   ```
   Your site is live at https://你的帳號.github.io/freelance-tracker/
   ```
6. 點開那個網址，看到 APP 就成功了 🎉

---

## 步驟 8 — 在新網址設定後端

部署成功後，這個 GitHub Pages 網址跟你之前用的本機檔案是**不同 origin**，所以 localStorage 是空的。

第一次打開：

1. 設定頁 → **Sheet 雙向同步** 區塊
2. 填 **Apps Script URL**（你之前已經部署的那個）
3. 按「測試連線」→ 輸入 Token → ✓ 成功
4. 按 **「⬇️ 手動從 Sheet 拉取」** ← 一定要先拉，不然會把空資料推上去蓋掉
5. 看到資料都進來了，再按 **「🚀 啟用自動同步」**

之後在公司、家裡、手機都打開這個網址，重複步驟 1-5 就能多裝置同步。

---

## 🔄 之後怎麼更新網站

每次改完程式（例如修 bug、加功能）：

```bash
cd D:\lab\GITHUB\TASK\freelance-tracker
git add .
git commit -m "說明這次改了什麼"
git push
```

GitHub Pages 會在 1-2 分鐘內自動更新。

---

## 🆘 常見問題

### Q: 推送時報錯「Permission denied」

**原因**：你帳號沒設好。

**解法**：
- 用 GitHub Desktop 推（圖形界面登入比較直觀）
- 或設定 SSH key：[GitHub 官方教學](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)
- 或用 Personal Access Token：[官方教學](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

### Q: GitHub Pages 顯示 404

**原因**：通常是 Pages 還沒部署完，或路徑不對。

**解法**：
- 等 5 分鐘再重新整理
- 確認 Settings → Pages 顯示 "Your site is live at..."
- 如果還是不行，到 Actions 頁籤看 build 是否失敗

### Q: 我不小心 commit 了 freelance-import.json，怎麼辦？

**緊急處理**：
1. **如果 repo 是 Public**：當作那份資料已經外流（因為 commit 歷史 public），考慮：
   - 刪掉整個 repo 重建（最徹底）
   - 或用 `git filter-branch` 從歷史移除（複雜）
2. **如果 repo 是 Private**：刪除那次 commit + force push 即可：
   ```bash
   git rm --cached imports/freelance-import.json
   git commit -m "remove sensitive data"
   git push --force
   ```
   但已經抓過的人還是有那份檔案。

**最佳做法**：再次強調，**第一次 commit 前用 `git status` 確認乾淨**。

### Q: 我想改網域名稱

GitHub Pages 預設網址是 `https://username.github.io/repo-name/`。如果想用自己的網域（例如 `mytracker.com`）：

1. 買網域（Cloudflare Registrar、Namecheap 等）
2. Settings → Pages → Custom domain 填你的網域
3. 在你的網域 DNS 設 CNAME 指到 `username.github.io`
4. 等 DNS 生效（最多 24 小時）

### Q: 部署後其他人能看到我的資料嗎？

**不行**。原因：
- 程式碼是 public，但**不含資料**
- 資料在你瀏覽器 localStorage（每人各自）
- Sheet 需要 Token 才能存取（你不公開 Token，誰都進不去）

別人打開你的 GitHub Pages 網址會看到**空的 APP**，他們填了自己的 Apps Script URL+Token 才能用。

### Q: 部署後我還能繼續本地開發嗎？

可以。本機改完 → push → GitHub Pages 自動更新。

如果改的時候想本地預覽：
- 直接雙擊 `index.html` 在瀏覽器開
- **但本地版的 localStorage 跟線上版不通**，要記得最後測一次線上版

---

## 🛡️ 一些好習慣

1. **commit message 寫清楚**：未來看歷史比較方便（例如「修月度圖 bug」「加 Calendar 同步」）
2. **每改完一個段落就 push**：避免改太多忘記哪裡改的
3. **重要改動先在另一個 branch 測試**：
   ```bash
   git checkout -b experiment-feature-x
   # 改程式
   git push origin experiment-feature-x
   # 沒問題再 merge 回 main
   ```
4. **不要 commit 含 token 的檔案**（再次強調）
5. **定期備份 Sheet**：在 Google Sheet 「檔案 → 下載 → Excel」存一份在自己電腦

---

## 🎯 實際流程總結

```
1. GitHub 建 repo (public)
2. 命令列 cd 到專案資料夾
3. git init && git status (檢查 .gitignore 生效)
4. git add . && git commit -m "init"
5. git remote add origin ... && git push -u origin main
6. GitHub Settings → Pages → Branch=main, /=root
7. 等 2 分鐘 → 拿到網址
8. 打開網址 → 設定頁 → 填 API URL + Token → 拉取 → 啟用同步
9. 公司、家裡、手機重複步驟 8
完成 ✅
```

如果卡住，跟我說卡在哪一步，我幫你看。
