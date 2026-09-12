import { describe, it, expect } from "vitest";
import { buildSchedule } from "./buildSchedule";
import type { SchedulerSettings, Task, Interval } from "./types";

// Australia/Perth is UTC+8 with no DST, so work hours map cleanly to UTC:
//   08:30 Perth = 00:30Z, 17:00 Perth = 09:00Z  (an 8h30m / 510-min window)
const settings: SchedulerSettings = {
  timezone: "Australia/Perth",
  workDays: [1, 2, 3, 4, 5],
  workStart: "08:30",
  workEnd: "17:00",
  minBlockMinutes: 30,
  bufferMinutes: 10,
};

// 2025-01-06 is a Monday.
const MON = "2025-01-06";
const TUE = "2025-01-07";
const FRI = "2025-01-10";
const NEXT_MON = "2025-01-13";

const at = (day: string, hhmmss: string) => `${day}T${hhmmss}.000Z`;
const first = <T extends { taskId: string }>(blocks: T[], id: string) => blocks.find((b) => b.taskId === id);
const all = <T extends { taskId: string }>(blocks: T[], id: string) => blocks.filter((b) => b.taskId === id);

describe("buildSchedule", () => {
  it("empty calendar: packs tasks back-to-back from work start, in priority order", () => {
    const now = new Date(at(MON, "00:00:00")); // Perth 08:00, before work start
    const tasks: Task[] = [
      { id: "a", priority: 0, estimateMinutes: 60 },
      { id: "b", priority: 1, estimateMinutes: 120 },
    ];
    const blocks = buildSchedule(tasks, [], settings, now);
    expect(blocks).toHaveLength(2);
    expect(first(blocks, "a")).toMatchObject({ start: at(MON, "00:30:00"), end: at(MON, "01:30:00"), chunkIndex: 0 });
    expect(first(blocks, "b")).toMatchObject({ start: at(MON, "01:30:00"), end: at(MON, "03:30:00"), chunkIndex: 0 });
  });

  it("weekend skipping: overflow lands on Monday, never on Sat/Sun", () => {
    const now = new Date(at(FRI, "08:30:00")); // Perth Fri 16:30, 30 min left in the day
    const tasks: Task[] = [{ id: "a", priority: 0, estimateMinutes: 90 }];
    const blocks = buildSchedule(tasks, [], settings, now);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ start: at(FRI, "08:30:00"), end: at(FRI, "09:00:00"), chunkIndex: 0 });
    expect(blocks[1]).toMatchObject({ start: at(NEXT_MON, "00:30:00"), end: at(NEXT_MON, "01:30:00"), chunkIndex: 1 });
    // nothing on the weekend
    for (const b of blocks) {
      const day = b.start.slice(0, 10);
      expect(day).not.toBe("2025-01-11");
      expect(day).not.toBe("2025-01-12");
    }
  });

  it("fully booked day: task moves to the next work day", () => {
    const now = new Date(at(MON, "00:00:00"));
    const busy: Interval[] = [{ start: at(MON, "00:00:00"), end: at(MON, "09:30:00") }]; // covers whole window
    const tasks: Task[] = [{ id: "a", priority: 0, estimateMinutes: 60 }];
    const blocks = buildSchedule(tasks, busy, settings, now);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ start: at(TUE, "00:30:00"), end: at(TUE, "01:30:00") });
  });

  it("task spanning two days: splits with incrementing chunkIndex", () => {
    const now = new Date(at(MON, "00:00:00"));
    const tasks: Task[] = [{ id: "a", priority: 0, estimateMinutes: 600 }]; // 10h > 8.5h/day
    const blocks = buildSchedule(tasks, [], settings, now);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ start: at(MON, "00:30:00"), end: at(MON, "09:00:00"), chunkIndex: 0 }); // 510 min
    expect(blocks[1]).toMatchObject({ start: at(TUE, "00:30:00"), end: at(TUE, "02:00:00"), chunkIndex: 1 }); // 90 min
  });

  it("task exactly filling a slot: one block, next task starts the following slot", () => {
    const now = new Date(at(MON, "00:00:00"));
    // busy 01:40Z–09:00Z, +10m buffer => blocks 01:30Z onward, leaving exactly 00:30–01:30 free (60 min)
    const busy: Interval[] = [{ start: at(MON, "01:40:00"), end: at(MON, "09:00:00") }];
    const tasks: Task[] = [
      { id: "a", priority: 0, estimateMinutes: 60 },
      { id: "b", priority: 1, estimateMinutes: 30 },
    ];
    const blocks = buildSchedule(tasks, busy, settings, now);
    expect(all(blocks, "a")).toHaveLength(1);
    expect(first(blocks, "a")).toMatchObject({ start: at(MON, "00:30:00"), end: at(MON, "01:30:00") });
    expect(first(blocks, "b")).toMatchObject({ start: at(TUE, "00:30:00"), end: at(TUE, "01:00:00") });
  });

  it("min-block rule: non-final chunk skips a sub-min sliver, but a small task may use it", () => {
    const now = new Date(at(MON, "00:00:00"));
    // busy 01:00Z–09:00Z, +10m buffer => free day-1 is only 00:30–00:50 (a 20-min sliver)
    const busy: Interval[] = [{ start: at(MON, "01:00:00"), end: at(MON, "09:00:00") }];
    const tasks: Task[] = [
      { id: "a", priority: 0, estimateMinutes: 60 }, // won't fragment into the 20-min sliver
      { id: "b", priority: 1, estimateMinutes: 15 }, // small enough to live in the sliver
    ];
    const blocks = buildSchedule(tasks, busy, settings, now);
    // a avoids the sliver entirely and starts next day
    expect(first(blocks, "a")).toMatchObject({ start: at(TUE, "00:30:00"), end: at(TUE, "01:30:00") });
    // b uses the 20-min sliver as its (small) final/only chunk
    expect(all(blocks, "b")).toHaveLength(1);
    expect(first(blocks, "b")).toMatchObject({ start: at(MON, "00:30:00"), end: at(MON, "00:45:00") });
  });

  it("buffer rule: blocks keep a bufferMinutes gap around existing events", () => {
    const now = new Date(at(MON, "00:00:00"));
    const busy: Interval[] = [{ start: at(MON, "04:00:00"), end: at(MON, "05:00:00") }];
    const tasks: Task[] = [{ id: "a", priority: 0, estimateMinutes: 300 }]; // 5h, straddles the meeting
    const blocks = buildSchedule(tasks, busy, settings, now);
    // no block overlaps the meeting
    for (const b of blocks) {
      const s = Date.parse(b.start);
      const e = Date.parse(b.end);
      expect(e <= Date.parse(at(MON, "04:00:00")) || s >= Date.parse(at(MON, "05:00:00"))).toBe(true);
    }
    // first chunk ends 10 min before the meeting; second starts 10 min after
    expect(blocks[0]).toMatchObject({ start: at(MON, "00:30:00"), end: at(MON, "03:50:00"), chunkIndex: 0 });
    expect(blocks[1]).toMatchObject({ start: at(MON, "05:10:00"), end: at(MON, "06:50:00"), chunkIndex: 1 });
  });

  it("deadline is advisory: flags overdueRisk but does not reorder", () => {
    const now = new Date(at(MON, "00:00:00"));
    const tasks: Task[] = [
      { id: "a", priority: 0, estimateMinutes: 60, deadline: at(MON, "00:45:00") }, // ends 01:30 > 00:45
      { id: "b", priority: 1, estimateMinutes: 60, deadline: at(TUE, "09:00:00") }, // comfortably in time
    ];
    const blocks = buildSchedule(tasks, [], settings, now);
    expect(first(blocks, "a")).toMatchObject({ start: at(MON, "00:30:00"), overdueRisk: true });
    expect(first(blocks, "b")!.overdueRisk).toBeUndefined();
    // order is unchanged: a (priority 0) is scheduled before b
    expect(Date.parse(first(blocks, "a")!.start)).toBeLessThan(Date.parse(first(blocks, "b")!.start));
  });
});
