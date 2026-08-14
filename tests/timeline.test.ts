import { describe, expect, it } from "vitest"
import {
  clampTime,
  formatTime,
  getDraftsInWindow,
  getDurationForBehavior,
  getPixelsPerSecond,
  getRulerTicks,
  getScrollX,
  getSecondsPerPixel,
  getTimelineWindow,
  getVisibility,
  getVisibleDanmaku,
  snapTime,
  timeToX,
  xToTime,
} from "../extension/shared/timeline.js"
import type { DanmakuDraft, DanmakuBehavior, TimelineWindow } from "../extension/shared/types.js"
import { FIXED_DURATION_SEC, SCROLL_DURATION_SEC } from "../extension/shared/types.js"

function makeDraft(overrides: Partial<DanmakuDraft> = {}): DanmakuDraft {
  return {
    id: "d1",
    time: 10,
    text: "測試彈幕",
    trackId: "t1",
    behavior: "scroll",
    size: "medium",
    color: "#ffffff",
    ...overrides,
  }
}

describe("getDurationForBehavior", () => {
  it("scroll 使用 SCROLL_DURATION_SEC", () => {
    expect(getDurationForBehavior("scroll")).toBe(SCROLL_DURATION_SEC)
  })

  it("top 使用 FIXED_DURATION_SEC", () => {
    expect(getDurationForBehavior("top")).toBe(FIXED_DURATION_SEC)
  })

  it("bottom 使用 FIXED_DURATION_SEC", () => {
    expect(getDurationForBehavior("bottom")).toBe(FIXED_DURATION_SEC)
  })
})

