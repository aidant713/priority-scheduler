import { DateTime } from "luxon";
import type { Task, Interval, SchedulerSettings, ScheduledBlock } from "./types";

const MIN = 60_000; // ms per minute

interface Slot {
  start: number; // epoch ms
  end: number; // epoch ms
}

function parseHM(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(":");
  return { hour: Number(h), minute: Number(m ?? "0") };
}

/** Round an epoch-ms up to the next 15-minute mark. */
function ceilTo15(ms: number): number {
  const step = 15 * MIN;
  return Math.ceil(ms / step) * step;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Build the free-time grid: work-hour windows over the horizon (in the user's
 * timezone, restricted to work days), minus existing busy intervals expanded by
 * `bufferMinutes` on each side. Returns disjoint slots sorted earliest-first.
 *
 * Exported for direct testing.
 */
export function buildFreeSlots(
  busy: Interval[],
  settings: SchedulerSettings,
  now: Date,
): Slot[] {
  const tz = settings.timezone;
  const horizonDays = settings.horizonDays ?? 14;
  const buffer = settings.bufferMinutes * MIN;
  const nowMs = ceilTo15(now.getTime());
  const horizonEnd = nowMs + horizonDays * 24 * 60 * MIN;

  const { hour: sh, minute: sm } = parseHM(settings.workStart);
  const { hour: eh, minute: em } = parseHM(settings.workEnd);

  // 1) work-hour windows per day, in the user's timezone
  const windows: Slot[] = [];
  let day = DateTime.fromMillis(nowMs, { zone: tz }).startOf("day");
  const lastDay = DateTime.fromMillis(horizonEnd, { zone: tz }).startOf("day");
  while (day <= lastDay) {
    if (settings.workDays.includes(day.weekday)) {
      const ws = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 }).toMillis();
      const we = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 }).toMillis();
      const start = Math.max(ws, nowMs);
      const end = Math.min(we, horizonEnd);
      if (end > start) windows.push({ start, end });
    }
    day = day.plus({ days: 1 });
  }

  // 2) expand busy by buffer, then merge overlaps
  const blocked: Slot[] = busy
    .map((b) => ({
      start: DateTime.fromISO(b.start, { zone: "utc" }).toMillis() - buffer,
      end: DateTime.fromISO(b.end, { zone: "utc" }).toMillis() + buffer,
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  const merged: Slot[] = [];
  for (const b of blocked) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }

  // 3) subtract blocked from each window
  const free: Slot[] = [];
  for (const w of windows) {
    let cursor = w.start;
    for (const b of merged) {
      if (b.end <= cursor || b.start >= w.end) continue;
      if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, w.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= w.end) break;
    }
    if (cursor < w.end) free.push({ start: cursor, end: w.end });
  }

  return free.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
}

/**
 * Pure scheduler. Packs `todo` tasks (in priority order) into the free-time grid,
 * earliest-first. Tasks may split across slots/days. Deadlines are advisory:
 * blocks are flagged `overdueRisk` when a task's scheduled end is past its
 * deadline (or it didn't fully fit), but tasks are never reordered.
 */
export function buildSchedule(
  tasks: Task[],
  busy: Interval[],
  settings: SchedulerSettings,
  now: Date,
): ScheduledBlock[] {
  const minBlock = settings.minBlockMinutes;
  const slots = buildFreeSlots(busy, settings, now); // slot.start is consumed as we pack
  const ordered = [...tasks].sort((a, b) => a.priority - b.priority);
  const out: ScheduledBlock[] = [];

  for (const task of ordered) {
    let remaining = task.estimateMinutes;
    let chunkIndex = 0;
    const taskBlocks: ScheduledBlock[] = [];

    for (const slot of slots) {
      if (remaining <= 0) break;
      const capMin = (slot.end - slot.start) / MIN;
      if (capMin <= 0) continue;

      if (remaining <= capMin) {
        // fits here — may be a small final chunk, which is allowed
        const start = slot.start;
        const end = start + remaining * MIN;
        taskBlocks.push({ taskId: task.id, start: iso(start), end: iso(end), chunkIndex: chunkIndex++ });
        slot.start = end;
        remaining = 0;
      } else if (capMin >= minBlock) {
        // fill the whole slot as a non-final chunk (>= minBlock)
        taskBlocks.push({ taskId: task.id, start: iso(slot.start), end: iso(slot.end), chunkIndex: chunkIndex++ });
        remaining -= capMin;
        slot.start = slot.end;
      }
      // else: slot smaller than minBlock and this would be a non-final chunk —
      // leave the sliver for a later (smaller) task rather than fragment.
    }

    // deadline is advisory: flag risk, never reorder
    if (task.deadline) {
      const deadlineMs = DateTime.fromISO(task.deadline, { zone: "utc" }).toMillis();
      const lastEnd = taskBlocks.length
        ? DateTime.fromISO(taskBlocks[taskBlocks.length - 1].end, { zone: "utc" }).toMillis()
        : Infinity;
      if (remaining > 0 || lastEnd > deadlineMs) {
        for (const b of taskBlocks) b.overdueRisk = true;
      }
    }

    out.push(...taskBlocks);
  }

  return out;
}
