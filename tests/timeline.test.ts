import { describe, expect, it } from "vitest"
import {
  clampTime,
  formatTime,
  getDurationForPosition,
  getScrollX,
  getVisibility,
  getVisibleDanmaku,
} from "../extension/shared/timeline.js"
import type { DanmakuDraft, DanmakuPosition } from "../extension/shared/types.js"
import { FIXED_DURATION_SEC, SCROLL_DURATION_SEC } from "../extension/shared/types.js"

function makeDraft(overrides: Partial<DanmakuDraft> = {}): DanmakuDraft {
  return {
    id: "d1",
    time: 10,
    text: "測試彈幕",
    position: "scroll",
    size: "medium",
    color: "#ffffff",
    ...overrides,
  }
}

describe("getDurationForPosition", () => {
  it("scroll 使用 SCROLL_DURATION_SEC", () => {
    expect(getDurationForPosition("scroll")).toBe(SCROLL_DURATION_SEC)
  })

  it("top 使用 FIXED_DURATION_SEC", () => {
    expect(getDurationForPosition("top")).toBe(FIXED_DURATION_SEC)
  })

  it("bottom 使用 FIXED_DURATION_SEC", () => {
    expect(getDurationForPosition("bottom")).toBe(FIXED_DURATION_SEC)
  })
})

describe("getVisibility", () => {
  describe.each<DanmakuPosition>(["scroll", "top", "bottom"])("position=%s", (position) => {
    const duration = getDurationForPosition(position)
    const draft = makeDraft({ time: 10, position })

    it("currentTime 早於 draft.time 時不可見", () => {
      expect(getVisibility(draft, 9.9)).toEqual({ visible: false })
      expect(getVisibility(draft, 0)).toEqual({ visible: false })
    })

    it("剛好等於 draft.time 時可見且 progress 為 0", () => {
      const visibility = getVisibility(draft, 10)
      expect(visibility.visible).toBe(true)
      if (visibility.visible) {
        expect(visibility.progress).toBe(0)
      }
    })

    it("顯示區間中點時 progress 為 0.5", () => {
      const visibility = getVisibility(draft, 10 + duration / 2)
      expect(visibility.visible).toBe(true)
      if (visibility.visible) {
        expect(visibility.progress).toBeCloseTo(0.5, 10)
      }
    })

    it("剛好等於結束時間時不可見（半開區間）", () => {
      expect(getVisibility(draft, 10 + duration)).toEqual({ visible: false })
    })

    it("接近但未達結束時間時仍可見，progress 接近 1", () => {
      const visibility = getVisibility(draft, 10 + duration - 0.01)
      expect(visibility.visible).toBe(true)
      if (visibility.visible) {
        expect(visibility.progress).toBeGreaterThan(0.99)
        expect(visibility.progress).toBeLessThan(1)
      }
    })

    it("遠早於顯示時間時不可見", () => {
      expect(getVisibility(draft, -100)).toEqual({ visible: false })
    })

    it("遠晚於顯示區間時不可見", () => {
      expect(getVisibility(draft, 10 + duration + 100)).toEqual({ visible: false })
    })
  })

  it("scroll 與 fixed 的顯示時長確實不同", () => {
    const scrollDraft = makeDraft({ time: 0, position: "scroll" })
    const topDraft = makeDraft({ time: 0, position: "top" })

    // 在 FIXED_DURATION_SEC 之後、SCROLL_DURATION_SEC 之前，scroll 仍可見但 top 已不可見
    const t = (FIXED_DURATION_SEC + SCROLL_DURATION_SEC) / 2
    expect(getVisibility(scrollDraft, t).visible).toBe(true)
    expect(getVisibility(topDraft, t).visible).toBe(false)
  })
})

describe("getVisibleDanmaku", () => {
  it("空陣列輸入回傳空陣列", () => {
    expect(getVisibleDanmaku([], 5)).toEqual([])
  })

  it("只回傳目前可見的彈幕，並附上 progress", () => {
    const drafts: DanmakuDraft[] = [
      makeDraft({ id: "a", time: 0, position: "scroll" }), // 顯示 [0,6)
      makeDraft({ id: "b", time: 5, position: "top" }), // 顯示 [5,8)
      makeDraft({ id: "c", time: 20, position: "bottom" }), // 顯示 [20,23)
    ]

    const result = getVisibleDanmaku(drafts, 5.5)
    const ids = result.map((r) => r.draft.id).sort()
    expect(ids).toEqual(["a", "b"])

    const a = result.find((r) => r.draft.id === "a")!
    const b = result.find((r) => r.draft.id === "b")!
    expect(a.progress).toBeCloseTo(5.5 / 6, 10)
    expect(b.progress).toBeCloseTo(0.5 / 3, 10)
  })

  it("沒有任何彈幕可見時回傳空陣列", () => {
    const drafts: DanmakuDraft[] = [
      makeDraft({ id: "a", time: 100, position: "scroll" }),
    ]
    expect(getVisibleDanmaku(drafts, 5)).toEqual([])
  })

  it("維持輸入順序（僅過濾，不重新排序）", () => {
    const drafts: DanmakuDraft[] = [
      makeDraft({ id: "x", time: 0, position: "top" }),
      makeDraft({ id: "y", time: 0, position: "top" }),
      makeDraft({ id: "z", time: 0, position: "top" }),
    ]
    const result = getVisibleDanmaku(drafts, 1)
    expect(result.map((r) => r.draft.id)).toEqual(["x", "y", "z"])
  })
})

