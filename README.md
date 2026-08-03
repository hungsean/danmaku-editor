# 動畫瘋彈幕工作台

在巴哈姆特動畫瘋（`ani.gamer.com.tw`）播放頁上，一邊看影片一邊手動製作彈幕草稿，並在本機預覽效果的瀏覽器擴充功能。

給替 OP、ED、插入曲手動打歌詞彈幕的字幕君使用。

這是 **Safari-first、跨瀏覽器 WebExtension-first** 的專案。第一個可執行與人工測試目標是 macOS Safari，但核心程式碼刻意不依賴 Safari 或 Chrome 專屬 API，未來可直接遷移至 Chromium Manifest V3。

## 這版做什麼

- 在播放頁注入可收合的側邊工作台，讀取目前影片播放時間
- 用目前播放位置快速打點（`使用目前時間` 按鈕與 `Enter`）
- 新增、編輯、刪除彈幕草稿：時間、文字、位置、大小、顏色
- 從工作台控制頁面既有播放器的播放與暫停
- 在播放器上疊加本機預覽層，由影片時間觸發

## 這版刻意不做

這些是有意識排除的範圍，不是待辦事項：

- **不送出彈幕**。不碰動畫瘋原生送出按鈕、API、登入狀態或任何網路請求
- **不動原有彈幕**。不讀取、修改、刪除或隱藏動畫瘋既有彈幕
- 不做匯入、匯出、專案檔、本機持久保存、雲端同步、帳號系統
- 不做音訊波形、節拍偵測、AI 對齊、歌詞辨識
- 不做多軌時間軸、群組位移、碰撞偵測、快捷鍵設定頁
- 不下載、錄製、保存或處理動畫瘋的影片與音訊內容
- 不使用或反向工程動畫瘋未公開 API
- 不做 Chrome Web Store 或 Safari App Store 的發布流程

## 專案結構

```text
.
├─ extension/              # 產品與跨瀏覽器 WebExtension 核心
│  ├─ manifest.json        # Manifest V3
│  ├─ content/
│  │  ├─ main.ts           # 尋找 video、注入工作台、驅動每幀更新
│  │  ├─ editor.ts         # 彈幕清單與編輯互動
│  │  ├─ preview.ts        # 預覽層渲染
│  │  └─ styles.css        # 工作台面板樣式（注入 Shadow DOM）
│  └─ shared/
│     ├─ types.ts          # 資料模型與模組契約
│     └─ timeline.ts       # 純時間判定與動畫進度邏輯（無瀏覽器 API）
├─ safari/                 # Safari Web Extension 的 Xcode 包裝層（由 converter 產生）
├─ tests/                  # timeline 純邏輯單元測試
└─ dist/                   # build 產物（Xcode 專案直接引用這裡的檔案）
```

三層界線刻意分清楚：

- `extension/shared/timeline.ts` 不依賴瀏覽器 DOM，可獨立單元測試
- `extension/` 其餘部分是可共用的擴充功能核心
- `safari/` 只負責 Xcode 包裝、簽署與執行，不含產品邏輯

## 安裝與建置

需要 Node.js 與 pnpm。

```bash
pnpm install
pnpm test        # 執行 timeline 單元測試
pnpm build       # 型別檢查 + 產生 dist/
```

`pnpm build` 會做 `tsc --noEmit` 型別檢查，再用 Vite 把 content script 打包成單一 IIFE 檔 `dist/content.js`，並複製 `manifest.json`。

之所以是 IIFE 而不是 ES module：Manifest V3 的 `content_scripts` 不支援 module 形式載入。

## 產生 Safari Xcode 專案

`safari/` 不是手寫的，也不需要先用 Xcode 建立空專案。正確順序是先寫好擴充功能、build 出 `dist/`，再用 Apple 提供的轉換工具產生 Xcode 包裝：

```bash
pnpm build

xcrun safari-web-extension-converter dist \
  --project-location safari \
  --app-name "danmaku-editor" \
  --bundle-identifier dev.senen.danmaku-editor \
  --macos-only --no-open --no-prompt
```

`--bundle-identifier` 請換成你自己的識別碼。

轉換時會出現 `manifest.json is missing icons` 警告，這不影響執行，Xcode 範本會套用預設圖示。

## 每次改完程式碼要做的事

