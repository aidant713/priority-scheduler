"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CalendarInfo } from "@/lib/google/calendar";

export interface InitialSettings {
  timezone: string;
  work_days: number[];
  work_start: string; // "HH:MM"
  work_end: string;
  min_block_minutes: number;
  buffer_minutes: number;
  target_calendar_id: string | null;
  block_prefix: string;
}

const DAYS = [
  { n: 1, l: "Mon" },
  { n: 2, l: "Tue" },
  { n: 3, l: "Wed" },
  { n: 4, l: "Thu" },
  { n: 5, l: "Fri" },
  { n: 6, l: "Sat" },
  { n: 7, l: "Sun" },
];

const COMMON_TZ = [
  "Australia/Perth",
  "Australia/Sydney",
  "Australia/Brisbane",
  "Pacific/Auckland",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

export default function SettingsForm({
  initial,
  calendars,
  googleConnected,
}: {
  initial: InitialSettings;
  calendars: CalendarInfo[];
  googleConnected: boolean;
}) {
  const [timezone, setTimezone] = useState(initial.timezone);
  const [workDays, setWorkDays] = useState<number[]>(initial.work_days);
  const [workStart, setWorkStart] = useState(initial.work_start);
  const [workEnd, setWorkEnd] = useState(initial.work_end);
  const [minBlock, setMinBlock] = useState(initial.min_block_minutes);
  const [buffer, setBuffer] = useState(initial.buffer_minutes);
  const [prefix, setPrefix] = useState(initial.block_prefix);
  const [targetCal, setTargetCal] = useState(initial.target_calendar_id ?? "");
  const [status, setStatus] = useState<string>("");

  function toggleDay(n: number) {
    setWorkDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()));
  }

  async function save() {
    setStatus("Saving…");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timezone,
        workDays,
        workStart,
        workEnd,
        minBlockMinutes: minBlock,
        bufferMinutes: buffer,
        blockPrefix: prefix,
        targetCalendarId: targetCal,
      }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Save failed" }));
      setStatus(error ?? "Save failed");
      return;
    }
    // scheduling inputs changed → rebuild the calendar
    if (googleConnected) {
      setStatus("Saved — re-syncing…");
      await fetch("/api/sync", { method: "POST" }).catch(() => {});
    }
    setStatus("Saved");
  }

  async function connectGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/settings`,
        scopes:
          "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  async function disconnectGoogle() {
    await fetch("/api/google/disconnect", { method: "POST" });
    window.location.reload();
  }

  const field = "rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400";

  return (
    <div className="space-y-8">
      {/* Google connection */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Google Calendar</h2>
        {googleConnected ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-emerald-600">Connected</span>
            <button onClick={disconnectGoogle} className="text-sm text-neutral-500 underline">
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={connectGoogle}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            Connect Google Calendar
          </button>
        )}
      </section>

      {/* Working hours */}
      <section className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Timezone</span>
          <input
            list="tz-list"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={field}
          />
          <datalist id="tz-list">
            {COMMON_TZ.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Write to calendar</span>
          <select value={targetCal} onChange={(e) => setTargetCal(e.target.value)} className={field}>
            <option value="">Primary calendar (default)</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Work start</span>
          <input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Work end</span>
          <input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} className={field} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Min block (minutes)</span>
          <input
            type="number"
            min={5}
            value={minBlock}
            onChange={(e) => setMinBlock(Number(e.target.value))}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Buffer around events (minutes)</span>
          <input
            type="number"
            min={0}
            value={buffer}
            onChange={(e) => setBuffer(Number(e.target.value))}
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Event title prefix</span>
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className={field} />
        </label>
      </section>

      {/* Work days */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Work days</h2>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <button
              key={d.n}
              onClick={() => toggleDay(d.n)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                workDays.includes(d.n)
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              {d.l}
            </button>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-4">
        <button onClick={save} className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white">
          Save
        </button>
        <span className="text-sm text-neutral-500">{status}</span>
      </div>
    </div>
  );
}
