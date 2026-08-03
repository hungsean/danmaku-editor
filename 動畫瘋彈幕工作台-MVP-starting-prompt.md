# 動畫瘋彈幕工作台：Safari-first MVP Starting Prompt

> 將以下整段交給 Codex 或其他開發 Agent。這是一個嚴格收斂範圍、可實際執行的第一版要求。

---

請建立一個可執行的 **Safari Web Extension** 專案。

專案暫名：**動畫瘋彈幕工作台**

目標網站：`https://ani.gamer.com.tw/*` 的動畫播放頁。  
目標使用者：替 OP、ED、插入曲手動製作歌詞彈幕的字幕君。

這是 **Safari-first、跨瀏覽器 WebExtension-first** 的專案：第一個可執行與人工測試目標是 macOS Safari；但核心程式碼必須設計為未來可遷移至 Chromium / Chrome Manifest V3，不能依賴 Safari 專屬或 Chrome 專屬 API。

Safari 的 Xcode App 容器僅負責封裝、開發期安裝、簽署與執行；產品邏輯必須放在可共用的 WebExtension 程式碼中。

## 產品界線：這版只做兩件事

請做出一個「最小、但確實可用」的初版：

1. **跟著動畫瘋影片編輯彈幕**
   - 使用者可在播放頁一邊看影片、聽聲音，一邊建立與調整彈幕。
   - 編輯器要讀取目前影片時間，並能用目前播放位置快速打點。

2. **在播放器上預覽本機彈幕效果**
   - 自製彈幕只在使用者本機可見，疊加於播放器上。
   - 絕不可送出、修改、刪除或隱藏動畫瘋原有彈幕。

## 明確不做的功能

這個 MVP 必須嚴格禁止 scope creep。請不要做：

- 不送出彈幕；不碰動畫瘋原生送出按鈕、API、登入狀態或網路請求。
- 不做匯入、匯出、專案檔、本機持久保存、雲端同步、帳號系統。
- 不做音訊波形、節拍偵測、AI 對齊、歌詞辨識。
- 不做多軌時間軸、群組位移、碰撞偵測、快捷鍵設定頁。
- 不做 Chrome Web Store、Safari App Store 的發布流程。
- 不下載、錄製、保存、繞過或處理動畫瘋的影片／音訊內容。
- 不使用、猜測或反向工程動畫瘋未公開 API。
- 不為 Firefox、Chrome、Edge、Brave 個別實作 UI；只保留未來遷移所需的可攜架構。

## 技術與相容性要求

- 使用 TypeScript。
- 建立 **Safari Web Extension**，並提供可由 Xcode 開啟、Run、在 Safari 啟用的專案。
- 核心擴充功能以標準 WebExtension `manifest.json`、content script、DOM API、CSS 實作。
- 同時維持未來遷移到 Chromium Manifest V3 的可行性。
- 優先使用最少依賴；不要引入大型 UI framework。可使用 Vite 作為 TypeScript build 工具。
- content script 僅應注入 `https://ani.gamer.com.tw/*`。
- 不使用 Safari-only API 或 Chrome-only API。
  - 不使用 `chrome.sidePanel`、`chrome.offscreen` 等 Chrome 特有功能。
  - 若未來確實需要 extension API，優先使用標準 `browser.*` 風格並隔離成相容層。
- 工作台以 content script 注入頁面的方式呈現，不依賴瀏覽器原生 sidebar。
- 使用 Shadow DOM 封裝工作台與預覽層，避免動畫瘋 CSS 影響本工具，也避免本工具污染網站。
- 不應依賴特定作品、特定集數、固定 URL 結構或未公開頁面資料。
- 尋找播放器時，安全地偵測可播放的 `HTMLVideoElement`；需考慮動畫瘋可能是 SPA，切換集數後 `<video>` 可能被重建，應重新綁定。
- 草稿只存記憶體；重新整理後遺失是此版可接受限制，並在 UI 清楚標示「初版草稿不會保存」。
- 不將使用者輸入、草稿或播放資訊傳送到外部服務。

## 最小資料模型

請建立可共用的型別，至少包含：

```ts
type DanmakuPosition = "scroll" | "top" | "bottom"
type DanmakuSize = "small" | "medium" | "large"

type DanmakuDraft = {
  id: string
  time: number // 秒；允許至少 0.1 秒精度
  text: string
  position: DanmakuPosition
  size: DanmakuSize
  color: string
}
```

日文、中文、羅馬字或其他文字對工具而言都只是彈幕文字；不要建立日文／中文等語言專用欄位。

## 最小 UI

在動畫瘋播放頁注入一個不過度遮擋播放器的可收合固定側邊面板。UI 全部使用繁體中文，且具基本鍵盤可操作性與可辨識 label。

工作台至少要包含：

- 標題：`動畫瘋彈幕工作台`
- 初版限制提示：`草稿僅暫存在目前頁面，重新整理後會消失；此版本不會發送彈幕。`
- 播放器狀態列：
  - 是否找到影片
  - 現在播放時間，例如 `01:23.4`
  - 播放／暫停按鈕，可控制頁面既有影片播放器
- `啟用預覽` 開關
- `新增彈幕` 按鈕
- 彈幕編輯清單；每筆至少可編輯：
  - 時間（秒）
  - 文字
  - 位置：滑動／上方／下方
  - 大小：小／中／大
  - 顏色：先提供白、紅、黃、綠、藍即可
  - `使用目前時間` 按鈕
  - 刪除按鈕
