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

// 浮動退路刻意放右上角：播放器的原生控制項都集中在底部，
// 放右下角必定會壓到全螢幕、畫質那一排。
const FLOATING_STYLE =
  "position: absolute;" +
  "right: 12px;" +
  "top: 12px;" +
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

  /**
   * 檢查按鈕是否與控制列中任何既有元素重疊。
   *
   * 動畫瘋的控制列大量使用絕對定位與右對齊佈局，直接 append 一顆按鈕
   * 不會替它挪出空間，結果就是壓在全螢幕、畫質那類按鈕上面。
   * 與其猜測網站的佈局方式，不如插入後實際量測。
   */
  function overlapsControlBarContent(bar: HTMLElement): boolean {
    const own = element.getBoundingClientRect()
    if (own.width === 0 || own.height === 0) return false

    for (const other of Array.from(bar.querySelectorAll<HTMLElement>("*"))) {
      // 跳過自己、自己的後代，以及包含自己的祖先（祖先本來就會涵蓋自己）。
      if (other === element) continue
      if (element.contains(other) || other.contains(element)) continue

      const rect = other.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue

      const overlapX = Math.min(own.right, rect.right) - Math.max(own.left, rect.left)
      const overlapY = Math.min(own.bottom, rect.bottom) - Math.max(own.top, rect.top)
      // 容忍 2px 的邊界誤差，避免相鄰元素被誤判成重疊。
      if (overlapX > 2 && overlapY > 2) return true
    }

    return false
  }

  /**
   * 上次嘗試掛載失敗的時間戳。
   * attach() 由 animation frame 每幀呼叫，而失敗路徑會跑 querySelectorAll
   * 與大量 getBoundingClientRect（強制 reflow），每幀重試會拖垮效能，
   * 因此失敗後要等冷卻時間才再試一次。
   */
  let lastFailedAt = 0
  const RETRY_COOLDOWN_MS = 1000

  function attach(video: HTMLVideoElement): boolean {
    if (attachedToControlBar && element.isConnected) return true

    const now = Date.now()
    if (now - lastFailedAt < RETRY_COOLDOWN_MS) return false
    lastFailedAt = now

    const bar = findControlBar(video)
    if (!bar) {
      attachedToControlBar = false
      applyAppearance()
      return false
    }

    // 依序嘗試幾種插入點，取第一個不會疊到既有元素的。
    const placements: Array<() => void> = [
      () => bar.appendChild(element),
      () => bar.insertBefore(element, bar.firstChild),
      () => {
        const last = bar.lastElementChild
        if (last && last !== element) bar.insertBefore(element, last)
        else bar.appendChild(element)
      },
    ]

    attachedToControlBar = true
    for (const place of placements) {
      place()
      applyAppearance()
      if (!overlapsControlBarContent(bar)) return true
    }

    // 每個插入點都會疊到既有控制項，改用浮動退路，不要破壞網站原本的按鈕。
    element.remove()
    attachedToControlBar = false
    applyAppearance()
    return false
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
