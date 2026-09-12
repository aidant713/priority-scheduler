import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { buildSchedule } from "@/lib/scheduler/buildSchedule";
import type { SchedulerSettings, Task as SchedTask } from "@/lib/scheduler/types";
import {
  calendarFor,
  listCalendarIds,
  getBusy,
  listOwnedEventIds,
  deleteEvents,
  insertEvents,
  type NewEvent,
} from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

// POST /api/sync — rebuild the calendar rendering from the task list.
// Order (chosen for correctness): delete our old events FIRST, then read
// free/busy (so our own blocks never count as busy — freebusy can't filter by
// extended property), then schedule + insert + persist.
export async function POST() {
  try {
    const user = await requireUser();
    const supabase = createClient();

    // 1) settings (incl. refresh token) + tasks
    const { data: settings } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (!settings) return NextResponse.json({ error: "no settings" }, { status: 400 });
    if (!settings.google_refresh_token) {
      return NextResponse.json({ error: "Google Calendar not connected" }, { status: 400 });
    }

    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, priority, estimate_minutes, deadline")
      .eq("user_id", user.id)
      .eq("status", "todo")
      .order("priority", { ascending: true });

    const { data: taskMeta } = await supabase
      .from("tasks")
      .select("id, title, notes")
      .eq("user_id", user.id);
    const metaById = new Map((taskMeta ?? []).map((t) => [t.id as string, t]));

    const cal = calendarFor(decrypt(settings.google_refresh_token));
    const calendarId: string = settings.target_calendar_id || "primary";

    const now = new Date();
    const horizonDays = 14;
    const timeMin = now.toISOString();
    const timeMax = DateTime.fromJSDate(now).plus({ days: horizonDays + 1 }).toISO()!;

    // 2) delete every event we own — from stored ids + a marker sweep (self-heals
    // orphans and manual deletions), then clear our block rows.
    const { data: oldBlocks } = await supabase
      .from("scheduled_blocks")
      .select("gcal_event_id")
      .eq("user_id", user.id);
    const storedIds = (oldBlocks ?? []).map((b) => b.gcal_event_id as string);
    const sweptIds = await listOwnedEventIds(cal, calendarId, timeMin, timeMax);
    const toDelete = Array.from(new Set([...storedIds, ...sweptIds]));
    await deleteEvents(cal, calendarId, toDelete);
    await supabase.from("scheduled_blocks").delete().eq("user_id", user.id);

    // 3) free/busy across all calendars (our events are already gone)
    const calendarIds = await listCalendarIds(cal);
    const busy = await getBusy(cal, calendarIds, timeMin, timeMax);

    // 4) schedule
    const schedSettings: SchedulerSettings = {
      timezone: settings.timezone,
      workDays: settings.work_days,
      workStart: String(settings.work_start).slice(0, 5),
      workEnd: String(settings.work_end).slice(0, 5),
      minBlockMinutes: settings.min_block_minutes,
      bufferMinutes: settings.buffer_minutes,
      horizonDays,
    };
    const schedTasks: SchedTask[] = (tasks ?? []).map((t) => ({
      id: t.id,
      priority: t.priority,
      estimateMinutes: t.estimate_minutes,
      deadline: t.deadline,
    }));
    const schedule = buildSchedule(schedTasks, busy, schedSettings, now);

    // 5) create Google events (chunk labels), then persist block rows with ids
    const chunkTotals = new Map<string, number>();
    for (const b of schedule) chunkTotals.set(b.taskId, (chunkTotals.get(b.taskId) ?? 0) + 1);

    const prefix: string = settings.block_prefix ?? "⚡ ";
    const newEvents: NewEvent[] = schedule.map((b) => {
      const meta = metaById.get(b.taskId);
      const total = chunkTotals.get(b.taskId) ?? 1;
      const chunkNote = total > 1 ? `\n\nchunk ${b.chunkIndex + 1} of ${total}` : "";
      return {
        taskId: b.taskId,
        summary: `${prefix}${meta?.title ?? "Task"}`,
        description: `${meta?.notes ?? ""}${chunkNote}`.trim(),
        startIso: b.start,
        endIso: b.end,
        timeZone: settings.timezone,
        chunkIndex: b.chunkIndex,
      };
    });

    const eventIds = await insertEvents(cal, calendarId, newEvents);

    const rows = schedule.map((b, i) => ({
      task_id: b.taskId,
      user_id: user.id,
      gcal_event_id: eventIds[i],
      start_at: b.start,
      end_at: b.end,
      chunk_index: b.chunkIndex,
    }));

    let inserted: unknown[] = [];
    if (rows.length) {
      const { data, error } = await supabase.from("scheduled_blocks").insert(rows).select("*");
      if (error) throw error;
      inserted = data ?? [];
    }

    return NextResponse.json({ blocks: inserted, busy });
  } catch (e) {
    return errorResponse(e);
  }
}