describe("getScrollX", () => {
  it("progress 0 時文字左緣位於播放器右緣", () => {
    expect(getScrollX(0, 1000, 200)).toBe(1000)
  })

  it("progress 1 時文字完全移出左側", () => {
    expect(getScrollX(1, 1000, 200)).toBe(-200)
  })

  it("progress 0.5 時位於中點（線性內插）", () => {
    expect(getScrollX(0.5, 1000, 200)).toBe((1000 + -200) / 2)
  })

  it("progress 0.25 時正確線性內插", () => {
    // start=1000, end=-200, range=-1200
    expect(getScrollX(0.25, 1000, 200)).toBeCloseTo(1000 - 1200 * 0.25, 10)
  })

  it("textWidth 為 0 時 progress 1 落在 0", () => {
    expect(getScrollX(1, 800, 0)).toBe(0)
  })

  it("viewportWidth 為 0 時 progress 0 落在 0", () => {
    expect(getScrollX(0, 0, 200)).toBe(0)
  })
})

describe("formatTime", () => {
  it("基本轉換：83.45 秒 -> 01:23.4", () => {
    expect(formatTime(83.45)).toBe("01:23.4")
  })

  it("0 秒 -> 00:00.0", () => {
    expect(formatTime(0)).toBe("00:00.0")
  })

  it("整數秒", () => {
    expect(formatTime(65)).toBe("01:05.0")
  })

  it("不足一分鐘", () => {
    expect(formatTime(9.9)).toBe("00:09.9")
  })

  it("剛好一分鐘", () => {
    expect(formatTime(60)).toBe("01:00.0")
  })

  it("超過 60 分鐘時分鐘位繼續累加", () => {
    expect(formatTime(3661.2)).toBe("61:01.2")
  })

  it("小數位無條件捨去到 0.1 秒（不四捨五入）", () => {
    expect(formatTime(1.96)).toBe("00:01.9")
  })

  it("捨去不會造成秒數進位", () => {
    expect(formatTime(59.96)).toBe("00:59.9")
  })

  it("捨去不會造成分鐘進位", () => {
    expect(formatTime(119.96)).toBe("01:59.9")
  })

  it("剛好等於下一分鐘邊界前不進位", () => {
    expect(formatTime(59.99)).toBe("00:59.9")
  })

  it("負數安全回傳 00:00.0", () => {
    expect(formatTime(-5)).toBe("00:00.0")
  })

  it("NaN 安全回傳 00:00.0", () => {
    expect(formatTime(Number.NaN)).toBe("00:00.0")
  })

  it("Infinity 安全回傳 00:00.0", () => {
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("00:00.0")
    expect(formatTime(Number.NEGATIVE_INFINITY)).toBe("00:00.0")
  })
})

describe("clampTime", () => {
  it("負數夾到 0", () => {
    expect(clampTime(-5)).toBe(0)
    expect(clampTime(-0.01)).toBe(0)
  })

  it("正常正數四捨五入到 0.1 秒精度", () => {
    expect(clampTime(1.23)).toBe(1.2)
    expect(clampTime(1.25)).toBeCloseTo(1.3, 10)
    expect(clampTime(1.27)).toBe(1.3)
  })

  it("避免浮點誤差累積（例如 0.1 + 0.2）", () => {
    const sum = 0.1 + 0.2 // 0.30000000000000004
    expect(clampTime(sum)).toBe(0.3)
  })

  it("0 保持為 0", () => {
    expect(clampTime(0)).toBe(0)
  })

  it("NaN 安全回傳 0", () => {
    expect(clampTime(Number.NaN)).toBe(0)
  })

  it("Infinity 安全回傳 0", () => {
    expect(clampTime(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampTime(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it("已經是 0.1 精度時保持不變", () => {
    expect(clampTime(12.3)).toBe(12.3)
  })
})
