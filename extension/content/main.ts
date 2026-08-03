/**
 * content script 進入點。
 * 職責：尋找並綁定頁面既有的 <video>、建立 Shadow DOM 容器、
 * 提供記憶體草稿儲存，並以 animation frame 驅動編輯器與預覽層。
 *
 * 這裡不使用任何 Safari-only 或 Chrome-only 的 extension API，
 * 未來遷移 Chromium 時本檔案可原封不動沿用。
 */

import type { DanmakuDraft, DraftStore, PlayerHandle } from "../shared/types.js"
import { clampTime } from "../shared/timeline.js"
import { createEditor } from "./editor.js"
import { createPreview } from "./preview.js"

const HOST_ID = "bahamut-danmaku-workbench-host"

// ---------------------------------------------------------------------------
// 播放器綁定：動畫瘋是 SPA，切換集數後 <video> 可能被重建，需要持續重新綁定。
// ---------------------------------------------------------------------------

function isUsableVideo(el: HTMLVideoElement): boolean {
  // readyState 至少要有 metadata，才代表這是真的可播放的影片而非佔位元素。
  return el.isConnected && el.readyState >= HTMLMediaElement.HAVE_METADATA
}

function findVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll("video"))
  // 優先取可播放且面積最大的，避免抓到廣告或縮圖用的隱藏 video。
  let best: HTMLVideoElement | null = null
  let bestArea = 0
  for (const video of videos) {
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

/** main.ts 內部使用的擴充介面；工作台模組只看得到標準的 PlayerHandle。 */
type InternalPlayer = PlayerHandle & {
  /** 重新確認綁定的 video 是否仍有效，必要時重新尋找。 */
  refresh(): void
  /** 影片在視窗中的位置與尺寸，供預覽層對齊；未綁定時為 null。 */
  getRect(): DOMRect | null
}

function createPlayerHandle(): InternalPlayer {
  let video: HTMLVideoElement | null = null

  const refresh = (): void => {
    if (video && isUsableVideo(video)) return
    video = findVideo()
  }

  return {
    refresh,
    isReady: () => video !== null && isUsableVideo(video),
    getCurrentTime: () => (video && isUsableVideo(video) ? video.currentTime : null),
    isPlaying: () => (video ? !video.paused && !video.ended : false),
    play: () => {
      // 使用者可能在影片尚未就緒時按下，play() 回傳的 promise 失敗不應拋出未捕捉錯誤。
      void video?.play().catch(() => undefined)
    },
    pause: () => video?.pause(),
    getViewportSize: () => {
      if (!video || !isUsableVideo(video)) return null
      const rect = video.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      return { width: rect.width, height: rect.height }
    },
    getRect: () => (video && isUsableVideo(video) ? video.getBoundingClientRect() : null),
  }
}

// ---------------------------------------------------------------------------
// 草稿儲存：僅存記憶體，重新整理即遺失（此版刻意不做持久化）。
// ---------------------------------------------------------------------------

function createId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** 初次載入的示範彈幕，讓使用者立刻看得到預覽效果；全部可刪除。 */
function createDemoDrafts(): DanmakuDraft[] {
  return [
    { id: createId(), time: 2, text: "示範彈幕：滑動", position: "scroll", size: "medium", color: "#ffffff" },
    { id: createId(), time: 4, text: "示範彈幕：上方", position: "top", size: "large", color: "#ffd93d" },
    { id: createId(), time: 6, text: "示範彈幕：下方", position: "bottom", size: "medium", color: "#4d96ff" },
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
  if (document.getElementById(HOST_ID)) return

  const host = document.createElement("div")
  host.id = HOST_ID
  // host 本身不吃事件，只有工作台面板會自行開啟 pointer-events。
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;pointer-events:none;"
  const shadow = host.attachShadow({ mode: "open" })
  document.documentElement.appendChild(host)

  const player = createPlayerHandle()
  const store = createStore()

  let previewEnabled = true

  const preview = createPreview({ store, player })
  const editor = createEditor({
    store,
    player,
    isPreviewEnabled: () => previewEnabled,
    setPreviewEnabled: (enabled) => {
      previewEnabled = enabled
    },
  })

  // 預覽層要精準覆蓋在影片視覺區域上，因此獨立包一層 fixed 容器逐幀對齊。
  const previewWrapper = document.createElement("div")
  previewWrapper.style.cssText = "position:fixed;pointer-events:none;display:none;"
  previewWrapper.appendChild(preview.element)

  shadow.appendChild(previewWrapper)
  shadow.appendChild(editor.element)

  let frame = 0
  const loop = (): void => {
    player.refresh()

    const rect = player.getRect()
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
    editor.tick()

    frame = requestAnimationFrame(loop)
  }
  frame = requestAnimationFrame(loop)

  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frame)
    preview.destroy()
    editor.destroy()
    host.remove()
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true })
} else {
  mount()
}
