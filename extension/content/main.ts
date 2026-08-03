/**
 * content script 進入點。
 *
 * 職責：
 * - 尋找並綁定頁面既有的 <video>（動畫瘋是 SPA，切集數會重建 video）
 * - 建立兩個獨立的 Shadow DOM host：
 *     1. overlayHost：fixed 浮層，放本機預覽層，疊在影片視覺區域上
 *     2. panelHost：插進頁面流，卡在播放器容器與標題選集區之間，放時間軸工作台
 * - 把切換按鈕交給 toggle-button.ts 嘗試掛進播放器控制列
 * - 以 animation frame 驅動上述模組
 *
 * 這裡不使用任何 Safari-only 或 Chrome-only 的 extension API，
 * 未來遷移 Chromium 時本檔案可原封不動沿用。
 */

import type { DanmakuDraft, DraftStore, PlayerHandle } from "../shared/types.js"
import { clampTime } from "../shared/timeline.js"
import { createTimelinePanel } from "./timeline-panel.js"
import { createPreview } from "./preview.js"
import { createToggleButton } from "./toggle-button.js"

const OVERLAY_HOST_ID = "bahamut-danmaku-workbench-overlay"
const PANEL_HOST_ID = "bahamut-danmaku-workbench-panel"

// ---------------------------------------------------------------------------
// 播放器綁定
// ---------------------------------------------------------------------------

function isUsableVideo(el: HTMLVideoElement): boolean {
  // readyState 至少要有 metadata，才代表這是真的可播放的影片而非佔位元素。
  return el.isConnected && el.readyState >= HTMLMediaElement.HAVE_METADATA
}

function findVideo(): HTMLVideoElement | null {
  // 優先取可播放且面積最大的，避免抓到廣告或縮圖用的隱藏 video。
  let best: HTMLVideoElement | null = null
  let bestArea = 0
  for (const video of document.querySelectorAll("video")) {
    if (!isUsableVideo(video)) continue
    const rect = video.getBoundingClientRect()
    const area = rect.width * rect.height
    if (area > bestArea) {
      best = video
      bestArea = area
    }
  }
  return best
}

/**
 * 從 video 往上找「內容區」容器：同時包含播放器與右側彈幕列表的那一層。
 *
 * 面板要橫跨整個內容區而不只是影片寬度，否則右側會空一大塊。
 * 判斷方式是往上走到第一個明顯比影片寬的祖先，不依賴任何 class 名稱。
 * 若該祖先寬得離譜（通常代表已經走到 body 或整頁容器），就放棄改用影片本身，
 * 免得面板橫跨整個瀏覽器視窗。
 */
function findContentContainer(video: HTMLVideoElement): HTMLElement {
  const videoWidth = video.getBoundingClientRect().width
  if (videoWidth <= 0) return video

  let node: HTMLElement = video
  while (node.parentElement && node.parentElement !== document.body) {
    const parent = node.parentElement
    const width = parent.getBoundingClientRect().width
    if (width > videoWidth * 1.05) {
      return width > videoWidth * 2.5 ? video : parent
    }
    node = parent
  }

  return video
}

type InternalPlayer = PlayerHandle & {
  /** 重新確認綁定的 video 是否仍有效，必要時重新尋找。 */
  refresh(): void
  /** 目前綁定的 video；未綁定時為 null。 */
  getVideo(): HTMLVideoElement | null
  /** 影片在視窗中的位置與尺寸，供預覽層對齊；未綁定時為 null。 */
  getRect(): DOMRect | null
}

function createPlayerHandle(): InternalPlayer {
  let video: HTMLVideoElement | null = null

  const live = (): HTMLVideoElement | null =>
    video && isUsableVideo(video) ? video : null

  return {
    refresh: () => {
      if (video && isUsableVideo(video)) return
      video = findVideo()
    },
    getVideo: () => live(),
    isReady: () => live() !== null,
    getCurrentTime: () => live()?.currentTime ?? null,
    isPlaying: () => {
      const el = live()
      return el ? !el.paused && !el.ended : false
    },
    play: () => {
      // 使用者可能在影片尚未就緒時按下，play() 回傳的 promise 失敗不應拋出未捕捉錯誤。
      void live()?.play().catch(() => undefined)
    },
    pause: () => live()?.pause(),
    seek: (seconds) => {
      const el = live()
      if (!el) return
      const duration = Number.isFinite(el.duration) ? el.duration : null
      const target = duration === null ? Math.max(0, seconds) : Math.min(Math.max(0, seconds), duration)
      el.currentTime = target
    },
    getDuration: () => {
      const el = live()
      return el && Number.isFinite(el.duration) ? el.duration : null
    },
    getViewportSize: () => {
      const el = live()
      if (!el) return null
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      return { width: rect.width, height: rect.height }
    },
    getRect: () => live()?.getBoundingClientRect() ?? null,
  }
}

