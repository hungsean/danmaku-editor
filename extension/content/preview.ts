/**
 * 彈幕預覽層。
 * 依 store 中的草稿與 player 目前時間，於播放器上方渲染彈幕動畫預覽。
 * 絕對不可攔截影片的任何互動（點擊、拖拉、音量、原生控制列）。
 */

import type { DanmakuDraft, PreviewDeps, PreviewHandle } from "../shared/types.js"
import { SIZE_FONT_PX } from "../shared/types.js"
import { getScrollX, getVisibleDanmaku } from "../shared/timeline.js"

/** 上下固定彈幕的軌道數（垂直方向可分配的行數）。 */
const FIXED_TRACK_COUNT = 4
/** 滑動彈幕的軌道數。 */
const SCROLL_TRACK_COUNT = 6
/** 上下軌道之間的間距（px），實際字級另外疊加。 */
const TRACK_GAP_PX = 6
/** 距上緣／下緣的安全邊界（px）。 */
const SAFE_MARGIN_PX = 8

type PoolEntry = {
  el: HTMLDivElement
  lastText: string
  lastColor: string
  lastSize: string
}

/** 依字串（例如 draft.id）計算一個穩定的雜湊值，用來分配軌道，避免彈幕互相重疊。 */
function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function trackForDraft(draft: DanmakuDraft, trackCount: number): number {
  return hashString(draft.id) % trackCount
}

export function createPreview(deps: PreviewDeps): PreviewHandle {
  const { store, player } = deps

  const element = document.createElement("div")
  element.setAttribute("data-danmaku-preview-root", "")
  element.style.position = "absolute"
  element.style.inset = "0"
  element.style.overflow = "hidden"
  element.style.pointerEvents = "none"

  const style = document.createElement("style")
  style.textContent = `
    [data-danmaku-preview-root] {
      pointer-events: none;
    }
    .danmaku-item {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      white-space: nowrap;
      font-weight: bold;
      font-family: "Microsoft JhengHei", "PingFang TC", sans-serif;
      line-height: 1.2;
      text-shadow:
        -1px -1px 0 #000,
        1px -1px 0 #000,
        -1px 1px 0 #000,
        1px 1px 0 #000,
        0 0 4px rgba(0, 0, 0, 0.8);
      will-change: transform;
    }
  `
  element.appendChild(style)

  const layer = document.createElement("div")
  layer.style.position = "absolute"
  layer.style.inset = "0"
  layer.style.pointerEvents = "none"
  element.appendChild(layer)

  // id -> pooled DOM element，供增量更新使用。
  const pool = new Map<string, PoolEntry>()

  function clearAll(): void {
    for (const entry of pool.values()) {
      entry.el.remove()
    }
    pool.clear()
  }

  function verticalPositionFor(draft: DanmakuDraft, viewportHeight: number, fontPx: number): number {
    const trackHeight = fontPx + TRACK_GAP_PX
    if (draft.position === "top") {
      const track = trackForDraft(draft, FIXED_TRACK_COUNT)
      return SAFE_MARGIN_PX + track * trackHeight
    }
    if (draft.position === "bottom") {
      const track = trackForDraft(draft, FIXED_TRACK_COUNT)
      return viewportHeight - SAFE_MARGIN_PX - fontPx - track * trackHeight
    }
    // scroll
    const track = trackForDraft(draft, SCROLL_TRACK_COUNT)
    return SAFE_MARGIN_PX + track * trackHeight
  }

  function render(currentTime: number | null, enabled: boolean): void {
    if (!enabled || currentTime === null) {
      clearAll()
      return
    }

    const viewport = player.getViewportSize()
    if (!viewport) {
      clearAll()
      return
    }

    const visible = getVisibleDanmaku(store.getAll(), currentTime)
    const seen = new Set<string>()

    for (const { draft, progress } of visible) {
      seen.add(draft.id)
      const fontPx = SIZE_FONT_PX[draft.size]

      let entry = pool.get(draft.id)
      if (!entry) {
        const el = document.createElement("div")
        el.className = "danmaku-item"
        layer.appendChild(el)
        entry = { el, lastText: "", lastColor: "", lastSize: "" }
        pool.set(draft.id, entry)
      }

      if (entry.lastText !== draft.text) {
        entry.el.textContent = draft.text
        entry.lastText = draft.text
      }
      if (entry.lastColor !== draft.color) {
        entry.el.style.color = draft.color
        entry.lastColor = draft.color
      }
      if (entry.lastSize !== draft.size) {
        entry.el.style.fontSize = `${fontPx}px`
        entry.lastSize = draft.size
      }

      const y = verticalPositionFor(draft, viewport.height, fontPx)
      let x: number
      if (draft.position === "scroll") {
        const textWidth = entry.el.offsetWidth
        x = getScrollX(progress, viewport.width, textWidth)
      } else {
        const textWidth = entry.el.offsetWidth
        x = (viewport.width - textWidth) / 2
      }

      entry.el.style.transform = `translate(${x}px, ${y}px)`
    }

    // 移除已不再可見（離場）的彈幕。
    for (const [id, entry] of pool) {
      if (!seen.has(id)) {
        entry.el.remove()
        pool.delete(id)
      }
    }
  }

  function destroy(): void {
    clearAll()
    element.remove()
  }

  return { element, render, destroy }
}
