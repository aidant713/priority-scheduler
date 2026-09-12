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
  getBusyAndOwned,
  deleteEvents,
  insertEvents,
  patchEvent,
  type NewEvent,
} from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

const keyOf = (taskId: string, chunk: number, startMs: number, endMs: number) =>
  `${taskId}|${chunk}|${startMs}|${endMs}`;

// POST /api/sync — rebuild the calendar from the task list, but DIFF instead of
// delete-all/recreate-all: keep blocks that didn't move, only create the new ones
// and delete the stale ones. Cuts API calls dramatically (fewer rate-limit fails),
// and is gap-safe (creates happen before deletes; ours are excluded from busy).
export async function POST() {
  try {
    const user = await requireUser();
    const supabase = createClient();

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

    // 1) real busy + our existing events (with detail, for diffing)
    const calendarIds = await listCalendarIds(cal);
    const { busy, owned } = await getBusyAndOwned(cal, calendarIds, timeMin, timeMax);

    // 2) schedule
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

    const chunkTotals = new Map<string, number>();
    for (const b of schedule) chunkTotals.set(b.taskId, (chunkTotals.get(b.taskId) ?? 0) + 1);
    const prefix: string = settings.block_prefix ?? "⚡ ";
    const summaryOf = (taskId: string) => `${prefix}${metaById.get(taskId)?.title ?? "Task"}`;
    const descOf = (taskId: string, chunkIndex: number) => {
      const total = chunkTotals.get(taskId) ?? 1;
      const note = total > 1 ? `\n\nchunk ${chunkIndex + 1} of ${total}` : "";
      return `${metaById.get(taskId)?.notes ?? ""}${note}`.trim();
    };

    // 3) DIFF against existing events
    const existingByKey = new Map(owned.map((e) => [keyOf(e.taskId, e.chunkIndex, e.startMs, e.endMs), e]));
    const usedIds = new Set<string>();
    const toCreate: { block: (typeof schedule)[number]; ev: NewEvent }[] = [];
    // final blocks -> DB rows (eventId filled in below)
    const finalRows: { taskId: string; start: string; end: string; chunkIndex: number; eventId?: string }[] = [];

    for (const b of schedule) {
      const k = keyOf(b.taskId, b.chunkIndex, Date.parse(b.start), Date.parse(b.end));
      const ex = existingByKey.get(k);
      const row = { taskId: b.taskId, start: b.start, end: b.end, chunkIndex: b.chunkIndex, eventId: undefined as string | undefined };
      if (ex) {
        usedIds.add(ex.id);
        row.eventId = ex.id;
        // same slot — only fix the title if it changed (rename)
        const wantSummary = summaryOf(b.taskId);
        if (ex.summary !== wantSummary) {
          await patchEvent(cal, calendarId, ex.id, { summary: wantSummary, description: descOf(b.taskId, b.chunkIndex) });
        }
      } else {
        toCreate.push({
          block: b,
          ev: {
            taskId: b.taskId,
            summary: summaryOf(b.taskId),
            description: descOf(b.taskId, b.chunkIndex),
            startIso: b.start,
            endIso: b.end,
            timeZone: settings.timezone,
            chunkIndex: b.chunkIndex,
          },
        });
      }
      finalRows.push(row);
    }

    // 4) create the new ones FIRST (gap-safe). If this throws, nothing was deleted.
    const createdIds = await insertEvents(cal, calendarId, toCreate.map((c) => c.ev));
    const createdByBlock = new Map(toCreate.map((c, i) => [c.block, createdIds[i]]));
    for (const r of finalRows) {
      if (!r.eventId) {
        const b = schedule.find((s) => s.taskId === r.taskId && s.chunkIndex === r.chunkIndex && s.start === r.start);
        if (b) r.eventId = createdByBlock.get(b);
      }
    }

    // 5) persist the final set
    await supabase.from("scheduled_blocks").delete().eq("user_id", user.id);
    let inserted: unknown[] = [];
    const rows = finalRows
      .filter((r) => r.eventId)
      .map((r) => ({
        task_id: r.taskId,
        user_id: user.id,
        gcal_event_id: r.eventId!,
        start_at: r.start,
        end_at: r.end,
        chunk_index: r.chunkIndex,
      }));
    if (rows.length) {
      const { data, error } = await supabase.from("scheduled_blocks").insert(rows).select("*");
      if (error) throw error;
      inserted = data ?? [];
    }

    // 6) delete stale events (owned but not reused) — best-effort
    const toDelete = owned.filter((e) => !usedIds.has(e.id)).map((e) => e.id);
    try {
      await deleteEvents(cal, calendarId, toDelete);
    } catch {
      /* leftovers self-heal next sync and never count as busy */
    }

    return NextResponse.json({ blocks: inserted });
  } catch (e) {
    return errorResponse(e);
  }
}
