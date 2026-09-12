"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // calendar.events: create/delete our own events.
        // calendar.readonly: list calendars + query free/busy for scheduling.
        scopes:
          "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
        // offline + consent so Google returns a refresh token we can store
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Priority Scheduler</h1>
        <p className="mt-2 max-w-sm text-sm text-neutral-500">
          A drag-and-drop task list that auto-schedules into your Google Calendar.
        </p>
      </div>
      <button
        onClick={signIn}
        disabled={loading}
        className="rounded-lg bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
      >
        {loading ? "Redirecting…" : "Sign in with Google"}
      </button>
      <p className="max-w-xs text-center text-xs text-neutral-400">
        We only create and manage the calendar events we own. We never edit your other events.
      </p>
    </main>
  );
}