describe("getVisibility", () => {
  describe.each<DanmakuBehavior>(["scroll", "top", "bottom"])("behavior=%s", (behavior) => {
    const duration = getDurationForBehavior(behavior)
    const draft = makeDraft({ time: 10, behavior })

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
    const scrollDraft = makeDraft({ time: 0, behavior: "scroll" })
    const topDraft = makeDraft({ time: 0, behavior: "top" })

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
      makeDraft({ id: "a", time: 0, behavior: "scroll" }), // 顯示 [0,6)
      makeDraft({ id: "b", time: 5, behavior: "top" }), // 顯示 [5,8)
      makeDraft({ id: "c", time: 20, behavior: "bottom" }), // 顯示 [20,23)
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
      makeDraft({ id: "a", time: 100, behavior: "scroll" }),
    ]
    expect(getVisibleDanmaku(drafts, 5)).toEqual([])
  })

  it("維持輸入順序（僅過濾，不重新排序）", () => {
    const drafts: DanmakuDraft[] = [
      makeDraft({ id: "x", time: 0, behavior: "top" }),
      makeDraft({ id: "y", time: 0, behavior: "top" }),
      makeDraft({ id: "z", time: 0, behavior: "top" }),
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

describe("getTimelineWindow", () => {
  it("以 currentTime 為中心，前後展開 halfSpanSec 秒", () => {
    expect(getTimelineWindow(30, 10)).toEqual({ start: 20, end: 40 })
  })

  it("currentTime 小於 halfSpanSec 時 start 允許為負，不夾到 0", () => {
    expect(getTimelineWindow(3, 10)).toEqual({ start: -7, end: 13 })
  })

  it("currentTime 為 0 時 start 亦為負", () => {
    expect(getTimelineWindow(0, 5)).toEqual({ start: -5, end: 5 })
  })

  it("halfSpanSec 為 0 時 start 等於 end", () => {
    expect(getTimelineWindow(10, 0)).toEqual({ start: 10, end: 10 })
  })
})

describe("timeToX / xToTime", () => {
  const window: TimelineWindow = { start: 10, end: 30 }

  it("window.start 換算為 0", () => {
    expect(timeToX(10, window, 1000)).toBe(0)
  })

  it("window.end 換算為 width", () => {
    expect(timeToX(30, window, 1000)).toBe(1000)
  })

  it("中點換算為 width 的一半", () => {
    expect(timeToX(20, window, 1000)).toBe(500)
  })

  it("視窗外的時間仍線性外插", () => {
    expect(timeToX(0, window, 1000)).toBe(-500)
    expect(timeToX(40, window, 1000)).toBe(1500)
  })

  it("width 為 0 時安全回傳 0", () => {
    expect(timeToX(20, window, 0)).toBe(0)
  })

  it("無效視窗（end <= start）時安全回傳 0", () => {
    expect(timeToX(20, { start: 30, end: 10 }, 1000)).toBe(0)
    expect(timeToX(20, { start: 10, end: 10 }, 1000)).toBe(0)
  })

  it("x=0 換算回 window.start", () => {
    expect(xToTime(0, window, 1000)).toBe(10)
  })

  it("x=width 換算回 window.end", () => {
    expect(xToTime(1000, window, 1000)).toBe(30)
  })

  it("width 為 0 時安全回傳 window.start（不出現 Infinity/NaN）", () => {
    expect(xToTime(500, window, 0)).toBe(10)
  })

  it("timeToX 與 xToTime 互為反函式", () => {
    for (const time of [-5, 0, 10, 15.5, 20, 30, 42]) {
      const x = timeToX(time, window, 800)
      expect(xToTime(x, window, 800)).toBeCloseTo(time, 8)
    }
    for (const x of [-100, 0, 123.4, 400, 800, 950]) {
      const time = xToTime(x, window, 800)
      expect(timeToX(time, window, 800)).toBeCloseTo(x, 8)
    }
  })
})

describe("getSecondsPerPixel / getPixelsPerSecond", () => {
  const window: TimelineWindow = { start: 0, end: 20 }

  it("正常情況下互為倒數", () => {
    expect(getSecondsPerPixel(window, 1000)).toBeCloseTo(0.02, 10)
    expect(getPixelsPerSecond(window, 1000)).toBeCloseTo(50, 10)
  })

  it("width 為 0 時安全回傳 0（不是 Infinity）", () => {
    expect(getSecondsPerPixel(window, 0)).toBe(0)
    expect(getPixelsPerSecond(window, 0)).toBe(0)
  })

  it("視窗無效（end <= start）時安全回傳 0", () => {
    const degenerate: TimelineWindow = { start: 10, end: 10 }
    expect(getSecondsPerPixel(degenerate, 1000)).toBe(0)
    expect(getPixelsPerSecond(degenerate, 1000)).toBe(0)

    const reversed: TimelineWindow = { start: 10, end: 5 }
    expect(getSecondsPerPixel(reversed, 1000)).toBe(0)
    expect(getPixelsPerSecond(reversed, 1000)).toBe(0)
  })
})

describe("getDraftsInWindow", () => {
  it("完全落在視窗內的彈幕會被包含", () => {
    const drafts = [makeDraft({ id: "a", time: 15, behavior: "top" })] // [15,18)
    const window: TimelineWindow = { start: 10, end: 20 }
    expect(getDraftsInWindow(drafts, window).map((d) => d.id)).toEqual(["a"])
  })

  it("完全在視窗之外的彈幕會被排除", () => {
    const drafts = [
      makeDraft({ id: "before", time: -10, behavior: "top" }), // [-10,-7)
      makeDraft({ id: "after", time: 100, behavior: "top" }), // [100,103)
    ]
    const window: TimelineWindow = { start: 0, end: 20 }
    expect(getDraftsInWindow(drafts, window)).toEqual([])
  })

  it("在 window.start 之前開始但延續到視窗內的彈幕要被包含", () => {
    // scroll duration = 6，time=-3 -> 顯示區間 [-3,3)，視窗 [0,20) 有重疊
    const drafts = [makeDraft({ id: "a", time: -3, behavior: "scroll" })]
    const window: TimelineWindow = { start: 0, end: 20 }
    expect(getDraftsInWindow(drafts, window).map((d) => d.id)).toEqual(["a"])
  })

  it("顯示區間剛好在 window.start 結束時不算重疊", () => {
    // top duration = 3，time=-3 -> 顯示區間 [-3,0)，window.start=0，無重疊
    const drafts = [makeDraft({ id: "a", time: -3, behavior: "top" })]
    const window: TimelineWindow = { start: 0, end: 20 }
    expect(getDraftsInWindow(drafts, window)).toEqual([])
  })

  it("顯示區間剛好在 window.end 開始時不算重疊", () => {
    const drafts = [makeDraft({ id: "a", time: 20, behavior: "top" })] // [20,23)
    const window: TimelineWindow = { start: 0, end: 20 }
    expect(getDraftsInWindow(drafts, window)).toEqual([])
  })

  it("顯示區間剛好涵蓋到 window.end 前一刻時仍算重疊", () => {
    const drafts = [makeDraft({ id: "a", time: 19.99, behavior: "top" })] // [19.99,22.99)
    const window: TimelineWindow = { start: 0, end: 20 }
    expect(getDraftsInWindow(drafts, window).map((d) => d.id)).toEqual(["a"])
  })

  it("視窗無效時回傳空陣列", () => {
    const drafts = [makeDraft({ id: "a", time: 5, behavior: "top" })]
    expect(getDraftsInWindow(drafts, { start: 10, end: 5 })).toEqual([])
    expect(getDraftsInWindow(drafts, { start: 10, end: 10 })).toEqual([])
  })

  it("空陣列輸入回傳空陣列", () => {
    expect(getDraftsInWindow([], { start: 0, end: 20 })).toEqual([])
  })

  it("維持輸入順序", () => {
    const drafts = [
      makeDraft({ id: "x", time: 1, behavior: "top" }),
      makeDraft({ id: "y", time: 2, behavior: "top" }),
      makeDraft({ id: "z", time: 3, behavior: "top" }),
    ]
    const window: TimelineWindow = { start: 0, end: 20 }
    expect(getDraftsInWindow(drafts, window).map((d) => d.id)).toEqual(["x", "y", "z"])
  })
})

describe("getRulerTicks", () => {
  it("width 為 0 時回傳空陣列", () => {
    expect(getRulerTicks({ start: 0, end: 20 }, 0)).toEqual([])
  })

  it("視窗無效時回傳空陣列", () => {
    expect(getRulerTicks({ start: 20, end: 0 }, 1000)).toEqual([])
    expect(getRulerTicks({ start: 10, end: 10 }, 1000)).toEqual([])
  })

  it("寬視窗（極端縮小）時選用最大候選間隔 60 秒", () => {
    // span 很大、width 有限，pxPerSecond 很小，任何候選都無法達到 minPxBetweenTicks，
    // 應退回最大候選 60 秒
    const window: TimelineWindow = { start: 0, end: 100000 }
    const ticks = getRulerTicks(window, 500)
    const diffs = new Set<number>()
    for (let i = 1; i < ticks.length; i += 1) {
      diffs.add(Math.round((ticks[i].time - ticks[i - 1].time) * 10) / 10)
    }
    expect([...diffs]).toEqual([60])
  })

  it("窄視窗（極端放大）時選用最小候選間隔 0.5 秒", () => {
    // span 很小、width 很大，pxPerSecond 很大，最小候選 0.5 秒即可滿足門檻
    const window: TimelineWindow = { start: 0, end: 5 }
    const ticks = getRulerTicks(window, 2000)
    const diffs = new Set<number>()
    for (let i = 1; i < ticks.length; i += 1) {
      diffs.add(Math.round((ticks[i].time - ticks[i - 1].time) * 10) / 10)
    }
    expect([...diffs]).toEqual([0.5])
  })

  it("刻度時間對齊間隔整數倍，不是從 window.start 起算", () => {
    // span=20, width=200 -> pxPerSecond=10；候選中 10*10=100>=60(min) 但 5*10=50<60，
    // 所以應選 interval=10
    const window: TimelineWindow = { start: 3, end: 23 }
    const ticks = getRulerTicks(window, 200)
    for (const tick of ticks) {
      expect(tick.time % 10).toBeCloseTo(0, 8)
    }
    // window.start=3 不是 10 的倍數，但刻度應包含 10 這個對齊值
    expect(ticks.map((t) => t.time)).toContain(10)
    expect(ticks.map((t) => t.time)).toContain(20)
  })

  it("每個刻度的 x 座標與 timeToX 一致", () => {
    const window: TimelineWindow = { start: 0, end: 60 }
    const width = 1200
    const ticks = getRulerTicks(window, width)
    for (const tick of ticks) {
      expect(tick.x).toBeCloseTo(timeToX(tick.time, window, width), 8)
    }
  })

  it("major 標示每 5 格或跨整分鐘", () => {
    // span=100, width=1000 -> pxPerSecond=10，候選中 interval=10 (10*10=100>=60)
    const window: TimelineWindow = { start: 0, end: 100 }
    const ticks = getRulerTicks(window, 1000)
    const major = ticks.filter((t) => t.major).map((t) => t.time)
    // interval=10，每 5 格代表每 50 秒，同時整分鐘 60 也會是 major
    for (const time of major) {
      const isEveryFifty = time % 50 === 0
      const isMinute = time % 60 === 0
      expect(isEveryFifty || isMinute).toBe(true)
    }
    expect(major).toContain(0)
  })

  it("minPxBetweenTicks 可自訂，數值越大間隔越疏", () => {
    const window: TimelineWindow = { start: 0, end: 100 }
    const width = 1000 // pxPerSecond = 10
    const ticksDefault = getRulerTicks(window, width) // min=60 -> interval 10
    const ticksLoose = getRulerTicks(window, width, 400) // 需要 interval*10>=400 -> interval=60(400不能被5*10=50滿足,10*10=100不夠,取60)
    const intervalDefault =
      ticksDefault.length > 1 ? ticksDefault[1].time - ticksDefault[0].time : 0
    const intervalLoose = ticksLoose.length > 1 ? ticksLoose[1].time - ticksLoose[0].time : 0
    expect(intervalLoose).toBeGreaterThanOrEqual(intervalDefault)
  })

  it("刻度皆落在視窗範圍內", () => {
    const window: TimelineWindow = { start: 3, end: 23 }
    const ticks = getRulerTicks(window, 200)
    for (const tick of ticks) {
      expect(tick.time).toBeGreaterThanOrEqual(window.start)
      expect(tick.time).toBeLessThanOrEqual(window.end)
    }
  })
})

describe("snapTime", () => {
  it("負數夾到 0", () => {
    expect(snapTime(-5, null)).toBe(0)
  })

  it("duration 為 null 時只夾下限", () => {
    expect(snapTime(1000, null)).toBe(1000)
  })

  it("超過 duration 時夾到 duration", () => {
    expect(snapTime(50, 30)).toBe(30)
  })

  it("介於範圍內時四捨五入到 0.1 秒", () => {
    expect(snapTime(12.34, 100)).toBe(12.3)
    expect(snapTime(12.36, 100)).toBeCloseTo(12.4, 10)
  })

  it("duration 為 0 時一律夾到 0", () => {
    expect(snapTime(5, 0)).toBe(0)
    expect(snapTime(-5, 0)).toBe(0)
  })

  it("NaN 安全回傳 0", () => {
    expect(snapTime(Number.NaN, 10)).toBe(0)
  })

  it("Infinity 輸入安全處理", () => {
    expect(snapTime(Number.POSITIVE_INFINITY, 10)).toBe(0)
  })
})
