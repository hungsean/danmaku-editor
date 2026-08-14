/**
 * 動畫瘋彈幕工作台 - 時間軸工作台面板。
 * 插入在播放器正下方，取代舊版側邊清單面板（editor.ts，即將移除）。
 * 整個 UI 在 Shadow DOM 內，樣式以 ?raw 字串注入 <style>，不會外洩到頁面本身。
 */

import type {
  DanmakuBehavior,
  DanmakuSize,
  TimelinePanelDeps,
  TimelinePanelHandle,
  TimelineWindow,
} from "../shared/types.js"
import {
  BEHAVIOR_LABELS,
  DANMAKU_COLORS,
  DEFAULT_ZOOM_INDEX,
  SIZE_LABELS,
  TIMELINE_ZOOM_LEVELS,
} from "../shared/types.js"
import {
  clampTime,
  formatTime,
  getDraftsInWindow,
  getDurationForBehavior,
  getPixelsPerSecond,
  getRulerTicks,
  getSecondsPerPixel,
  getTimelineWindow,
  snapTime,
  timeToX,
  xToTime,
} from "../shared/timeline.js"
import styles from "./styles.css?raw"

const NOT_READY_HINT = "尚未偵測到影片，無法使用時間相關功能"
/** 拖曳彈幕區塊時，超過這個像素距離才視為真正的拖曳（避免單純點擊被誤判成微幅位移）。 */
const DRAG_THRESHOLD_PX = 3

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return hex
  const int = Number.parseInt(match[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

type BlockEntry = {
  el: HTMLDivElement
  textEl: HTMLDivElement
  parent: HTMLDivElement
  lastLeft: number
  lastWidth: number
  lastText: string
  lastColor: string
  lastSelected: boolean
  lastEmpty: boolean
  lastTrackId: string
}

type TickEntry = {
  el: HTMLDivElement
  label: HTMLSpanElement | null
}

export function createTimelinePanel(deps: TimelinePanelDeps): TimelinePanelHandle {
  const { store, trackStore, player, isPreviewEnabled, setPreviewEnabled } = deps

  let zoomIndex = DEFAULT_ZOOM_INDEX
  let lastKnownTime = 0
  /** 使用者在軌道區域滾動滾輪累積的視窗位移（秒）；只移動可視範圍，不影響播放時間點。 */
  let scrollOffsetSec = 0
  let currentWindow: TimelineWindow = getTimelineWindow(0, TIMELINE_ZOOM_LEVELS[zoomIndex])

  let dragging: {
    id: string
    pointerId: number
    startClientX: number
    active: boolean
  } | null = null

  // ---------------------------------------------------------------------
  // Root + style
  // ---------------------------------------------------------------------

  const root = document.createElement("div")
  root.className = "tp-root"

  const styleEl = document.createElement("style")
  styleEl.textContent = styles
  root.appendChild(styleEl)

  // ---------------------------------------------------------------------
  // 工具列
  // ---------------------------------------------------------------------

  const toolbar = document.createElement("div")
  toolbar.className = "tp-toolbar"

  const playPauseBtn = document.createElement("button")
  playPauseBtn.type = "button"
  playPauseBtn.className = "tp-btn"
  playPauseBtn.setAttribute("aria-label", "播放或暫停")
  playPauseBtn.addEventListener("click", () => {
    if (!player.isReady()) return
    if (player.isPlaying()) {
      player.pause()
    } else {
      player.play()
    }
  })

  const timeText = document.createElement("span")
  timeText.className = "tp-time-text"

  const addBtn = document.createElement("button")
  addBtn.type = "button"
  addBtn.className = "tp-btn tp-btn--primary"
  addBtn.textContent = "新增彈幕"
  addBtn.setAttribute("aria-label", "新增彈幕")
  addBtn.addEventListener("click", () => {
    if (!player.isReady()) return
    const current = player.getCurrentTime()
    if (current === null) return
    const id = store.add()
    store.update(id, { time: snapTime(current, player.getDuration()) })
    store.select(id)
    queueMicrotask(() => {
      detailTextInput.focus()
    })
  })

  const previewLabel = document.createElement("label")
  previewLabel.className = "tp-toggle"
  const previewInput = document.createElement("input")
  previewInput.type = "checkbox"
  previewInput.setAttribute("aria-label", "啟用預覽")
  previewInput.checked = isPreviewEnabled()
  previewInput.addEventListener("change", () => {
    setPreviewEnabled(previewInput.checked)
  })
  const previewText = document.createElement("span")
  previewText.textContent = "啟用預覽"
  previewLabel.appendChild(previewInput)
  previewLabel.appendChild(previewText)

  const zoomOutBtn = document.createElement("button")
  zoomOutBtn.type = "button"
  zoomOutBtn.className = "tp-btn"
  zoomOutBtn.textContent = "縮小"
  zoomOutBtn.setAttribute("aria-label", "縮小時間軸")
  zoomOutBtn.addEventListener("click", () => {
    zoomIndex = Math.min(TIMELINE_ZOOM_LEVELS.length - 1, zoomIndex + 1)
    updateZoomUi()
  })

  const zoomInBtn = document.createElement("button")
  zoomInBtn.type = "button"
  zoomInBtn.className = "tp-btn"
  zoomInBtn.textContent = "放大"
  zoomInBtn.setAttribute("aria-label", "放大時間軸")
  zoomInBtn.addEventListener("click", () => {
    zoomIndex = Math.max(0, zoomIndex - 1)
    updateZoomUi()
  })

  const zoomSpanText = document.createElement("span")
  zoomSpanText.className = "tp-zoom-text"

  function updateZoomUi(): void {
    const halfSpan = TIMELINE_ZOOM_LEVELS[zoomIndex]
    zoomSpanText.textContent = `視窗：前後各 ${halfSpan} 秒`
    zoomOutBtn.disabled = zoomIndex >= TIMELINE_ZOOM_LEVELS.length - 1
    zoomInBtn.disabled = zoomIndex <= 0
  }

  const readyHint = document.createElement("span")
  readyHint.className = "tp-ready-hint"
  readyHint.textContent = NOT_READY_HINT
  readyHint.hidden = true

  toolbar.appendChild(playPauseBtn)
  toolbar.appendChild(timeText)
  toolbar.appendChild(addBtn)
  toolbar.appendChild(previewLabel)
  toolbar.appendChild(zoomOutBtn)
  toolbar.appendChild(zoomSpanText)
  toolbar.appendChild(zoomInBtn)
  toolbar.appendChild(readyHint)

  // ---------------------------------------------------------------------
  // 時間軸主體
  // ---------------------------------------------------------------------

  // 整個時間軸主體是單一 CSS Grid：第一欄放軌道控制（名稱／刪除／新增軌道），
  // 第二欄放時間軸內容（刻度尺／各軌道區域）。每一列（新增軌道列、每條軌道）
  // 左右兩欄共用同一組 grid row，天生等高、對齊，不必再靠兩個獨立 flex 欄位湊出一樣的高度。
  const timelineWrap = document.createElement("div")
  timelineWrap.className = "tp-timeline-wrap"

  const rulerSpacer = document.createElement("div")
  rulerSpacer.className = "tp-ruler-spacer"

  const addTrackBtn = document.createElement("button")
  addTrackBtn.type = "button"
  addTrackBtn.className = "tp-btn tp-lane-add-btn"
  addTrackBtn.textContent = "＋"
  addTrackBtn.setAttribute("aria-label", "新增軌道")
  addTrackBtn.title = "新增軌道"
  addTrackBtn.addEventListener("click", () => {
    trackStore.add()
  })
  rulerSpacer.appendChild(addTrackBtn)

  const ruler = document.createElement("div")
  ruler.className = "tp-ruler"
  ruler.setAttribute("role", "presentation")

  // 疊在第二欄、橫跨所有列的覆蓋層：提供播放頭的定位基準，也是座標換算（x <-> time）唯一參照的矩形。
  const trackArea = document.createElement("div")
  trackArea.className = "tp-track-area"

  const playhead = document.createElement("div")
  playhead.className = "tp-playhead"
  trackArea.appendChild(playhead)

  timelineWrap.appendChild(rulerSpacer)
  timelineWrap.appendChild(ruler)
  timelineWrap.appendChild(trackArea)

  // 點擊刻度尺或軌道空白處 -> seek。
  function handleSeekClick(event: MouseEvent): void {
    if (!player.isReady()) return
    const rect = trackArea.getBoundingClientRect()
    if (rect.width <= 0) return
    const x = event.clientX - rect.left
    const time = xToTime(x, currentWindow, rect.width)
    player.seek(Math.max(0, time))
  }
  ruler.addEventListener("click", handleSeekClick)

  // 在刻度尺或軌道區域滾動滾輪 -> 平移時間軸可視範圍（不影響播放頭時間點）。
  function handleTimelineWheel(event: WheelEvent): void {
    const target = event.target
    if (!(target instanceof Element) || !target.closest(".tp-ruler, .tp-lane-track")) return
    const width = trackArea.clientWidth
    if (width <= 0) return
    event.preventDefault()
    const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
    const secondsPerPixel = getSecondsPerPixel(currentWindow, width)
    scrollOffsetSec += delta * secondsPerPixel
  }
  timelineWrap.addEventListener("wheel", handleTimelineWheel, { passive: false })

  // ---------------------------------------------------------------------
  // 軌道列（依 trackStore 動態產生／增減）
  // ---------------------------------------------------------------------

  let laneLabelEls = new Map<string, HTMLDivElement>()
  let laneTrackEls = new Map<string, HTMLDivElement>()

  function rebuildLanes(): void {
    for (const el of laneLabelEls.values()) el.remove()
    for (const el of laneTrackEls.values()) el.remove()
    laneLabelEls = new Map<string, HTMLDivElement>()
    laneTrackEls = new Map<string, HTMLDivElement>()

    const tracks = trackStore.getAll()
    const canRemove = tracks.length > 1

    tracks.forEach((track, index) => {
      // row 1 是刻度尺／新增軌道那一列，軌道列從 row 2 開始。
      const gridRow = String(index + 2)

      const label = document.createElement("div")
      label.className = "tp-lane-label"
      label.style.gridRow = gridRow

      const nameInput = document.createElement("input")
      nameInput.type = "text"
      nameInput.className = "tp-lane-name-input"
      nameInput.value = track.label
      nameInput.setAttribute("aria-label", `軌道名稱：${track.label}`)
      nameInput.addEventListener("change", () => {
        const value = nameInput.value.trim()
        trackStore.update(track.id, { label: value.length > 0 ? value : track.label })
      })

      const removeBtn = document.createElement("button")
      removeBtn.type = "button"
      removeBtn.className = "tp-lane-remove-btn"
      removeBtn.textContent = "×"
      removeBtn.setAttribute("aria-label", `刪除軌道：${track.label}`)
      removeBtn.disabled = !canRemove
      removeBtn.title = canRemove ? "刪除軌道" : "至少要保留一條軌道"
      removeBtn.addEventListener("click", () => {
        trackStore.remove(track.id)
      })

      label.appendChild(nameInput)
      label.appendChild(removeBtn)
      timelineWrap.insertBefore(label, trackArea)
      laneLabelEls.set(track.id, label)

      const laneTrack = document.createElement("div")
      laneTrack.className = "tp-lane-track"
      laneTrack.style.gridRow = gridRow
      laneTrack.dataset.trackId = track.id
      laneTrack.addEventListener("click", handleSeekClick)
      timelineWrap.insertBefore(laneTrack, trackArea)
      laneTrackEls.set(track.id, laneTrack)
    })

    // 軌道被刪除時，重新掛載仍存在的彈幕區塊到新的軌道父層（其餘會在下次 renderBlocks 時被回收）。
    for (const [id, entry] of blockPool) {
      const draft = store.getAll().find((d) => d.id === id)
      if (!draft) continue
      const parent = laneTrackEls.get(draft.trackId)
      if (!parent) continue
      if (entry.parent !== parent) {
        parent.appendChild(entry.el)
        entry.parent = parent
        entry.lastTrackId = draft.trackId
      }
    }

    rebuildTrackSelectOptions()
  }

  // ---------------------------------------------------------------------
  // 詳細編輯列
  // ---------------------------------------------------------------------

  const detailRow = document.createElement("div")
  detailRow.className = "tp-detail"

  const detailEmpty = document.createElement("div")
  detailEmpty.className = "tp-detail-empty"
  detailEmpty.textContent = "點選時間軸上的彈幕區塊以編輯，或按「新增彈幕」建立新的一則。"

  const detailForm = document.createElement("div")
  detailForm.className = "tp-detail-form"

  const detailTextInput = document.createElement("input")
  detailTextInput.type = "text"
  detailTextInput.className = "tp-detail-text"
  detailTextInput.placeholder = "輸入彈幕文字"
  detailTextInput.setAttribute("aria-label", "彈幕文字")

  const detailTrackSelect = document.createElement("select")
  detailTrackSelect.setAttribute("aria-label", "軌道")

  function rebuildTrackSelectOptions(): void {
    const previousValue = detailTrackSelect.value
    detailTrackSelect.replaceChildren()
    for (const track of trackStore.getAll()) {
      const option = document.createElement("option")
      option.value = track.id
      option.textContent = track.label
      detailTrackSelect.appendChild(option)
    }
    if (trackStore.getById(previousValue)) {
      detailTrackSelect.value = previousValue
    }
  }
  rebuildTrackSelectOptions()

  const detailBehaviorSelect = document.createElement("select")
  detailBehaviorSelect.setAttribute("aria-label", "動畫行為")
  for (const [value, label] of Object.entries(BEHAVIOR_LABELS) as Array<[DanmakuBehavior, string]>) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    detailBehaviorSelect.appendChild(option)
  }

  const detailSizeSelect = document.createElement("select")
  detailSizeSelect.setAttribute("aria-label", "大小")
  for (const [value, label] of Object.entries(SIZE_LABELS) as Array<[DanmakuSize, string]>) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    detailSizeSelect.appendChild(option)
  }

  const detailColorSelect = document.createElement("select")
  detailColorSelect.setAttribute("aria-label", "顏色")
  for (const { label, value } of DANMAKU_COLORS) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    detailColorSelect.appendChild(option)
  }

  const detailTimeInput = document.createElement("input")
  detailTimeInput.type = "number"
  detailTimeInput.step = "0.1"
  detailTimeInput.min = "0"
  detailTimeInput.className = "tp-detail-time"
  detailTimeInput.setAttribute("aria-label", "時間（秒）")

  const detailUseCurrentTimeBtn = document.createElement("button")
  detailUseCurrentTimeBtn.type = "button"
  detailUseCurrentTimeBtn.className = "tp-btn"
  detailUseCurrentTimeBtn.textContent = "使用目前時間"
  detailUseCurrentTimeBtn.setAttribute("aria-label", "使用目前時間")

  const detailDeleteBtn = document.createElement("button")
  detailDeleteBtn.type = "button"
  detailDeleteBtn.className = "tp-btn tp-btn--danger"
  detailDeleteBtn.textContent = "刪除"
  detailDeleteBtn.setAttribute("aria-label", "刪除彈幕")

  detailForm.appendChild(detailTextInput)
  detailForm.appendChild(detailTrackSelect)
  detailForm.appendChild(detailBehaviorSelect)
  detailForm.appendChild(detailSizeSelect)
  detailForm.appendChild(detailColorSelect)
  detailForm.appendChild(detailTimeInput)
  detailForm.appendChild(detailUseCurrentTimeBtn)
  detailForm.appendChild(detailDeleteBtn)

  detailRow.appendChild(detailEmpty)
  detailRow.appendChild(detailForm)

  root.appendChild(toolbar)
  root.appendChild(timelineWrap)
  root.appendChild(detailRow)

  // --- 詳細列事件 ---

  function applyCurrentTimeToSelected(id: string): void {
    if (!player.isReady()) return
    const current = player.getCurrentTime()
    if (current === null) return
    store.update(id, { time: snapTime(current, player.getDuration()) })
  }

  function focusNextByTime(afterId: string): void {
    const sorted = [...store.getAll()].sort((a, b) => a.time - b.time)
    const index = sorted.findIndex((d) => d.id === afterId)
    const next = index >= 0 ? sorted[index + 1] : undefined
    if (next) {
      store.select(next.id)
      queueMicrotask(() => {
        detailTextInput.focus()
      })
    }
  }

  detailTextInput.addEventListener("input", () => {
    const id = store.getSelectedId()
    if (!id) return
    store.update(id, { text: detailTextInput.value })
  })
  detailTextInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    const id = store.getSelectedId()
    if (!id) return
    if (!player.isReady()) return
    applyCurrentTimeToSelected(id)
    focusNextByTime(id)
  })

  detailTrackSelect.addEventListener("change", () => {
    const id = store.getSelectedId()
    if (!id) return
    store.update(id, { trackId: detailTrackSelect.value })
  })
  detailBehaviorSelect.addEventListener("change", () => {
    const id = store.getSelectedId()
    if (!id) return
    store.update(id, { behavior: detailBehaviorSelect.value as DanmakuBehavior })
  })
  detailSizeSelect.addEventListener("change", () => {
    const id = store.getSelectedId()
    if (!id) return
    store.update(id, { size: detailSizeSelect.value as DanmakuSize })
  })
  detailColorSelect.addEventListener("change", () => {
    const id = store.getSelectedId()
    if (!id) return
    store.update(id, { color: detailColorSelect.value })
  })
  detailTimeInput.addEventListener("change", () => {
    const id = store.getSelectedId()
    if (!id) return
    const value = Number(detailTimeInput.value)
    store.update(id, { time: clampTime(Number.isFinite(value) ? value : 0) })
  })
  detailUseCurrentTimeBtn.addEventListener("click", () => {
    const id = store.getSelectedId()
    if (!id) return
    applyCurrentTimeToSelected(id)
  })
  detailDeleteBtn.addEventListener("click", () => {
    const id = store.getSelectedId()
    if (!id) return
    store.remove(id)
  })

  const detailLastValues = {
    id: null as string | null,
    text: "",
    trackId: "",
    behavior: "scroll" as DanmakuBehavior,
    size: "medium" as DanmakuSize,
    color: "",
    time: Number.NaN,
  }

  function renderDetail(): void {
    const selectedId = store.getSelectedId()
    const draft = selectedId ? store.getAll().find((d) => d.id === selectedId) ?? null : null

    if (!draft) {
      detailEmpty.hidden = false
      detailForm.hidden = true
      detailLastValues.id = null
      return
    }

    detailEmpty.hidden = true
    detailForm.hidden = false

    const isSameDraft = detailLastValues.id === draft.id
    detailLastValues.id = draft.id

    if ((!isSameDraft || detailLastValues.text !== draft.text) && document.activeElement !== detailTextInput) {
      detailTextInput.value = draft.text
    }
    detailLastValues.text = draft.text

    if (!isSameDraft || detailLastValues.trackId !== draft.trackId) {
      detailTrackSelect.value = draft.trackId
      detailLastValues.trackId = draft.trackId
    }
    if (!isSameDraft || detailLastValues.behavior !== draft.behavior) {
      detailBehaviorSelect.value = draft.behavior
      detailLastValues.behavior = draft.behavior
    }
    if (!isSameDraft || detailLastValues.size !== draft.size) {
      detailSizeSelect.value = draft.size
      detailLastValues.size = draft.size
    }
    if (!isSameDraft || detailLastValues.color !== draft.color) {
      detailColorSelect.value = draft.color
      detailLastValues.color = draft.color
    }
    if ((!isSameDraft || detailLastValues.time !== draft.time) && document.activeElement !== detailTimeInput) {
      detailTimeInput.value = String(draft.time)
    }
    detailLastValues.time = draft.time
  }

  function updateDetailReadyState(): void {
    const ready = player.isReady()
    detailUseCurrentTimeBtn.disabled = !ready
    detailUseCurrentTimeBtn.title = ready ? "" : NOT_READY_HINT
  }

  const unsubscribe = store.subscribe(renderDetail)
  renderDetail()
  updateDetailReadyState()

  // ---------------------------------------------------------------------
  // 彈幕區塊元素池
  // ---------------------------------------------------------------------

  const blockPool = new Map<string, BlockEntry>()

  rebuildLanes()
  const unsubscribeTracks = trackStore.subscribe(rebuildLanes)

  function createBlock(id: string, trackId: string): BlockEntry {
    const parent = laneTrackEls.get(trackId) as HTMLDivElement
    const el = document.createElement("div")
    el.className = "tp-block"
    el.dataset.id = id

    const textEl = document.createElement("div")
    textEl.className = "tp-block-text"
    el.appendChild(textEl)

    el.addEventListener("click", (event) => {
      event.stopPropagation()
    })

    el.addEventListener("pointerdown", (event) => {
      event.stopPropagation()
      store.select(id)
      el.setPointerCapture(event.pointerId)
      dragging = { id, pointerId: event.pointerId, startClientX: event.clientX, active: false }
    })

    el.addEventListener("pointermove", (event) => {
      if (!dragging || dragging.id !== id || dragging.pointerId !== event.pointerId) return
      const dx = event.clientX - dragging.startClientX
      if (!dragging.active && Math.abs(dx) < DRAG_THRESHOLD_PX) return
      dragging.active = true

      const rect = trackArea.getBoundingClientRect()
      if (rect.width <= 0) return
      const x = event.clientX - rect.left
      const rawTime = xToTime(x, currentWindow, rect.width)
      const snapped = snapTime(rawTime, player.getDuration())
      store.update(id, { time: snapped })
    })

    const endDrag = (event: PointerEvent): void => {
      if (!dragging || dragging.id !== id || dragging.pointerId !== event.pointerId) return
      dragging = null
      if (el.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId)
      }
    }
    el.addEventListener("pointerup", endDrag)
    el.addEventListener("pointercancel", endDrag)

    parent.appendChild(el)

    return {
      el,
      textEl,
      parent,
      lastLeft: Number.NaN,
      lastWidth: Number.NaN,
      lastText: "",
      lastColor: "",
      lastSelected: false,
      lastEmpty: false,
      lastTrackId: trackId,
    }
  }

  function renderBlocks(width: number): void {
    const drafts = getDraftsInWindow(store.getAll(), currentWindow)
    const selectedId = store.getSelectedId()
    const pixelsPerSecond = getPixelsPerSecond(currentWindow, width)
    const seen = new Set<string>()

    for (const draft of drafts) {
      seen.add(draft.id)
      let entry = blockPool.get(draft.id)
      if (!entry) {
        entry = createBlock(draft.id, draft.trackId)
        blockPool.set(draft.id, entry)
      }

      if (entry.lastTrackId !== draft.trackId) {
        const newParent = laneTrackEls.get(draft.trackId)
        if (newParent) {
          newParent.appendChild(entry.el)
          entry.parent = newParent
        }
        entry.lastTrackId = draft.trackId
      }

      const left = timeToX(draft.time, currentWindow, width)
      const blockWidth = getDurationForBehavior(draft.behavior) * pixelsPerSecond
      if (entry.lastLeft !== left) {
        entry.el.style.left = `${left}px`
        entry.lastLeft = left
      }
      if (entry.lastWidth !== blockWidth) {
        entry.el.style.width = `${Math.max(0, blockWidth)}px`
        entry.lastWidth = blockWidth
      }

      const isEmpty = draft.text.trim().length === 0
      if (entry.lastText !== draft.text || entry.lastEmpty !== isEmpty) {
        entry.textEl.textContent = isEmpty ? "（空白彈幕）" : draft.text
        entry.el.classList.toggle("tp-block--empty", isEmpty)
        entry.lastText = draft.text
        entry.lastEmpty = isEmpty
      }

      if (entry.lastColor !== draft.color) {
        entry.el.style.backgroundColor = hexToRgba(draft.color, 0.28)
        entry.el.style.borderLeftColor = draft.color
        entry.lastColor = draft.color
      }

      const isSelected = draft.id === selectedId
      if (entry.lastSelected !== isSelected) {
        entry.el.classList.toggle("tp-block--selected", isSelected)
        entry.lastSelected = isSelected
      }
    }

    for (const [id, entry] of blockPool) {
      if (!seen.has(id)) {
        entry.el.remove()
        blockPool.delete(id)
      }
    }
  }

  // ---------------------------------------------------------------------
  // 刻度尺元素池
  // ---------------------------------------------------------------------

  const tickPool: TickEntry[] = []

  function renderTicks(width: number): void {
    const ticks = getRulerTicks(currentWindow, width)

    for (let i = 0; i < ticks.length; i++) {
      const tick = ticks[i]
      let entry = tickPool[i]
      if (!entry) {
        const el = document.createElement("div")
        el.className = "tp-tick"
        ruler.appendChild(el)
        entry = { el, label: null }
        tickPool.push(entry)
      }

      entry.el.hidden = false
      entry.el.style.left = `${tick.x}px`
      entry.el.classList.toggle("tp-tick--major", tick.major)

      if (tick.major) {
        if (!entry.label) {
          const label = document.createElement("span")
          label.className = "tp-tick-label"
          entry.el.appendChild(label)
          entry.label = label
        }
        // 同樣避免每幀重建 text node（理由見 tick() 的註解）。
        const labelText = formatTime(tick.time)
        if (entry.label.textContent !== labelText) {
          entry.label.textContent = labelText
        }
      } else if (entry.label) {
        entry.label.remove()
        entry.label = null
      }
    }

    for (let i = ticks.length; i < tickPool.length; i++) {
      tickPool[i].el.hidden = true
    }
  }

  // ---------------------------------------------------------------------
  // tick()：每個 animation frame 呼叫，只更新跟時間有關的內容。
  // ---------------------------------------------------------------------

  updateZoomUi()

  // tick() 每幀都跑，因此所有寫入都必須先比對舊值。
  // 尤其是 textContent：即使賦同一個字串，瀏覽器也會銷毀舊 text node 再建新的。
  // Chrome 判定 click 是取 mousedown 與 mouseup 命中節點的共同祖先，
  // 點在按鈕文字上時命中的正是那個 text node；一次正常點擊橫跨數幀，
  // 放開時當初按下的 text node 已被換掉且脫離 DOM，click 事件因此不會發送——
  // 症狀就是「點按鈕文字沒反應，點邊緣 padding 才有反應」。
  let lastPlaying: boolean | null = null
  let lastReady: boolean | null = null
  let lastTimeLabel = ""
  let lastPlayheadX = Number.NaN

  function tick(): void {
    const ready = player.isReady()
    const currentTime = player.getCurrentTime()
    const playing = player.isPlaying()

    if (currentTime !== null) {
      lastKnownTime = currentTime
    }

    if (lastPlaying !== playing) {
      playPauseBtn.textContent = playing ? "暫停" : "播放"
      playPauseBtn.setAttribute("aria-label", playing ? "暫停播放" : "開始播放")
      lastPlaying = playing
    }

    if (lastReady !== ready) {
      playPauseBtn.disabled = !ready
      playPauseBtn.title = ready ? "" : NOT_READY_HINT
      addBtn.disabled = !ready
      addBtn.title = ready ? "" : NOT_READY_HINT
      readyHint.hidden = ready
      lastReady = ready
    }

    const timeLabel = currentTime === null ? "--:--.-" : formatTime(currentTime)
    if (lastTimeLabel !== timeLabel) {
      timeText.textContent = timeLabel
      lastTimeLabel = timeLabel
    }

    updateDetailReadyState()

    const baseWindow = getTimelineWindow(lastKnownTime, TIMELINE_ZOOM_LEVELS[zoomIndex])
    currentWindow = {
      start: baseWindow.start + scrollOffsetSec,
      end: baseWindow.end + scrollOffsetSec,
    }

    const width = trackArea.clientWidth
    if (width > 0) {
      renderTicks(width)
      renderBlocks(width)
      const playheadX = timeToX(lastKnownTime, currentWindow, width)
      if (lastPlayheadX !== playheadX) {
        playhead.style.left = `${playheadX}px`
        lastPlayheadX = playheadX
      }
    }
  }

  tick()

  function destroy(): void {
    unsubscribe()
    unsubscribeTracks()
    root.remove()
  }

  return { element: root, tick, destroy }
}
