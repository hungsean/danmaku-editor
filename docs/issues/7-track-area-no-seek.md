# #7 點軌道區不應該跳轉，只有刻度區才需要

- 類型：bug
- 狀態：待處理
- 建立：2026-08-14
- 更新：2026-08-14

## 描述

目前點擊軌道空白處（`.tp-lane-track`）跟點擊刻度尺（`.tp-ruler`）一樣會呼叫 `handleSeekClick` 觸發 seek 跳轉（見 `timeline-panel.ts` 的 `rebuildLanes()` 中 `laneTrack.addEventListener("click", handleSeekClick)`）。

期望改成：只有點刻度尺才會 seek 跳轉，點軌道區空白處不應該跳轉播放時間點。

## 留言

- 2026-08-14：建立 issue
