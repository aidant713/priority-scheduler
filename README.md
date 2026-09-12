# Priority Scheduler

A single drag-and-drop task list that auto-schedules into your Google Calendar.

The **task list is the source of truth**; the calendar is a *rendering* of it. Every
time the list (or your settings) change, the app deletes all the auto-scheduled
blocks it owns and rewrites them from scratch — packed in priority order around
your existing events, within your working hours.

- **Priority is yours.** Tasks are scheduled strictly top-to-bottom. Deadlines are
  advisory: a task that lands after its deadline gets a ⚠︎ flag, but is never
  reordered.
- **We only touch our own events.** Every event we create is tagged with a private
  extended property (`prioritySchedulerOwned=1`). We never edit or delete an event
  we didn't create.

---

## Stack

Next.js (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth) ·
Google Calendar API v3 (`googleapis`) · `@dnd-kit` for drag-and-drop · Vitest.

---

## Setup

### 0. Prerequisites
- Node 18+ and npm
- A Google account
- A free Supabase account

### 1. Install
```bash
npm install
cp .env.example .env.local   # fill this in as you go through the steps below
```

### 2. Supabase project + schema
1. Create a project at <https://supabase.com/dashboard>.
2. **SQL Editor → New query** → paste the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.
   (Safe to re-run.) This creates `tasks`, `scheduled_blocks`, `user_settings`
   with RLS and the `reorder_tasks()` function.
3. **Project Settings → API** → copy into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (kept for future admin tasks; not required to run)

### 3. Google Cloud — Calendar API + OAuth client
1. <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → External → add your email as a
   **Test user** (so you can log in while the app is unverified).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web
   application**.
   - **Authorized redirect URI:**
     `https://<YOUR-SUPABASE-REF>.supabase.co/auth/v1/callback`
     (find `<YOUR-SUPABASE-REF>` in your Supabase project URL)
5. Copy the **Client ID** and **Client secret** into `.env.local`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

### 4. Wire Google into Supabase Auth
1. Supabase → **Authentication → Providers → Google** → enable.
2. Paste the same **Client ID / Client secret**.
3. Under **Additional scopes**, add both (space-separated):
   `https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly`
   (`calendar.events` = create/delete our events; `calendar.readonly` = list calendars + query free/busy)
4. Supabase → **Authentication → URL Configuration** → set **Site URL** to
   `http://localhost:3000` (add your production URL later).

### 5. App secrets
In `.env.local`:
```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)   # 32-byte key; encrypts the Google refresh token at rest
```

### 6. Run
```bash
npm run dev        # http://localhost:3000
npm test           # scheduler unit tests
npm run build      # production build / typecheck
```
Open the app, **Sign in with Google**, approve calendar access, add a few tasks,
drag to reorder — blocks appear on your calendar within ~1 second of the last change.

---

## How it works

### The scheduler (`lib/scheduler/buildSchedule.ts`)
A **pure, unit-tested** function — no I/O:
```
buildSchedule(tasks, busyIntervals, settings, now) → ScheduledBlock[]
```
1. Build the free-time grid: `now` (rounded up to the next 15 min) → 14 days,
   restricted to work days / hours, minus your busy events **expanded by
   `buffer_minutes`** on each side.
2. Walk tasks in priority order, filling free slots earliest-first. A task may
   **split across slots/days**. A non-final chunk is never smaller than
   `min_block_minutes` (a task's final remainder may be, and a small task may fill a
   sliver).
3. Flag `overdueRisk` if a task's scheduled end is past its deadline (or it doesn't
   fit in the horizon). **Never reorders.**

Run the tests: `npm test` (empty calendar, fully-booked day, split across days,
exact-fill, min-block, buffer, weekend-skip, deadline).

### Sync (`POST /api/sync`)
Debounced **800 ms** after the last change on the client, then:
1. **Delete every event we own** — by the ids in `scheduled_blocks` *and* a sweep of
   events carrying our marker (self-heals orphans / manual deletions). Clear the
   block rows.
2. **Read free/busy** across all your calendars.
   > Note: we delete our events *before* reading free/busy on purpose. Google's
   > `freebusy` API can't filter by extended property, so the only reliable way to
   > keep our own blocks from counting as "busy" is to remove them first.
3. `buildSchedule(...)`.
4. **Create** the new events (tagged + coloured) and write their ids back into
   `scheduled_blocks`.

### "We own our events, you don't"
If you **manually delete or move one of our blocks in Google Calendar, the next sync
simply recreates it** from the list. The list is the source of truth — edit the
list, not the calendar. (To stop a task being scheduled, mark it done/archived or
delete it.)

---

## Data model
`tasks` (title, notes, `estimate_minutes`, `priority` 0=top contiguous, `status`,
optional `deadline`) · `scheduled_blocks` (our Google events, disposable) ·
`user_settings` (timezone, work days/hours, min block, buffer, target calendar,
encrypted refresh token). All tables are **RLS**-protected: a user only ever sees
their own rows.

## Deploy (later)
Deploy to Vercel; set the same env vars. Add the production URL to Supabase **Site
URL** and to the Google OAuth client's authorized origins/redirects, and update
`NEXT_PUBLIC_SITE_URL`.

## Project layout
```
app/            pages (list, settings, login) + api routes (tasks, sync, settings, calendars, auth)
components/     TaskBoard, TaskList, TaskRow, QuickAdd, WeekView, SettingsForm, SyncIndicator
lib/scheduler/  buildSchedule (pure) + tests
lib/google/     googleapis calendar wrapper
lib/supabase/   server/client/middleware
supabase/migrations/  schema + RLS
```