這裡刻意**沒有**加 `--copy-resources`。不加的話 converter 產生的是**引用**：Xcode 專案裡的 `content.js` 與 `manifest.json` 直接指向 `../../../dist/` 的檔案，不是副本。

所以流程很單純：

```bash
pnpm build
```

然後回到 Xcode 重新 Run，並在 Safari 重新載入動畫瘋頁面。不需要任何額外的同步步驟。

有一個前提要記得：converter 引用的是**個別檔案**，不是整個資料夾。所以之後如果在 `dist/` 新增檔案（例如加入 icon、或拆出第二支 script），必須手動在 Xcode 專案裡把新檔案加進 Extension target 的 Copy Bundle Resources，否則不會被打包進去。改既有檔案則完全不用管。

## 在 Xcode 開啟與執行

1. 開啟 `safari/danmaku-editor/danmaku-editor.xcodeproj`
2. 在 Signing & Capabilities 選一個你的開發者帳號（本機開發用個人帳號即可）
3. 選擇 macOS app target，按 Run
4. 會跳出一個容器 App 視窗，點其中的按鈕開啟 Safari 擴充功能偏好設定

## 在 Safari 啟用擴充功能

1. Safari 選單 -> 設定 -> 進階 -> 勾選「顯示網頁開發者功能」
2. 開發 選單 -> 勾選「允許未簽署的擴充功能」（每次重啟 Safari 都要重勾）
3. Safari 設定 -> 擴充功能 -> 啟用「動畫瘋彈幕工作台」
4. 確認已授予 `ani.gamer.com.tw` 的網站存取權限

## 到動畫瘋測試

開啟任一可播放的動畫瘋播放頁，例如 `https://ani.gamer.com.tw/animeVideo.php?sn=...`。

預期行為：

- 右側出現「動畫瘋彈幕工作台」面板，可收合
- 狀態列顯示已找到影片，時間隨播放更新（格式如 `01:23.4`）
- 面板的播放／暫停可實際控制影片
- 初次載入有三則示範彈幕，開啟預覽後會在對應時間疊到播放器上
- 滑動、上方、下方三種位置有明顯不同的視覺效果
- 關閉預覽後所有自製彈幕立即消失
- 在彈幕上點擊、拖拉播放器進度條、調音量都不受預覽層干擾

## 如何驗證不會發送彈幕與不會發出網路請求

這一點值得自己確認，不要只信 README：

1. 開啟 Safari 的 網頁檢閱器 -> 網路 分頁，清空紀錄
2. 在工作台新增、編輯、刪除彈幕，開關預覽
3. 網路分頁應該完全沒有由本擴充功能發出的請求

也可以直接檢查程式碼：全專案搜尋 `fetch`、`XMLHttpRequest`、`WebSocket`、`sendBeacon` 應該都沒有結果。

```bash
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" extension/
```

`manifest.json` 也刻意沒有宣告任何 `host_permissions`、`permissions` 或背景 service worker，只有針對 `ani.gamer.com.tw` 的 content script。

## 已知限制

- **草稿不會保存**。只存在記憶體，重新整理頁面就會消失。這是本版刻意的取捨，UI 上也有明確標示
- **動畫瘋 DOM 可能變動**。本工具用「尋找頁面上可播放且面積最大的 `<video>`」這種通用方式偵測播放器，不依賴特定 class 或 DOM 結構，但網站大改版仍可能失效
- **只做本機預覽**。預覽效果不追求完美重現動畫瘋原生彈幕引擎，重點是由影片時間正確觸發，讓你判斷節奏與視覺效果
- **不會發送彈幕**。做好的草稿目前只能自己看，沒有匯出功能

## 未來遷移 Chromium 的原則

`extension/` 底下的所有程式碼都是標準 WebExtension，沒有用到 `chrome.sidePanel`、`chrome.offscreen` 這類 Chrome 專屬 API，也沒有用 Safari 專屬 API。工作台是用 content script 注入頁面，不依賴瀏覽器原生 sidebar。

因此遷移 Chromium 時：

- `extension/` 完全共用，不需要修改
- 只需新增 Chromium 的 packaging 與 manifest 差異
- 若未來確實需要用到 extension API，優先使用標準 `browser.*` 風格並隔離成相容層

UI 也不會為 Firefox、Chrome、Edge 各別實作，只保留可攜架構。
