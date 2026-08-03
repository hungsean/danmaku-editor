/**
 * 跨瀏覽器共用型別與模組契約。
 * 這個檔案不可 import 任何瀏覽器 API 或其他模組，確保可被純邏輯測試引用。
 */

export type DanmakuPosition = "scroll" | "top" | "bottom"
export type DanmakuSize = "small" | "medium" | "large"

export type DanmakuDraft = {
  id: string
  time: number // 秒；允許至少 0.1 秒精度
  text: string
  position: DanmakuPosition
  size: DanmakuSize
  color: string
}

/** UI 提供的顏色選項；value 為實際 CSS 色碼。 */
export const DANMAKU_COLORS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "白", value: "#ffffff" },
  { label: "紅", value: "#ff5555" },
  { label: "黃", value: "#ffd93d" },
  { label: "綠", value: "#6bcb77" },
  { label: "藍", value: "#4d96ff" },
]

export const POSITION_LABELS: Readonly<Record<DanmakuPosition, string>> = {
  scroll: "滑動",
  top: "上方",
  bottom: "下方",
}

export const SIZE_LABELS: Readonly<Record<DanmakuSize, string>> = {
  small: "小",
  medium: "中",
  large: "大",
}

/** 滑動彈幕的顯示總時長（秒）。 */
export const SCROLL_DURATION_SEC = 6
/** 上方／下方固定彈幕的顯示總時長（秒）。 */
export const FIXED_DURATION_SEC = 3

/** 各尺寸對應的字級（px）。 */
export const SIZE_FONT_PX: Readonly<Record<DanmakuSize, number>> = {
  small: 18,
  medium: 26,
  large: 36,
}

// ---------------------------------------------------------------------------
// 時間軸純邏輯契約（extension/shared/timeline.ts 實作）
// ---------------------------------------------------------------------------

/**
 * 一則彈幕在某個影片時間點的可見狀態。
 * progress 為 0..1 的動畫進度：0 代表剛開始顯示，1 代表顯示結束。
 */
export type DanmakuVisibility =
  | { visible: false }
  | { visible: true; progress: number }

// ---------------------------------------------------------------------------
// 播放器契約（extension/content/main.ts 實作並注入）
// ---------------------------------------------------------------------------

/** 工作台用來操作頁面既有 <video> 的最小介面。 */
export type PlayerHandle = {
  /** 目前是否已成功綁定到一個可播放的 video。 */
  isReady(): boolean
  /** 目前播放秒數；未綁定時回傳 null。 */
  getCurrentTime(): number | null
  /** 目前是否正在播放；未綁定時回傳 false。 */
  isPlaying(): boolean
  play(): void
  pause(): void
  /** 播放器視覺區域的尺寸，供預覽層計算用；未綁定時回傳 null。 */
  getViewportSize(): { width: number; height: number } | null
}

// ---------------------------------------------------------------------------
// 草稿儲存契約（extension/content/main.ts 實作，僅存記憶體）
// ---------------------------------------------------------------------------

export type DraftStore = {
  getAll(): ReadonlyArray<DanmakuDraft>
  /** 目前選取中的彈幕 id；沒有選取時為 null。 */
  getSelectedId(): string | null
  select(id: string | null): void
  add(): string
  update(id: string, patch: Partial<Omit<DanmakuDraft, "id">>): void
  remove(id: string): void
  /** 訂閱資料變更；回傳取消訂閱函式。 */
  subscribe(listener: () => void): () => void
}

// ---------------------------------------------------------------------------
// UI 模組契約
// ---------------------------------------------------------------------------

/** editor.ts 匯出的工廠函式簽章。 */
export type EditorDeps = {
  store: DraftStore
  player: PlayerHandle
  /** 讀取目前預覽開關狀態。 */
  isPreviewEnabled(): boolean
  /** 切換預覽開關。 */
  setPreviewEnabled(enabled: boolean): void
}

export type EditorHandle = {
  /** 工作台面板的根節點，由 main.ts 掛進 Shadow DOM。 */
  readonly element: HTMLElement
  /** 每個 animation frame 由 main.ts 呼叫，用於更新播放狀態列。 */
  tick(): void
  destroy(): void
}

/** preview.ts 匯出的工廠函式簽章。 */
export type PreviewDeps = {
  store: DraftStore
  player: PlayerHandle
}

export type PreviewHandle = {
  /** 預覽層根節點，由 main.ts 掛進 Shadow DOM 並定位到播放器上。 */
  readonly element: HTMLElement
  /** 依目前影片時間重繪；enabled 為 false 時必須清空所有彈幕。 */
  render(currentTime: number | null, enabled: boolean): void
  destroy(): void
}
