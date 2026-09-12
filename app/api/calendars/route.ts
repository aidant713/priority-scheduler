import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { calendarFor, listCalendars } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

// GET /api/calendars — writable Google calendars, for the "write to" dropdown
export async function GET() {
  try {
    const user = await requireUser();
    const supabase = createClient();
    const { data: settings } = await supabase
      .from("user_settings")
      .select("google_refresh_token")
      .eq("user_id", user.id)
      .single();
    if (!settings?.google_refresh_token) return NextResponse.json({ calendars: [] });
    const cal = calendarFor(decrypt(settings.google_refresh_token));
    return NextResponse.json({ calendars: await listCalendars(cal) });
  } catch (e) {
    return errorResponse(e);
  }
}
