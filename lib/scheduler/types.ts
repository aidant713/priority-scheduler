// Pure scheduler types. No DB or Google types leak in here on purpose — the
// scheduler is I/O-free so it can be unit-tested in isolation.

export interface Task {
  id: string;
  priority: number; // 0 = top
  estimateMinutes: number; // > 0
  deadline?: string | null; // ISO, advisory only
}

export interface Interval {
  start: string; // ISO
  end: string; // ISO
}

export interface SchedulerSettings {
  timezone: string; // IANA, e.g. "Australia/Perth"
  workDays: number[]; // ISO weekday numbers, 1=Mon .. 7=Sun
  workStart: string; // "HH:mm" (or "HH:mm:ss")
  workEnd: string; // "HH:mm"
  minBlockMinutes: number; // don't create non-final chunks smaller than this
  bufferMinutes: number; // gap kept around existing (busy) events
  horizonDays?: number; // default 14
}

export interface ScheduledBlock {
  taskId: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  chunkIndex: number; // 0-based, for tasks split across slots/days
  overdueRisk?: boolean; // scheduled end is after the task's deadline (or didn't fully fit)
}
