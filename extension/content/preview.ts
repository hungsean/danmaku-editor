/**
 * 彈幕預覽層。
 * 依 store 中的草稿與 player 目前時間，於播放器上方渲染彈幕動畫預覽。
 * 絕對不可攔截影片的任何互動（點擊、拖拉、音量、原生控制列）。
 */

import type { DanmakuDraft, PreviewDeps, PreviewHandle } from "../shared/types.js"
import { SIZE_FONT_PX } from "../shared/types.js"
import { getScrollX, getVisibleDanmaku } from "../shared/timeline.js"

/** 同一軌道內，相鄰彈幕列之間的間距（px），實際字級另外疊加。 */
const TRACK_GAP_PX = 6
/** 每條軌道區塊內、上緣的安全邊界（px）。 */
const SAFE_MARGIN_PX = 8
/**
 * 同一軌道區塊內，子列雜湊分配的上限。
 * 若不設上限，子列數會隨區塊高度線性增加（軌道數愈少、區塊愈高），
 * 雜湊值就可能把單獨一則彈幕分到離錨定邊緣很遠的子列，看起來像「位置跑掉」。
 * 固定／滑動各自沿用原本三軌設計時的密度，維持視覺上的貼齊感。
 */
const MAX_FIXED_SUB_TRACKS = 4
const MAX_SCROLL_SUB_TRACKS = 6

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

function subTrackForDraft(draft: DanmakuDraft, subTrackCount: number): number {
  return hashString(draft.id) % subTrackCount
}

export function createPreview(deps: PreviewDeps): PreviewHandle {
  const { store, trackStore, player } = deps

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

  /**
   * 每條軌道各自佔用螢幕高度中平均分配到的一個水平區塊（依軌道順序由上到下排列）。
   * 區塊內依彈幕自己的 behavior 決定貼齊區塊上緣還是下緣；
   * 同一區塊內若同時有多則彈幕，再用雜湊值分配子列，避免互相重疊。
   */
  function verticalPositionFor(
    draft: DanmakuDraft,
    trackIndex: number,
    trackCount: number,
    viewportHeight: number,
    fontPx: number,
  ): number {
    const bandHeight = viewportHeight / trackCount
    const bandTop = trackIndex * bandHeight
    const rowHeight = fontPx + TRACK_GAP_PX
    const maxSubTracks = draft.behavior === "scroll" ? MAX_SCROLL_SUB_TRACKS : MAX_FIXED_SUB_TRACKS
    const subTrackCount = Math.max(
      1,
      Math.min(maxSubTracks, Math.floor((bandHeight - SAFE_MARGIN_PX) / rowHeight)),
    )
    const subTrack = subTrackForDraft(draft, subTrackCount)

    if (draft.behavior === "bottom") {
      return bandTop + bandHeight - SAFE_MARGIN_PX - fontPx - subTrack * rowHeight
    }
    // "scroll" 與 "top" 都貼齊區塊上緣，差別只在於是否橫向移動。
    return bandTop + SAFE_MARGIN_PX + subTrack * rowHeight
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

    const tracks = trackStore.getAll()
    const trackIndexById = new Map<string, number>(tracks.map((track, index) => [track.id, index]))

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

      const trackIndex = trackIndexById.get(draft.trackId) ?? 0
      const y = verticalPositionFor(draft, trackIndex, Math.max(1, tracks.length), viewport.height, fontPx)
      let x: number
      if (draft.behavior === "scroll") {
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
