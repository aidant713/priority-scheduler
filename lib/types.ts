export type TaskStatus = "todo" | "done" | "archived";

export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  estimate_minutes: number;
  priority: number;
  status: TaskStatus;
  deadline: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlockRow {
  id: string;
  task_id: string;
  gcal_event_id: string;
  start_at: string;
  end_at: string;
  chunk_index: number;
}

export interface SettingsRow {
  user_id: string;
  timezone: string;
  work_days: number[];
  work_start: string; // "HH:MM:SS"
  work_end: string;
  min_block_minutes: number;
  buffer_minutes: number;
  target_calendar_id: string | null;
  block_prefix: string;
}

export const DEFAULT_SETTINGS: Omit<SettingsRow, "user_id" | "target_calendar_id"> = {
  timezone: "Australia/Perth",
  work_days: [1, 2, 3, 4, 5],
  work_start: "08:30:00",
  work_end: "17:00:00",
  min_block_minutes: 30,
  buffer_minutes: 10,
  block_prefix: "⚡ ",
};
