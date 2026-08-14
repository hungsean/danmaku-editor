# Issue 索引

專案內的輕量 issue 追蹤，取代 GitHub Issues，讓每個 issue 跟 commit 一起版控、一起 review。

## 使用方式

- 新增 issue：在這裡加一列，並在本資料夾新增 `<ID>-<簡短英文或拼音 slug>.md`，內容依 `_template.md`
- ID 用遞增整數，取目前最大 ID + 1，不重複使用已刪除的 ID
- 狀態異動時，同時更新這裡的表格與 issue 檔案內的「狀態」欄位
- 「已完成」「不處理」的 issue 檔案保留，不刪除；`git log` 保留歷史即可，不用另外整理

## 狀態

`待處理` / `進行中` / `已完成` / `不處理`

## 清單

| ID | 標題 | 類型 | 狀態 | 更新 |
| -- | -- | -- | -- | -- |
| [1](1-track-header-alignment.md) | 新增軌道按鈕移到軌道名稱上方，並對齊軌道高度 | bug | 已完成 | 2026-08-14 |
| [2](2-pause-control-unresponsive.md) | 影片區域按暫停後，控制台暫停/播放按鈕失效 | bug | 待處理 | 2026-08-14 |
| [3](3-track-scroll-wheel-timeline.md) | 在軌道區域滾動滾輪讓時間軸跟著捲動 | feature | 待處理 | 2026-08-14 |
| [4](4-drag-block-grab-offset.md) | 拖移彈幕方塊應以抓取點為基準，而非方塊最前端 | bug | 待處理 | 2026-08-14 |
| [5](5-resizable-panel-height.md) | 控制台視窗支援往下拉伸 | feature | 待處理 | 2026-08-14 |
| [6](6-split-timeline-panel.md) | timeline-panel.ts 一定要拆分 | chore | 待處理 | 2026-08-14 |
