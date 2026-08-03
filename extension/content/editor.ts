/**
 * 動畫瘋彈幕工作台 - 編輯面板。
 * 可收合的固定側邊面板，讓使用者手動製作彈幕草稿並在本機預覽（不發送任何網路請求）。
 */

import type { DanmakuDraft, DanmakuPosition, DanmakuSize, EditorDeps, EditorHandle } from "../shared/types.js"
import { DANMAKU_COLORS, POSITION_LABELS, SIZE_LABELS } from "../shared/types.js"
import { clampTime, formatTime } from "../shared/timeline.js"
import styles from "./styles.css?raw"

const NOT_READY_HINT = "尚未偵測到影片，無法取得目前時間"

type Row = {
  root: HTMLDivElement
  timeInput: HTMLInputElement
  textInput: HTMLInputElement
  positionSelect: HTMLSelectElement
  sizeSelect: HTMLSelectElement
  colorSelect: HTMLSelectElement
  useCurrentTimeBtn: HTMLButtonElement
  deleteBtn: HTMLButtonElement
  lastValues: {
    time: number
    text: string
    position: DanmakuPosition
    size: DanmakuSize
    color: string
  }
}

export function createEditor(deps: EditorDeps): EditorHandle {
  const { store, player, isPreviewEnabled, setPreviewEnabled } = deps

  const rowPool = new Map<string, Row>()
  let collapsed = false

  // ---------------------------------------------------------------------
  // Root + style
  // ---------------------------------------------------------------------

  const root = document.createElement("div")
  root.className = "dwb-root"

  const styleEl = document.createElement("style")
  styleEl.textContent = styles
  root.appendChild(styleEl)

  // ---------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------

  const header = document.createElement("div")
  header.className = "dwb-header"

  const title = document.createElement("span")
  title.className = "dwb-title"
  title.textContent = "動畫瘋彈幕工作台"

  const collapseBtn = document.createElement("button")
  collapseBtn.type = "button"
  collapseBtn.className = "dwb-collapse-btn"
  collapseBtn.setAttribute("aria-expanded", "true")

  header.appendChild(title)
  header.appendChild(collapseBtn)

  // ---------------------------------------------------------------------
  // Body
  // ---------------------------------------------------------------------

  const body = document.createElement("div")
  body.className = "dwb-body"

  const notice = document.createElement("p")
  notice.className = "dwb-notice"
  notice.textContent = "草稿僅暫存在目前頁面，重新整理後會消失；此版本不會發送彈幕。"

  // --- Status row ---

  const statusBox = document.createElement("div")
  statusBox.className = "dwb-status"

  const foundLine = document.createElement("div")
  foundLine.className = "dwb-status-line"
  const foundLabel = document.createElement("span")
  foundLabel.className = "dwb-status-label"
  foundLabel.textContent = "影片狀態"
  const foundValue = document.createElement("span")
  foundValue.className = "dwb-status-value"
  foundLine.appendChild(foundLabel)
  foundLine.appendChild(foundValue)

  const timeLine = document.createElement("div")
  timeLine.className = "dwb-status-line"
  const timeLabel = document.createElement("span")
  timeLabel.className = "dwb-status-label"
  timeLabel.textContent = "目前時間"
  const timeValue = document.createElement("span")
  timeValue.className = "dwb-status-value"
  timeLine.appendChild(timeLabel)
  timeLine.appendChild(timeValue)

  const playLine = document.createElement("div")
  playLine.className = "dwb-status-line"
  const playPauseBtn = document.createElement("button")
  playPauseBtn.type = "button"
  playPauseBtn.className = "dwb-play-pause-btn"
  playPauseBtn.style.width = "100%"
  playLine.appendChild(playPauseBtn)

  statusBox.appendChild(foundLine)
  statusBox.appendChild(timeLine)
  statusBox.appendChild(playLine)

  playPauseBtn.addEventListener("click", () => {
    if (!player.isReady()) return
    if (player.isPlaying()) {
      player.pause()
    } else {
      player.play()
    }
  })

  // --- Preview toggle ---

  const toggleRow = document.createElement("div")
  toggleRow.className = "dwb-toggle-row"
  const toggleLabel = document.createElement("label")
  const toggleInput = document.createElement("input")
  toggleInput.type = "checkbox"
  toggleInput.setAttribute("aria-label", "啟用預覽")
  toggleInput.checked = isPreviewEnabled()
  const toggleText = document.createElement("span")
  toggleText.textContent = "啟用預覽"
  toggleLabel.appendChild(toggleInput)
  toggleLabel.appendChild(toggleText)
  toggleRow.appendChild(toggleLabel)

  toggleInput.addEventListener("change", () => {
    setPreviewEnabled(toggleInput.checked)
  })

  // --- Add button ---

  const addBtn = document.createElement("button")
  addBtn.type = "button"
  addBtn.className = "dwb-add-btn dwb-btn--primary"
  addBtn.textContent = "新增彈幕"
  addBtn.addEventListener("click", () => {
    const id = store.add()
    store.select(id)
  })

  // --- List / empty state ---

  const listEl = document.createElement("div")
  listEl.className = "dwb-list"

  const emptyEl = document.createElement("div")
  emptyEl.className = "dwb-empty"
  emptyEl.textContent = "尚未有任何彈幕，點選上方「新增彈幕」開始製作。"

  body.appendChild(notice)
  body.appendChild(statusBox)
  body.appendChild(toggleRow)
  body.appendChild(addBtn)
  body.appendChild(emptyEl)
  body.appendChild(listEl)

  root.appendChild(header)
  root.appendChild(body)

  // ---------------------------------------------------------------------
  // Collapse behaviour
  // ---------------------------------------------------------------------

  function updateCollapseUi(): void {
    root.classList.toggle("dwb-root--collapsed", collapsed)
    collapseBtn.setAttribute("aria-expanded", String(!collapsed))
    collapseBtn.setAttribute("aria-label", collapsed ? "展開面板" : "收合面板")
    collapseBtn.textContent = collapsed ? "展開" : "收合"
  }

  collapseBtn.addEventListener("click", () => {
    collapsed = !collapsed
    updateCollapseUi()
  })

  updateCollapseUi()

  // ---------------------------------------------------------------------
  // Row helpers
  // ---------------------------------------------------------------------

  function useCurrentTime(id: string): void {
    if (!player.isReady()) return
    const current = player.getCurrentTime()
    if (current === null) return
    store.update(id, { time: clampTime(current) })
  }

  function focusNextRowText(afterId: string): void {
    const drafts = store.getAll()
    const index = drafts.findIndex((d) => d.id === afterId)
    const next = index >= 0 ? drafts[index + 1] : undefined
    if (next) {
      store.select(next.id)
      queueMicrotask(() => {
        rowPool.get(next.id)?.textInput.focus()
      })
    } else {
      store.select(afterId)
    }
  }

  function createRow(id: string): Row {
    const rowRoot = document.createElement("div")
    rowRoot.className = "dwb-row"
    rowRoot.dataset.id = id

    rowRoot.addEventListener("focusin", () => {
      store.select(id)
    })
    rowRoot.addEventListener("click", (event) => {
      if (event.target === rowRoot) {
        store.select(id)
      }
    })

    // --- line 1: time + use-current-time + delete ---
    const line1 = document.createElement("div")
    line1.className = "dwb-row-line"

    const timeInput = document.createElement("input")
    timeInput.type = "number"
    timeInput.step = "0.1"
    timeInput.min = "0"
    timeInput.className = "dwb-row-time"
    timeInput.setAttribute("aria-label", "時間（秒）")
    timeInput.addEventListener("change", () => {
      const value = Number(timeInput.value)
      store.update(id, { time: clampTime(Number.isFinite(value) ? value : 0) })
    })

    const useCurrentTimeBtn = document.createElement("button")
    useCurrentTimeBtn.type = "button"
    useCurrentTimeBtn.textContent = "使用目前時間"
    useCurrentTimeBtn.addEventListener("click", () => {
      useCurrentTime(id)
    })

    const deleteBtn = document.createElement("button")
    deleteBtn.type = "button"
    deleteBtn.className = "dwb-btn--danger"
    deleteBtn.textContent = "刪除"
    deleteBtn.setAttribute("aria-label", "刪除彈幕")
    deleteBtn.addEventListener("click", () => {
      store.remove(id)
    })

    line1.appendChild(timeInput)
    line1.appendChild(useCurrentTimeBtn)
    line1.appendChild(deleteBtn)

    // --- line 2: text ---
    const line2 = document.createElement("div")
    line2.className = "dwb-row-line"

    const textInput = document.createElement("input")
    textInput.type = "text"
    textInput.className = "dwb-row-text"
    textInput.setAttribute("aria-label", "彈幕文字")
    textInput.placeholder = "輸入彈幕文字"
    textInput.addEventListener("input", () => {
      store.update(id, { text: textInput.value })
    })
    textInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      useCurrentTime(id)
      focusNextRowText(id)
    })

    line2.appendChild(textInput)

    // --- line 3: position / size / color ---
    const line3 = document.createElement("div")
    line3.className = "dwb-row-line"

    const positionSelect = document.createElement("select")
    positionSelect.className = "dwb-row-select"
    positionSelect.setAttribute("aria-label", "位置")
    for (const [value, label] of Object.entries(POSITION_LABELS) as Array<[DanmakuPosition, string]>) {
      const option = document.createElement("option")
      option.value = value
      option.textContent = label
      positionSelect.appendChild(option)
    }
    positionSelect.addEventListener("change", () => {
      store.update(id, { position: positionSelect.value as DanmakuPosition })
    })

    const sizeSelect = document.createElement("select")
    sizeSelect.className = "dwb-row-select"
    sizeSelect.setAttribute("aria-label", "大小")
    for (const [value, label] of Object.entries(SIZE_LABELS) as Array<[DanmakuSize, string]>) {
      const option = document.createElement("option")
      option.value = value
      option.textContent = label
      sizeSelect.appendChild(option)
    }
    sizeSelect.addEventListener("change", () => {
      store.update(id, { size: sizeSelect.value as DanmakuSize })
    })

    const colorSelect = document.createElement("select")
    colorSelect.className = "dwb-row-select"
    colorSelect.setAttribute("aria-label", "顏色")
    for (const { label, value } of DANMAKU_COLORS) {
      const option = document.createElement("option")
      option.value = value
      option.textContent = label
      colorSelect.appendChild(option)
    }
    colorSelect.addEventListener("change", () => {
      store.update(id, { color: colorSelect.value })
    })

    line3.appendChild(positionSelect)
    line3.appendChild(sizeSelect)
    line3.appendChild(colorSelect)

    rowRoot.appendChild(line1)
    rowRoot.appendChild(line2)
    rowRoot.appendChild(line3)

    return {
      root: rowRoot,
      timeInput,
      textInput,
      positionSelect,
      sizeSelect,
      colorSelect,
      useCurrentTimeBtn,
      deleteBtn,
      lastValues: { time: NaN, text: "", position: "scroll", size: "medium", color: "" },
    }
  }

  function updateRow(row: Row, draft: DanmakuDraft, selected: boolean): void {
    // 只在值真的改變時才寫入 DOM，避免打斷使用者輸入中的游標位置。
    if (row.lastValues.time !== draft.time && document.activeElement !== row.timeInput) {
      row.timeInput.value = String(draft.time)
    }
    row.lastValues.time = draft.time

    if (row.lastValues.text !== draft.text && document.activeElement !== row.textInput) {
      row.textInput.value = draft.text
    }
    row.lastValues.text = draft.text

    if (row.lastValues.position !== draft.position) {
      row.positionSelect.value = draft.position
      row.lastValues.position = draft.position
    }

    if (row.lastValues.size !== draft.size) {
      row.sizeSelect.value = draft.size
      row.lastValues.size = draft.size
    }

    if (row.lastValues.color !== draft.color) {
      row.colorSelect.value = draft.color
      row.lastValues.color = draft.color
    }

    row.root.classList.toggle("dwb-row--selected", selected)
    row.root.setAttribute("aria-selected", String(selected))
  }

  function renderList(): void {
    const drafts = store.getAll()
    const selectedId = store.getSelectedId()

    if (drafts.length === 0) {
      for (const row of rowPool.values()) {
        row.root.remove()
      }
      rowPool.clear()
      emptyEl.hidden = false
      listEl.hidden = true
      return
    }

    emptyEl.hidden = true
    listEl.hidden = false

    const seen = new Set<string>()
    for (const draft of drafts) {
      seen.add(draft.id)
      let row = rowPool.get(draft.id)
      if (!row) {
        row = createRow(draft.id)
        rowPool.set(draft.id, row)
      }
      updateRow(row, draft, draft.id === selectedId)
      // 移動到正確順序；若元素已在該位置，appendChild 不會造成 focus 遺失。
      listEl.appendChild(row.root)
    }

    for (const [id, row] of rowPool) {
      if (!seen.has(id)) {
        row.root.remove()
        rowPool.delete(id)
      }
    }

    updateRowsReadyState()
  }

  function updateRowsReadyState(): void {
    const ready = player.isReady()
    for (const row of rowPool.values()) {
      row.useCurrentTimeBtn.disabled = !ready
      row.useCurrentTimeBtn.title = ready ? "" : NOT_READY_HINT
    }
  }

  const unsubscribe = store.subscribe(renderList)
  renderList()

  // ---------------------------------------------------------------------
  // tick(): 只更新播放狀態列與各列的 disabled 狀態，不重建整個清單。
  // ---------------------------------------------------------------------

  function tick(): void {
    const ready = player.isReady()
    const currentTime = player.getCurrentTime()
    const playing = player.isPlaying()

    foundValue.textContent = ready ? "已找到影片" : "尚未找到影片"
    timeValue.textContent = currentTime === null ? "--:--.-" : formatTime(currentTime)

    playPauseBtn.disabled = !ready
    playPauseBtn.textContent = playing ? "暫停" : "播放"
    playPauseBtn.setAttribute("aria-label", playing ? "暫停播放" : "開始播放")
    playPauseBtn.title = ready ? "" : NOT_READY_HINT

    updateRowsReadyState()
  }

  tick()

  function destroy(): void {
    unsubscribe()
    root.remove()
  }

  return { element: root, tick, destroy }
}
