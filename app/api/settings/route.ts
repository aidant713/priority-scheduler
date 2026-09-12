import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api";

const HHMM = /^\d{2}:\d{2}$/;

// PATCH /api/settings — update scheduling preferences
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (typeof body.timezone === "string" && DateTime.now().setZone(body.timezone).isValid) {
      patch.timezone = body.timezone;
    }
    if (Array.isArray(body.workDays)) {
      const days = [...new Set<number>(body.workDays.map((x: unknown) => Number(x)))]
        .filter((d) => d >= 1 && d <= 7)
        .sort((a, b) => a - b);
      patch.work_days = days;
    }
    if (typeof body.workStart === "string" && HHMM.test(body.workStart)) patch.work_start = body.workStart;
    if (typeof body.workEnd === "string" && HHMM.test(body.workEnd)) patch.work_end = body.workEnd;
    if (body.minBlockMinutes != null) {
      const n = Math.round(Number(body.minBlockMinutes));
      if (n > 0) patch.min_block_minutes = n;
    }
    if (body.bufferMinutes != null) {
      const n = Math.round(Number(body.bufferMinutes));
      if (n >= 0) patch.buffer_minutes = n;
    }
    if ("targetCalendarId" in body) patch.target_calendar_id = body.targetCalendarId || null;
    if (typeof body.blockPrefix === "string") patch.block_prefix = body.blockPrefix;

    // guard: work_start must precede work_end
    if (patch.work_start && patch.work_end && String(patch.work_start) >= String(patch.work_end)) {
      return NextResponse.json({ error: "work start must be before work end" }, { status: 400 });
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no valid fields" }, { status: 400 });
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_settings")
      .update(patch)
      .eq("user_id", user.id)
      .select(
        "timezone, work_days, work_start, work_end, min_block_minutes, buffer_minutes, target_calendar_id, block_prefix",
      )
      .single();
    if (error) throw error;
    return NextResponse.json({ settings: data });
  } catch (e) {
    return errorResponse(e);
  }
}
