/**
 * 跨瀏覽器共用型別與模組契約。
 * 這個檔案不可 import 任何瀏覽器 API 或其他模組，確保可被純邏輯測試引用。
 */

/** 彈幕的動畫行為：滑動（橫向移動）、固定於上方、固定於下方。 */
export type DanmakuBehavior = "scroll" | "top" | "bottom"
export type DanmakuSize = "small" | "medium" | "large"

/**
 * 一條可自由增減的時間軸軌道。純粹用來管理／分組彈幕（例如同時間有多則彈幕要分開排列），
 * 不帶任何動畫行為 —— 行為是彈幕自己的屬性（見 DanmakuDraft.behavior）。
 */
export type Track = {
  id: string
  label: string
}

export type DanmakuDraft = {
  id: string
  time: number // 秒；允許至少 0.1 秒精度
  text: string
  /** 所屬軌道 id，對應 TrackStore 中的 Track；純粹決定顯示在時間軸的哪一列。 */
  trackId: string
  /** 動畫行為：決定顯示時長與移動方式。 */
  behavior: DanmakuBehavior
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

export const BEHAVIOR_LABELS: Readonly<Record<DanmakuBehavior, string>> = {
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

/** 初始預設軌道，供第一次載入時建立示範資料使用。 */
export const DEFAULT_TRACKS: ReadonlyArray<Track> = [{ id: "track-1", label: "軌道 1" }]

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
  /** 跳轉到指定秒數；未綁定時為 no-op。 */
  seek(seconds: number): void
  /** 影片總長度（秒）；未知或未綁定時回傳 null。 */
  getDuration(): number | null
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
// 軌道儲存契約（extension/content/main.ts 實作，僅存記憶體）
// ---------------------------------------------------------------------------

export type TrackStore = {
  getAll(): ReadonlyArray<Track>
  getById(id: string): Track | undefined
  /** 新增一條軌道，回傳新軌道 id。 */
  add(): string
  update(id: string, patch: Partial<Omit<Track, "id">>): void
  /**
   * 刪除軌道；至少要保留一條軌道，若只剩最後一條則忽略。
   * 刪除前，所有屬於該軌道的彈幕會被移到刪除後仍存在的第一條軌道。
   */
  remove(id: string): void
  /** 訂閱資料變更；回傳取消訂閱函式。 */
  subscribe(listener: () => void): () => void
}

// ---------------------------------------------------------------------------
// UI 模組契約
// ---------------------------------------------------------------------------

/**
 * 時間軸視窗：以目前播放時間為中心，前後各展開 halfSpanSec 秒。
 * 這是純資料，實際換算由 timeline.ts 的純函式負責。
 */
export type TimelineWindow = {
  start: number
  end: number
}

/** 時間軸可選的縮放級距（半視窗秒數）。數字越小代表放得越大。 */
export const TIMELINE_ZOOM_LEVELS: ReadonlyArray<number> = [5, 10, 15, 30, 60]

/** 預設縮放級距在 TIMELINE_ZOOM_LEVELS 中的索引。 */
export const DEFAULT_ZOOM_INDEX = 2

/** timeline-panel.ts 匯出的工廠函式簽章。 */
export type TimelinePanelDeps = {
  store: DraftStore
  trackStore: TrackStore
  player: PlayerHandle
  /** 讀取目前預覽開關狀態。 */
  isPreviewEnabled(): boolean
  /** 切換預覽開關。 */
  setPreviewEnabled(enabled: boolean): void
}

export type TimelinePanelHandle = {
  /** 面板根節點，由 main.ts 插入到播放器容器下方。 */
  readonly element: HTMLElement
  /** 每個 animation frame 由 main.ts 呼叫：更新播放頭與狀態列。 */
  tick(): void
  destroy(): void
}

/** toggle-button.ts 匯出的工廠函式簽章。 */
export type ToggleButtonDeps = {
  /** 讀取工作台是否展開。 */
  isOpen(): boolean
  /** 切換工作台展開狀態。 */
  toggle(): void
}

export type ToggleButtonHandle = {
  readonly element: HTMLElement
  /** 依目前展開狀態更新外觀。 */
  tick(): void
  destroy(): void
}

/** preview.ts 匯出的工廠函式簽章。 */
export type PreviewDeps = {
  store: DraftStore
  trackStore: TrackStore
  player: PlayerHandle
}

export type PreviewHandle = {
  /** 預覽層根節點，由 main.ts 掛進 Shadow DOM 並定位到播放器上。 */
  readonly element: HTMLElement
  /** 依目前影片時間重繪；enabled 為 false 時必須清空所有彈幕。 */
  render(currentTime: number | null, enabled: boolean): void
  destroy(): void
}
