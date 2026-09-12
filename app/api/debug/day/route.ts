import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { calendarFor, listCalendars, getBusy, OWNED_KEY } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

// GET /api/debug/day?date=YYYY-MM-DD
// Lists every event across all calendars that day + the raw free/busy Google
// returns, so we can see exactly what is (or isn't) blocking a slot.
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const supabase = createClient();
    const { data: settings } = await supabase
      .from("user_settings")
      .select("timezone, google_refresh_token")
      .eq("user_id", user.id)
      .single();
    if (!settings?.google_refresh_token) {
      return NextResponse.json({ error: "Google not connected" }, { status: 400 });
    }

    const tz = settings.timezone;
    const url = new URL(request.url);
    const dateStr = url.searchParams.get("date") ?? DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
    const dayStart = DateTime.fromISO(dateStr, { zone: tz }).startOf("day");
    const timeMin = dayStart.toUTC().toISO()!;
    const timeMax = dayStart.plus({ days: 1 }).toUTC().toISO()!;

    const cal = calendarFor(decrypt(settings.google_refresh_token));
    const calendars = await listCalendars(cal);

    const fmt = (iso?: string | null) =>
      iso ? DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("HH:mm") : "all-day";

    const events: unknown[] = [];
    for (const c of calendars) {
      const res = await cal.events.list({
        calendarId: c.id,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 50,
      });
      for (const e of res.data.items ?? []) {
        events.push({
          calendar: c.summary,
          summary: e.summary ?? "(no title)",
          start: fmt(e.start?.dateTime ?? e.start?.date),
          end: fmt(e.end?.dateTime ?? e.end?.date),
          transparency: e.transparency ?? "opaque(busy)",
          status: e.status,
          ours: e.extendedProperties?.private?.[OWNED_KEY] === "1",
        });
      }
    }

    const busyRaw = await getBusy(cal, calendars.map((c) => c.id), timeMin, timeMax);
    const busy = busyRaw
      .map((b) => `${fmt(b.start)}–${fmt(b.end)}`)
      .sort();

    return NextResponse.json({
      date: dateStr,
      timezone: tz,
      calendars: calendars.map((c) => c.summary),
      busy_intervals: busy,
      events,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