// ---------------------------------------------------------------------------
// 草稿儲存：僅存記憶體，重新整理即遺失（此版刻意不做持久化）。
// ---------------------------------------------------------------------------

function createId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 初次載入的示範彈幕，讓使用者立刻在時間軸上看見三種位置的差異；全部可刪除。
 * 內容刻意用中性佔位文字。
 */
function createDemoDrafts(): DanmakuDraft[] {
  return [
    { id: createId(), time: 2, text: "示範彈幕：滑動", position: "scroll", size: "medium", color: "#ffffff" },
    { id: createId(), time: 5, text: "示範彈幕：上方", position: "top", size: "large", color: "#ffd93d" },
    { id: createId(), time: 8, text: "示範彈幕：下方", position: "bottom", size: "medium", color: "#4d96ff" },
  ]
}

function createStore(): DraftStore {
  let drafts: DanmakuDraft[] = createDemoDrafts()
  let selectedId: string | null = drafts[0]?.id ?? null
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    getAll: () => drafts,
    getSelectedId: () => selectedId,
    select: (id) => {
      if (selectedId === id) return
      selectedId = id
      emit()
    },
    add: () => {
      const draft: DanmakuDraft = {
        id: createId(),
        time: 0,
        text: "",
        position: "scroll",
        size: "medium",
        color: "#ffffff",
      }
      drafts = [...drafts, draft]
      selectedId = draft.id
      emit()
      return draft.id
    },
    update: (id, patch) => {
      let changed = false
      drafts = drafts.map((draft) => {
        if (draft.id !== id) return draft
        changed = true
        const next = { ...draft, ...patch }
        if (patch.time !== undefined) next.time = clampTime(patch.time)
        return next
      })
      if (changed) emit()
    },
    remove: (id) => {
      const index = drafts.findIndex((draft) => draft.id === id)
      if (index === -1) return
      drafts = drafts.filter((draft) => draft.id !== id)
      if (selectedId === id) {
        selectedId = drafts[index]?.id ?? drafts[index - 1]?.id ?? null
      }
      emit()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// ---------------------------------------------------------------------------
// 啟動
// ---------------------------------------------------------------------------

function mount(): void {
  if (document.getElementById(OVERLAY_HOST_ID)) return

  const player = createPlayerHandle()
  const store = createStore()

  let previewEnabled = true
  let panelOpen = true

  // --- 浮層 host：預覽層 ---
  const overlayHost = document.createElement("div")
  overlayHost.id = OVERLAY_HOST_ID
  overlayHost.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;"
  const overlayRoot = overlayHost.attachShadow({ mode: "open" })
  document.documentElement.appendChild(overlayHost)

  const preview = createPreview({ store, player })
  // 預覽層要精準覆蓋影片視覺區域，因此包一層 fixed 容器逐幀對齊。
  const previewWrapper = document.createElement("div")
  previewWrapper.style.cssText = "position:fixed;pointer-events:none;display:none;"
  previewWrapper.appendChild(preview.element)
  overlayRoot.appendChild(previewWrapper)

  // 退路用的浮動切換按鈕容器：只有在控制列偵測失敗時才會用到。
  // 容器會覆蓋整個影片矩形，所以必須 pointer-events: none，否則會擋掉影片的點擊與拖拉；
  // 只有按鈕自己把 pointer-events 開回來。
  const floatingButtonWrapper = document.createElement("div")
  floatingButtonWrapper.style.cssText = "position:fixed;pointer-events:none;display:none;"
  overlayRoot.appendChild(floatingButtonWrapper)

  // --- 懸浮視窗 host：時間軸工作台 ---
  // 刻意不插進頁面流，避免改動動畫瘋的版面。
  // 位置固定貼齊影片正下方（對齊影片左緣與寬度），不可拖曳，
  // 效果等同嵌入版，差別只在於它是蓋在標題選集區上而不是把它們往下推。
  const panelHost = document.createElement("div")
  panelHost.id = PANEL_HOST_ID
  panelHost.style.cssText = "position:fixed;z-index:2147483001;display:block;left:0;top:0;width:0;"
  const panelRoot = panelHost.attachShadow({ mode: "open" })
  document.documentElement.appendChild(panelHost)

  const panel = createTimelinePanel({
    store,
    player,
    isPreviewEnabled: () => previewEnabled,
    setPreviewEnabled: (enabled) => {
      previewEnabled = enabled
    },
  })
  panelRoot.appendChild(panel.element)

  const toggleButton = createToggleButton({
    isOpen: () => panelOpen,
    toggle: () => {
      panelOpen = !panelOpen
      panelHost.style.display = panelOpen ? "block" : "none"
    },
  })

  // 面板與影片下緣的間距，以及上一幀寫入的定位值（用來省下重複的 style 寫入）。
  const PANEL_GAP_PX = 4
  let lastPanelLeft = Number.NaN
  let lastPanelTop = Number.NaN
  let lastPanelWidth = Number.NaN

  /**
   * 內容區容器的快取。
   * findContentContainer 會逐層 getBoundingClientRect 強制 reflow，
   * 每幀重算會拖垮效能，因此只在快取失效（換集、SPA 重建）時重新尋找。
   */
  let cachedContent: HTMLElement | null = null
  let cachedContentFor: HTMLVideoElement | null = null

  const getContentRect = (video: HTMLVideoElement): DOMRect => {
    if (cachedContentFor !== video || cachedContent === null || !cachedContent.isConnected) {
      cachedContent = findContentContainer(video)
      cachedContentFor = video
    }
    return cachedContent.getBoundingClientRect()
  }

  let frame = 0
  const loop = (): void => {
    player.refresh()
    const video = player.getVideo()

    if (video) {
      // 切換按鈕優先掛進網站自己的控制列；失敗才退回浮動按鈕。
      if (toggleButton.attach(video)) {
        floatingButtonWrapper.style.display = "none"
      } else {
        // 浮動模式下按鈕本身用 right/bottom 定位，
        // 因此容器必須與影片矩形完全對齊，按鈕才會落在影片右下角。
        const videoRect = video.getBoundingClientRect()
        floatingButtonWrapper.style.display = "block"
        floatingButtonWrapper.style.left = `${videoRect.left}px`
        floatingButtonWrapper.style.top = `${videoRect.top}px`
        floatingButtonWrapper.style.width = `${videoRect.width}px`
        floatingButtonWrapper.style.height = `${videoRect.height}px`
        if (toggleButton.element.parentElement !== floatingButtonWrapper) {
          floatingButtonWrapper.appendChild(toggleButton.element)
        }
      }
    }

    const rect = player.getRect()

    // 面板貼齊影片正下方，寬度橫跨整個內容區（含右側彈幕列表那一欄）。
    // 每幀寫入 style 會觸發多餘的樣式重算，因此值沒變就不寫。
    if (rect && video) {
      const contentRect = getContentRect(video)
      const left = Math.round(contentRect.left)
      const top = Math.round(rect.bottom + PANEL_GAP_PX)
      const width = Math.round(contentRect.width)
      if (left !== lastPanelLeft || top !== lastPanelTop || width !== lastPanelWidth) {
        panelHost.style.left = `${left}px`
        panelHost.style.top = `${top}px`
        panelHost.style.width = `${width}px`
        lastPanelLeft = left
        lastPanelTop = top
        lastPanelWidth = width
      }
    }

    if (rect && previewEnabled) {
      previewWrapper.style.display = "block"
      previewWrapper.style.left = `${rect.left}px`
      previewWrapper.style.top = `${rect.top}px`
      previewWrapper.style.width = `${rect.width}px`
      previewWrapper.style.height = `${rect.height}px`
    } else {
      previewWrapper.style.display = "none"
    }

    preview.render(player.getCurrentTime(), previewEnabled)
    toggleButton.tick()
    if (panelOpen) panel.tick()

    frame = requestAnimationFrame(loop)
  }
  frame = requestAnimationFrame(loop)

  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frame)
    preview.destroy()
    panel.destroy()
    toggleButton.destroy()
    overlayHost.remove()
    panelHost.remove()
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true })
} else {
  mount()
}
