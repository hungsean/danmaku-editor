# #2 影片區域按暫停後，控制台暫停/播放按鈕失效

- 類型：bug
- 狀態：已完成
- 建立：2026-08-14
- 更新：2026-08-14

## 描述

如果是直接在影片區域（而非工作台控制台）按暫停播放，之後控制台上的暫停/播放按鈕會無法控制影片。

推測是控制台按鈕的播放狀態或事件綁定，跟影片原生控制列的操作沒有同步。

## 留言

- 2026-08-14：建立 issue
- 2026-08-14：釐清現象——按鈕外觀正常（不是灰掉/disabled），點按鈕邊緣（padding 區）正常，點按鈕正中央的文字「暫停」/「播放」才會沒反應。這個定位很精準地指向典型網頁通病：`.tp-root button` 沒有設 `user-select: none`，滑鼠在文字上按下到放開之間只要有一點點位移，瀏覽器就會判定成「選取文字」而不是「點擊」，click 事件因此沒有觸發；按鈕邊緣沒有文字可選，所以永遠正常。跟「是否先在影片區域按暫停」其實無關，是巧合（可能只是使用者在那個情境下手比較不穩、點擊時位移比較大）。
- 2026-08-14：修法：在 `extension/content/styles.css` 的 `.tp-root button` 加上 `-webkit-user-select: none` 與 `user-select: none`，讓面板內所有按鈕的文字都不可選取。`tsc --noEmit`、`pnpm test`（97 條全過）皆通過。
- 2026-08-14：使用者回報套用後問題依舊存在，`user-select` 猜測的根因不成立，重開此 issue。改用 DevTools 直接檢視「點下去沒反應」那個座標實際命中的是哪個元素，才能確認真正原因。
- 2026-08-14：使用者以 DevTools 確認該座標命中的就是按鈕本身，沒有其他元素蓋在上面，排除「被其他元素擋住點擊」的可能性。改往「瀏覽器原生按鈕外觀跟自訂 CSS 打架」的方向排查：`.tp-root button` 只蓋了 background/border/padding，沒有重置 `-webkit-appearance`，這在 Safari／WebKit 是常見坑——沒 reset 的按鈕會保留原生 chrome，可能導致自訂樣式下視覺上的文字區域跟實際可點擊的 hit-test 區域不一致。在 `.tp-root button` 加上 `-webkit-appearance: none; appearance: none;`。`tsc --noEmit`、`pnpm test` 通過，但這次先不標記已完成，等使用者實機測試回報再確認是否真的解決。
- 2026-08-14：找到真正根因，不在 CSS 而在 JS。`timeline-panel.ts` 的 `tick()` 由 `main.ts` 的 rAF 迴圈每幀呼叫，其中 `playPauseBtn.textContent = playing ? "暫停" : "播放"` 是無條件執行的。`textContent` 賦值即使字串相同，也會銷毀舊 text node 再建新的，等於每 16ms 換一次。Chrome 判定 `click` 是取 mousedown 與 mouseup 命中節點的共同祖先，滑鼠壓在按鈕文字上時命中的正是那個 text node；一次正常點擊橫跨數幀，放開時當初按下的 text node 已被替換且脫離 DOM，共同祖先算不出來，`click` 因此完全不發送。這解釋了全部現象：點文字沒反應、點邊緣 padding 正常、DevTools 檢查命中的確實是按鈕本身（問題不在 hit-test，在 click 的合成）。決定性證據：工具列上 `新增彈幕`、`縮小`、`放大` 的 textContent 都只在建立時設一次，全部正常；唯一每幀重寫文字的暫停/播放鈕，就是唯一壞掉的那顆。「先在影片區域按暫停」確認為巧合，兩種播放狀態下該行都照樣每幀重寫。
- 2026-08-14：修法：在 `tick()` 沿用本檔案既有的「值沒變就不寫」快取模式（同 `renderBlocks()` 的 `lastLeft`/`lastText`、`renderDetail()` 的 `detailLastValues`），加入 `lastPlaying`／`lastReady`／`lastTimeLabel` 三個快取，只有狀態真的改變才寫入 textContent、aria-label、disabled、title、hidden；`renderTicks()` 的刻度標籤同樣加上比對再寫。並留註解說明為何不能無條件寫 textContent。先前兩次的 CSS 改動（`user-select`、`appearance`）並非根因，但對按鈕而言是合理的樣式衛生，予以保留。`tsc --noEmit`、`pnpm test`（97 條全過）通過。待使用者實機驗證：重點測「壓住按鈕文字約半秒再放開」，舊版在這種慢速點擊下必定失效。
- 2026-08-14：使用者實機驗證通過，慢速點擊按鈕文字可正常暫停/播放，issue 關閉。
