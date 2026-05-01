# =============================================================
# freelance-tracker-cloud 一鍵建置腳本
# 用途：在 D:\lab\GITHUB\TASK\ 下建 freelance-tracker-cloud 資料夾，
#       並從現有 freelance-tracker 複製可重用的核心檔案。
# 用法：在 PowerShell 執行 .\setup-cloud-folder.ps1
# =============================================================

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$src = "D:\lab\GITHUB\TASK\freelance-tracker"
$dst = "D:\lab\GITHUB\TASK\freelance-tracker-cloud"

if (Test-Path $dst) {
    Write-Host "[X] $dst already exists. Please remove it first." -ForegroundColor Red
    exit 1
}

Write-Host "[*] Creating $dst" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $dst | Out-Null

# Core code files to copy
Write-Host "`n[*] Copying core files" -ForegroundColor Cyan

$copyItems = @(
    "index.html",
    "service-worker.js",
    "manifest.json",
    ".gitignore"
)

foreach ($item in $copyItems) {
    Copy-Item -Path "$src\$item" -Destination "$dst\$item"
    Write-Host "  + $item"
}

# Copy entire folders: css, js, icons, claude-project
$copyDirs = @("css", "js", "icons", "claude-project")
foreach ($dir in $copyDirs) {
    Copy-Item -Path "$src\$dir" -Destination "$dst\$dir" -Recurse
    Write-Host "  + $dir/ (entire folder)"
}

# Write new README marking it as experimental
Write-Host "`n[*] Writing new README.md" -ForegroundColor Cyan
$readme = @"
# Freelance Tracker (Cloud)

> WARNING: 實驗版 — A 方案 Google Drive 後端開發中。
>
> - 穩定版（v2.10.x，Apps Script 後端）：[freelance-tracker](https://github.com/lancelotwang114/freelance-tracker) ([線上版](https://lancelotwang114.github.io/freelance-tracker/))
> - 本版本目標：完全去除 Apps Script，改用 Google Drive App Folder 當後端
> - 開發中切勿用於正式資料；請先到穩定版匯出 JSON 備份後再來測試

## 路線圖

| 階段 | 內容 | 狀態 |
|------|------|------|
| v3.0.0-alpha.1 | Google Identity Services 登入流程接通 | 進行中 |
| v3.0.0-alpha.2 | Drive App Folder 雙寫期（local + Drive 同步） | 待辦 |
| v3.0.0-beta.1 | Drive 為主，local 退化為快取 | 待辦 |
| v3.0.0 | 移除所有 Apps Script 相關程式碼，正式取代 v2 | 待辦 |

## 跟 v2 的差異

| 項目 | v2 (Apps Script) | v3 (Drive) |
|------|------|------|
| 後端 | 自架 Apps Script + Google Sheet | 無，純前端 + Drive API |
| 認證 | 自訂 token | Google Identity Services |
| 跨裝置同步 | 需貼 URL + token | 同 Google 帳號自動同步 |
| 設定門檻 | 約 30 分鐘 | 10 秒（點 Google 登入） |
"@
$readme | Out-File -FilePath "$dst\README.md" -Encoding utf8

# Write new CHANGELOG
Write-Host "[*] Writing new CHANGELOG.md" -ForegroundColor Cyan
$today = Get-Date -Format 'yyyy-MM-dd'
$changelog = @"
# 版本更新歷史

## v3.0.0-alpha.1 — $today

### 起點
- 從 freelance-tracker v2.10.15 fork 過來當起點
- 移除 backend/（Apps Script 後端）
- 移除 v2 路線圖、舊文件（docs/ROADMAP.md 等）
- 重寫 README、CHANGELOG、ROADMAP 為 v3 系列

### 待開發
- Google Identity Services 接通
- Drive App Folder 讀寫
- 移除 localStorage 為主的同步邏輯，改 Drive 為 source of truth
"@
$changelog | Out-File -FilePath "$dst\CHANGELOG.md" -Encoding utf8

# Write new ROADMAP
Write-Host "[*] Writing new ROADMAP.md" -ForegroundColor Cyan
$roadmap = @"
# Roadmap (v3 — Cloud)

> 從 v2.10.15 fork 出來重寫後端為 Google Drive App Folder。

## v3.0.0-alpha.1（進行中）
- [ ] GCP Console OAuth Client ID 申請
- [ ] Google Identity Services SDK 整合
- [ ] 登入 / 登出 UI
- [ ] 顯示登入帳號

## v3.0.0-alpha.2 — Drive 雙寫期
- [ ] Drive App Folder 自動建立 tracker.json
- [ ] 同步邏輯：localStorage + Drive 雙寫
- [ ] lastModifiedAt 比對 + 衝突處理
- [ ] 從現有 Apps Script 同步邏輯搬：snapshot 分層保留、idle 保護、操作日誌

## v3.0.0-beta.1 — Drive 為主
- [ ] localStorage 退化為純快取
- [ ] 啟動必拉 Drive，沒網路用 cache
- [ ] 移除「跨裝置設定檔匯出 / 匯入」（登入即同步）
- [ ] 移除「自訂 token + URL」設定 UI

## v3.0.0 — 正式取代 v2
- [ ] 完全移除 backend/ 相關引用
- [ ] CHANGELOG 標記 stable

## 待保留功能（從 v2 沿用，邏輯不動）
- 案件 / 業主 CRUD
- 雙狀態（完成 / 收款）+ payments[] 多次部分收款
- 業主儲值制
- 請款單（多帳號 + 戶名 + 存摺照片）
- 行事曆
- 收益分頁與所有報表
- PWA + 暗色模式 + 操作日誌
- Google Calendar 同步（用 OAuth 換掉 Apps Script 中介）

## 暫不處理（評估後）
- 二代健保補充保費計算
- 多語系
- 報稅幫手
"@
$roadmap | Out-File -FilePath "$dst\ROADMAP.md" -Encoding utf8

# Remove unneeded folders that got copied (none here since we did selective copy)
# (backend/ and docs/ were not copied above, no removal needed)

# Note about claude-project
Write-Host "`n[!] claude-project/ copied as-is, but contents are still v2 instructions." -ForegroundColor Yellow
Write-Host "    Update 01_project_instructions.md to v3 version before next chat session." -ForegroundColor Yellow

# Done
Write-Host "`n[OK] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "Location: $dst" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. cd $dst"
Write-Host "  2. git init"
Write-Host "  3. git add -A"
Write-Host "  4. git commit -m `"initial: forked from freelance-tracker v2.10.15`""
Write-Host "  5. Create new repo at github.com/new (name: freelance-tracker-cloud)"
Write-Host "  6. git branch -M main"
Write-Host "  7. git remote add origin https://github.com/lancelotwang114/freelance-tracker-cloud.git"
Write-Host "  8. git push -u origin main"
Write-Host "  9. GitHub Pages: Settings -> Pages -> Source: main / (root)"
Write-Host " 10. URL: https://lancelotwang114.github.io/freelance-tracker-cloud/"
Write-Host ""
Write-Host "After that, tell me to switch to cloud folder for next conversation." -ForegroundColor Cyan