- 空狀態：提示使用者先新增彈幕。
- 初次載入可放入 2～3 則示範彈幕，讓使用者能立即看見預覽；但必須可刪除。

## 編輯體驗

- 使用者選取一筆彈幕後，按 `使用目前時間`，將該筆 `time` 填為現在影片播放秒數。
- `Enter` 要完成同樣打點動作，並自動選取下一筆彈幕；若沒有下一筆，保持選取目前項目即可。
- 時間可直接手動輸入與微調，至少支援 0.1 秒精度。
- 播放／暫停按鈕要操作實際影片的 `play()` 與 `pause()`。
- 若尚未找到影片，所有依賴目前播放時間的操作應停用或給明確提示，不能報錯。

## 本機預覽規則

請建立清楚、獨立、可單元測試的純函式或模組。它根據：

- 現在影片秒數
- 彈幕開始時間
- 彈幕位置

決定彈幕是否可見，以及其動畫進度。

預覽規則：

- 預覽關閉時，不渲染任何自製彈幕。
- 滑動彈幕：
  - 顯示時間約 6 秒。
  - 自播放器右側平滑移動至左側。
- 上方／下方彈幕：
  - 顯示時間約 3 秒。
  - 分別固定在播放器上緣／下緣的安全區域。
- 文字、位置、大小、顏色需正確反映資料設定。
- 不需要完美重現動畫瘋原始彈幕引擎；重點是確實由影片時間觸發，且讓字幕君能判斷節奏與視覺效果。
- 自製預覽層只可疊在影片視覺區域，不能攔截影片的點擊、拖拉、音量或原生控制操作。
- 不處理、讀取、改寫或隱藏動畫瘋既有彈幕。

## 建議檔案結構

請採用類似下列結構，確保未來可將共用程式碼移植至 Chromium：

```text
bahamut-danmaku-workbench/
├─ extension/                 # 產品與跨瀏覽器 WebExtension 核心
│  ├─ manifest.json
│  ├─ content/
│  │  ├─ main.ts              # 尋找 video、注入工作台、同步時間
│  │  ├─ editor.ts            # 彈幕清單與編輯互動
│  │  ├─ preview.ts           # 預覽層渲染
│  │  └─ styles.css
│  ├─ shared/
│  │  ├─ types.ts
│  │  └─ timeline.ts          # 純時間判定／動畫進度邏輯
│  └─ assets/
├─ safari/                    # Safari Web Extension 的 Xcode 包裝層
├─ tests/
├─ package.json
└─ README.md
```

結構不需要逐字相同，但必須清楚區隔：

- 可共用的 extension 核心程式碼
- Safari 的 Xcode 包裝與設定
- 不依賴瀏覽器 DOM 的可測試時間軸邏輯

## 開發與驗證步驟

1. 先檢查目前工作目錄；如果已有專案，先回報並避免覆蓋。若沒有，建立新資料夾。
2. 建立完整 Safari Web Extension MVP，而不只是 mockup、架構說明或 TODO 清單。
3. 撰寫繁中 README，至少包含：
   - 專案目的
   - 已支援功能與刻意未支援功能
   - 安裝依賴與 build 指令
   - 如何用 Xcode 開啟與執行 Safari Web Extension
   - 如何在 Safari 啟用擴充功能
   - 如何到動畫瘋播放頁測試
   - 如何驗證不會發送彈幕／不會發出網路請求
   - 已知限制：動畫瘋 DOM 可能變動、草稿未保存、只做本機預覽、不會發送彈幕
   - 未來遷移 Chromium 的原則：共用 `extension/` 邏輯，只新增 Chromium packaging／manifest 差異
4. 至少針對時間判定與動畫進度純邏輯撰寫單元測試。
5. 實際執行測試與 production build。
6. 若 macOS / Xcode / Safari 開發環境可用，實際開啟 Xcode 專案並驗證 Safari extension target 可建置；若目前環境無法執行 Xcode，需誠實說明未能做此步的原因，並完成所有可在當前環境執行的驗證。
7. 最後回報：
   - 實際執行過的指令與結果
   - 測試結果
   - build 結果
   - 最終檔案結構
   - 已驗證與未能驗證的項目，明確區分

## 驗收條件

在動畫瘋任一可播放頁面，應能達成：

- 工作台可以顯示，並能偵測到影片或清楚顯示尚未找到影片。
- 播放器時間會隨影片播放更新。
- 工作台的播放／暫停可控制影片。
- 可新增、修改、刪除一則彈幕，且可編輯所有指定欄位。
- `使用目前時間` 與 Enter 能將選定彈幕對齊目前影片播放位置。
- 打開預覽後，彈幕能在指定時間疊到播放器上。
- 滑動、上方、下方三種位置都能看出不同預覽效果。
- 關閉預覽後，所有自製彈幕立即消失。
- 沒有自動送出彈幕、沒有呼叫動畫瘋未公開 API、沒有額外網路請求、沒有接觸帳號資料。
- 單元測試與 production build 必須實際通過。

請先直接實作，不要只提供架構建議。若動畫瘋播放器的 DOM 結構不確定，請以安全偵測可播放 `HTMLVideoElement` 為優先；不要走未公開 API 或自動發送流程。
