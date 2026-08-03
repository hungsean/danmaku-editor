/**
 * 開關工作台的按鈕。
 *
 * 動畫瘋播放器的控制列 DOM 結構未知且可能隨時改版，因此採兩段式策略：
 * 1. 用通用啟發式在 video 的定位容器中尋找「看起來像控制列」的元素，
 *    找到就把按鈕 append 進去（絕不修改既有子元素）。
 * 2. 找不到時退回一顆 position:absolute 的浮動按鈕，交由呼叫端（main.ts）
 *    自行疊在影片右下角。
 *
 * 因為注入的是網站自己的 DOM（不在 Shadow DOM 內），所有樣式一律用
 * inline style 撰寫，並以 `all: initial` 起手，避免受網站 CSS 影響、
 * 也避免污染網站樣式。
 */

import type { ToggleButtonDeps, ToggleButtonHandle } from "../shared/types.js"

const MARK_ATTR = "data-danmaku-workbench"

// ---------------------------------------------------------------------------
// 控制列偵測啟發式
// ---------------------------------------------------------------------------

/** 找出 video 的定位容器：offsetParent，或最近的 position 非 static 的祖先。 */
function findPositionedAncestor(video: HTMLVideoElement): HTMLElement {
  if (video.offsetParent instanceof HTMLElement) return video.offsetParent

  let el: HTMLElement | null = video.parentElement
  while (el) {
    const position = getComputedStyle(el).position
    if (position !== "static") return el
    el = el.parentElement
  }
  // 全都找不到就退回 body，讓後續的候選搜尋自然失敗（回傳 null）。
  return document.body
}

function countClickableChildren(el: Element): number {
  let count = 0
  for (const child of Array.from(el.children)) {
    const isButton = child.tagName === "BUTTON"
    const hasRole = child.hasAttribute("role")
    const hasOnClick = child.hasAttribute("onclick")
    if (isButton || hasRole || hasOnClick) count++
  }
  return count
}

/**
 * 在容器的後代中尋找看起來像控制列的元素：
 * - 位於容器底部區域（元素 bottom 落在容器高度下方 25% 內）
 * - 橫向接近滿寬（至少容器寬度的 60%）
 * - 高度較矮（約 24px 到 80px）
 * - 內部至少有 2 個可點擊子元素（button、或有 role/onclick 屬性）
 * 有多個候選時，選最靠近底部、子元素最多的那一個。
 */
export function findControlBar(video: HTMLVideoElement): HTMLElement | null {
  const container = findPositionedAncestor(video)
  const containerRect = container.getBoundingClientRect()
  if (containerRect.width === 0 || containerRect.height === 0) return null

  const bottomZoneStart = containerRect.top + containerRect.height * 0.75
  const minWidth = containerRect.width * 0.6

  let best: HTMLElement | null = null
  let bestClickableCount = -1
  let bestBottom = -Infinity

  const candidates = container.querySelectorAll<HTMLElement>("*")
  for (const el of Array.from(candidates)) {
    // 不要把我們自己注入的按鈕或其容器當成候選。
    if (el.hasAttribute(MARK_ATTR)) continue

    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    const height = rect.height
    if (height < 24 || height > 80) continue
    if (rect.width < minWidth) continue
    if (rect.bottom < bottomZoneStart || rect.bottom > containerRect.bottom + 4) continue

    const clickableCount = countClickableChildren(el)
    if (clickableCount < 2) continue

    const isBetter =
      clickableCount > bestClickableCount ||
      (clickableCount === bestClickableCount && rect.bottom > bestBottom)
    if (isBetter) {
      best = el
      bestClickableCount = clickableCount
      bestBottom = rect.bottom
    }
  }

  return best
}

// ---------------------------------------------------------------------------
// 按鈕本體
// ---------------------------------------------------------------------------

const BASE_STYLE =
  "all: initial;" +
  "display: inline-flex;" +
  "align-items: center;" +
  "justify-content: center;" +
  "box-sizing: border-box;" +
  "margin: 0 4px;" +
  "padding: 0 10px;" +
  "height: 28px;" +
  "font-family: 'Microsoft JhengHei', 'PingFang TC', sans-serif;" +
  "font-size: 13px;" +
  "font-weight: bold;" +
  "line-height: 28px;" +
  "border-radius: 4px;" +
  "cursor: pointer;" +
  "user-select: none;" +
  "color: #ffffff;" +
  "background-color: rgba(255, 255, 255, 0.15);" +
  "border: 1px solid rgba(255, 255, 255, 0.4);"

const FLOATING_STYLE =
  "position: absolute;" +
  "right: 12px;" +
  "bottom: 12px;" +
  "z-index: 2147483000;"

const OPEN_BACKGROUND = "background-color: #4d96ff;"
const OPEN_BORDER = "border: 1px solid #4d96ff;"
const CLOSED_BACKGROUND = "background-color: rgba(255, 255, 255, 0.15);"
const CLOSED_BORDER = "border: 1px solid rgba(255, 255, 255, 0.4);"

const LABEL = "彈幕工作台"

export function createToggleButton(
  deps: ToggleButtonDeps,
): ToggleButtonHandle & {
  attach(video: HTMLVideoElement): boolean
  isAttachedToControlBar(): boolean
} {
  const { isOpen, toggle } = deps

  const element = document.createElement("button")
  element.type = "button"
  element.setAttribute(MARK_ATTR, "toggle")
  element.setAttribute("aria-label", LABEL)
  element.textContent = LABEL
  element.style.cssText = BASE_STYLE

  element.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    toggle()
  })

  let attachedToControlBar = false

  function applyAppearance(): void {
    const open = isOpen()
    element.style.cssText = BASE_STYLE + (open ? OPEN_BACKGROUND + OPEN_BORDER : CLOSED_BACKGROUND + CLOSED_BORDER)
    if (!attachedToControlBar) {
      element.style.cssText += FLOATING_STYLE
    }
    element.setAttribute("aria-pressed", open ? "true" : "false")
  }

  function attach(video: HTMLVideoElement): boolean {
    if (attachedToControlBar && element.isConnected) return true

    const bar = findControlBar(video)
    if (!bar) {
      attachedToControlBar = false
      applyAppearance()
      return false
    }

    bar.appendChild(element)
    attachedToControlBar = true
    applyAppearance()
    return true
  }

  function isAttachedToControlBar(): boolean {
    return attachedToControlBar && element.isConnected
  }

  function tick(): void {
    applyAppearance()
  }

  function destroy(): void {
    element.remove()
  }

  applyAppearance()

  return { element, attach, isAttachedToControlBar, tick, destroy }
}
