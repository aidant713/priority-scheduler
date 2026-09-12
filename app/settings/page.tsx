import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { calendarFor, listCalendars, type CalendarInfo } from "@/lib/google/calendar";
import { DEFAULT_SETTINGS } from "@/lib/types";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = createClient();
  let { data: s } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!s) {
    const { data } = await supabase
      .from("user_settings")
      .insert({ user_id: user.id, ...DEFAULT_SETTINGS })
      .select("*")
      .single();
    s = data;
  }

  let calendars: CalendarInfo[] = [];
  if (s!.google_refresh_token) {
    try {
      calendars = await listCalendars(calendarFor(decrypt(s!.google_refresh_token)));
    } catch {
      // token invalid/expired — user can reconnect below
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Back to list
        </Link>
      </div>
      <SettingsForm
        initial={{
          timezone: s!.timezone,
          work_days: s!.work_days,
          work_start: String(s!.work_start).slice(0, 5),
          work_end: String(s!.work_end).slice(0, 5),
          min_block_minutes: s!.min_block_minutes,
          buffer_minutes: s!.buffer_minutes,
          target_calendar_id: s!.target_calendar_id,
          block_prefix: s!.block_prefix,
        }}
        calendars={calendars}
        googleConnected={!!s!.google_refresh_token}
      />
    </main>
  );
}
