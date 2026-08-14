# #3 在軌道區域滾動滾輪讓時間軸跟著捲動

- 類型：feature
- 狀態：已完成
- 建立：2026-08-14
- 更新：2026-08-14

## 描述

在軌道上滾動滾輪時，希望讓時間軸跟著捲動（左右移動可視範圍），但播放時間點（播放頭位置）不需要跟著改變。

## 留言

- 2026-08-14：建立 issue
- 2026-08-14：在 `timeline-panel.ts` 新增 `scrollOffsetSec` 狀態，於刻度尺／軌道區域監聽 `wheel` 事件平移可視範圍；播放頭改為依 `timeToX(lastKnownTime, currentWindow, width)` 動態定位（原本寫死在 CSS `left: 50%`），完成後移到 finished/。
