/**
 * 時間軸純邏輯模組。
 * 不可 import 任何瀏覽器 API（沒有 document、window、HTMLElement），
 * 只能從 "./types.js" import 型別與常數。
 */

import type { DanmakuDraft, DanmakuPosition, DanmakuVisibility, TimelineWindow } from "./types.js"
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

// ---------------------------------------------------------------------------
// 時間軸滾動視窗（跟隨播放時間，前後展開 halfSpanSec 秒）
// ---------------------------------------------------------------------------

/**
 * 以 currentTime 為中心，前後各展開 halfSpanSec 秒的時間軸視窗。
 * start 允許為負（畫面上會有影片開始前的留白），不夾到 0，
 * 因為播放頭必須固定在面板正中央。
 */
export function getTimelineWindow(currentTime: number, halfSpanSec: number): TimelineWindow {
  return { start: currentTime - halfSpanSec, end: currentTime + halfSpanSec }
}

/** 判斷一個 TimelineWindow 是否為有效（可換算座標）的視窗。 */
function isValidWindow(window: TimelineWindow): boolean {
  return (
    Number.isFinite(window.start) &&
    Number.isFinite(window.end) &&
    window.end > window.start
  )
}

/**
 * 把時間換算成面板內的 px 座標：window.start 對應 0，window.end 對應 width。線性內插。
 * window 無效（end <= start 或非有限數）時安全回傳 0。
 */
export function timeToX(time: number, window: TimelineWindow, width: number): number {
  if (!Number.isFinite(time) || !isValidWindow(window) || !Number.isFinite(width)) {
    return 0
  }
  const span = window.end - window.start
  return ((time - window.start) / span) * width
}

/** timeToX 的反函式：把面板內的 px 座標換算回時間。 */
export function xToTime(x: number, window: TimelineWindow, width: number): number {
  if (!Number.isFinite(x) || !isValidWindow(window) || !Number.isFinite(width) || width === 0) {
    return window.start
  }
  return window.start + (x / width) * (window.end - window.start)
}

/**
 * 視窗內每 1 px 對應的秒數。width 為 0 或視窗無效時安全回傳 0（不出現 Infinity/NaN）。
 */
export function getSecondsPerPixel(window: TimelineWindow, width: number): number {
  if (!isValidWindow(window) || !Number.isFinite(width) || width === 0) {
    return 0
  }
  return (window.end - window.start) / width
}

/**
 * 每 1 秒對應的 px 數。width 為 0 或視窗無效時安全回傳 0（不出現 Infinity/NaN）。
 */
export function getPixelsPerSecond(window: TimelineWindow, width: number): number {
  if (!isValidWindow(window) || !Number.isFinite(width)) {
    return 0
  }
  const span = window.end - window.start
  if (span === 0) {
    return 0
  }
  return width / span
}

/**
 * 回傳「顯示區間與視窗有重疊」的彈幕。彈幕顯示區間為
 * [draft.time, draft.time + getDurationForPosition(draft.position))，
 * 因此在 window.start 之前開始、但延續到視窗內的彈幕也會被包含。
 */
export function getDraftsInWindow(
  drafts: ReadonlyArray<DanmakuDraft>,
  window: TimelineWindow,
): DanmakuDraft[] {
  if (!isValidWindow(window)) {
    return []
  }

  const result: DanmakuDraft[] = []
  for (const draft of drafts) {
    const duration = getDurationForPosition(draft.position)
    const end = draft.time + duration
    if (end > window.start && draft.time < window.end) {
      result.push(draft)
    }
  }
  return result
}

/** getRulerTicks 選擇刻度間隔時的候選秒數，由密到疏。 */
const TICK_INTERVAL_CANDIDATES_SEC: ReadonlyArray<number> = [0.5, 1, 2, 5, 10, 15, 30, 60]

/** 浮點誤差容許值：用來判斷一個時間是否落在某個間隔的整數倍上。 */
const TICK_EPSILON = 1e-6

function isMajorTick(time: number, interval: number): boolean {
  const stepIndex = time / interval
  const nearestFifthStep = Math.round(stepIndex / 5) * 5
  if (Math.abs(stepIndex - nearestFifthStep) < TICK_EPSILON) {
    return true
  }
  const nearestMinute = Math.round(time / 60) * 60
  return Math.abs(time - nearestMinute) < TICK_EPSILON
}

/**
 * 產生時間刻度，依縮放程度自動選擇合適的間隔：
 * 從候選 [0.5, 1, 2, 5, 10, 15, 30, 60] 秒中，挑第一個能讓相鄰刻度
 * 間距（px）達到 minPxBetweenTicks（預設 60）的間隔；若都不滿足則用最大的候選（60 秒）。
 * 刻度時間對齊間隔的整數倍（不是從 window.start 起算）。
 * major 標示較大的整數刻度（每 5 格，或跨整分鐘）。
 * width 為 0 或 window 無效時回傳空陣列。
 */
export function getRulerTicks(
  window: TimelineWindow,
  width: number,
  minPxBetweenTicks = 60,
): Array<{ time: number; x: number; major: boolean }> {
  if (!isValidWindow(window) || !Number.isFinite(width) || width <= 0) {
    return []
  }

  const pxPerSecond = getPixelsPerSecond(window, width)

  let interval = TICK_INTERVAL_CANDIDATES_SEC[TICK_INTERVAL_CANDIDATES_SEC.length - 1]
  for (const candidate of TICK_INTERVAL_CANDIDATES_SEC) {
    if (candidate * pxPerSecond >= minPxBetweenTicks) {
      interval = candidate
      break
    }
  }

  const ticks: Array<{ time: number; x: number; major: boolean }> = []
  const firstTickIndex = Math.ceil(window.start / interval - TICK_EPSILON)
  const lastTickIndex = Math.floor(window.end / interval + TICK_EPSILON)

  for (let index = firstTickIndex; index <= lastTickIndex; index += 1) {
    // 以整數格數乘上間隔計算時間，避免逐次相加造成浮點誤差累積。
    const time = Math.round(index * interval * 1e6) / 1e6
    ticks.push({
      time,
      x: timeToX(time, window, width),
      major: isMajorTick(time, interval),
    })
  }

  return ticks
}

/**
 * 夾到 0 以上，若 duration 不為 null 也夾到不超過 duration，並四捨五入到 0.1 秒。
 */
export function snapTime(seconds: number, duration: number | null): number {
  if (!Number.isFinite(seconds)) {
    return 0
  }

  let value = Math.max(0, seconds)
  if (duration !== null && Number.isFinite(duration)) {
    value = Math.min(value, Math.max(0, duration))
  }

  return Math.round(value * 10) / 10
}
