/**
 * 時間軸純邏輯模組。
 * 不可 import 任何瀏覽器 API（沒有 document、window、HTMLElement），
 * 只能從 "./types.js" import 型別與常數。
 */

import type { DanmakuDraft, DanmakuPosition, DanmakuVisibility } from "./types.js"
import { FIXED_DURATION_SEC, SCROLL_DURATION_SEC } from "./types.js"

/** 依彈幕的顯示位置取得其顯示總時長（秒）。 */
export function getDurationForPosition(position: DanmakuPosition): number {
  return position === "scroll" ? SCROLL_DURATION_SEC : FIXED_DURATION_SEC
}

/**
 * 依彈幕的 time、position 與目前影片秒數，判定是否可見與動畫進度。
 * 顯示區間為 [draft.time, draft.time + duration)。
 * progress = (currentTime - draft.time) / duration，範圍 0..1。
 */
export function getVisibility(draft: DanmakuDraft, currentTime: number): DanmakuVisibility {
  const duration = getDurationForPosition(draft.position)
  const elapsed = currentTime - draft.time

  if (elapsed < 0 || elapsed >= duration) {
    return { visible: false }
  }

  return { visible: true, progress: elapsed / duration }
}

/** 回傳目前所有可見的彈幕與其進度。 */
export function getVisibleDanmaku(
  drafts: ReadonlyArray<DanmakuDraft>,
  currentTime: number,
): Array<{ draft: DanmakuDraft; progress: number }> {
  const result: Array<{ draft: DanmakuDraft; progress: number }> = []

  for (const draft of drafts) {
    const visibility = getVisibility(draft, currentTime)
    if (visibility.visible) {
      result.push({ draft, progress: visibility.progress })
    }
  }

  return result
}

/**
 * 滑動彈幕的水平位移：progress 0 時文字左緣位於播放器右緣（viewportWidth），
 * progress 1 時文字完全移出左側（-textWidth）。線性內插。
 */
export function getScrollX(progress: number, viewportWidth: number, textWidth: number): number {
  const start = viewportWidth
  const end = -textWidth
  return start + (end - start) * progress
}

/**
 * 夾到不小於 0，並四捨五入到 0.1 秒精度，避免浮點誤差累積。
 */
export function clampTime(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0
  }
  return Math.round(seconds * 10) / 10
}

/**
 * 格式化為 MM:SS.d（例如 83.45 秒 -> 01:23.4）。
 * 負數或 NaN 時安全回傳 00:00.0。超過 60 分鐘時分鐘位可以繼續累加。
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00.0"
  }

  // 無條件捨去到 0.1 秒精度（不四捨五入），例如 83.45 -> 01:23.4。
  const totalTenths = Math.floor(seconds * 10 + 1e-9)
  const wholeSeconds = Math.floor(totalTenths / 10)
  const tenths = totalTenths % 10
  const minutes = Math.floor(wholeSeconds / 60)
  const secs = wholeSeconds % 60

  const mm = String(minutes).padStart(2, "0")
  const ss = String(secs).padStart(2, "0")

  return `${mm}:${ss}.${tenths}`
}
