import { google, type calendar_v3 } from "googleapis";
import type { Interval } from "@/lib/scheduler/types";

// Marker so we can find/delete only the events we own, and never touch others.
export const OWNED_KEY = "prioritySchedulerOwned";
export const OWNED_VAL = "1";
export const TASK_KEY = "prioritySchedulerId";
export const OUR_COLOR_ID = "5"; // "Banana" — visually distinct from default events

export type Calendar = calendar_v3.Calendar;

/** OAuth2 client seeded with the user's refresh token (auto-refreshes access). */
export function calendarFor(refreshToken: string): Calendar {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

/** All calendar ids the user can see (used for a complete free/busy picture). */
export async function listCalendarIds(cal: Calendar): Promise<string[]> {
  const res = await withRetry(() => cal.calendarList.list({ maxResults: 250 }));
  return (res.data.items ?? []).map((c) => c.id!).filter(Boolean);
}

export interface CalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
}

/** Calendars with names, for the "write to" dropdown. Writable ones first. */
export async function listCalendars(cal: Calendar): Promise<CalendarInfo[]> {
  const res = await withRetry(() => cal.calendarList.list({ maxResults: 250 }));
  return (res.data.items ?? [])
    .filter((c) => c.id && c.accessRole !== "reader" && c.accessRole !== "freeBusyReader")
    .map((c) => ({ id: c.id!, summary: c.summary ?? c.id!, primary: !!c.primary }));
}

/** Busy intervals across the given calendars between timeMin/timeMax (ISO). */
export async function getBusy(
  cal: Calendar,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
): Promise<Interval[]> {
  if (calendarIds.length === 0) return [];
  const res = await withRetry(() =>
    cal.freebusy.query({
      requestBody: { timeMin, timeMax, items: calendarIds.map((id) => ({ id })) },
    }),
  );
  const cals = res.data.calendars ?? {};
  const out: Interval[] = [];
  for (const id of Object.keys(cals)) {
    for (const b of cals[id].busy ?? []) {
      if (b.start && b.end) out.push({ start: b.start, end: b.end });
    }
  }
  return out;
}

export interface OwnedEvent {
  id: string;
  taskId: string;
  chunkIndex: number;
  startMs: number;
  endMs: number;
  summary: string;
}
export interface BusyAndOwned {
  busy: Interval[];
  owned: OwnedEvent[];
}

/**
 * One pass over all calendars: returns real busy intervals (excluding OUR events,
 * free/transparent, cancelled, and declined) plus full details of every event we
 * own (so the sync can diff instead of delete-all/recreate-all). Excluding ours by
 * marker means leftover duplicates from a failed sync never count as busy.
 * (Timed events only; all-day events are treated as free.)
 */
export async function getBusyAndOwned(
  cal: Calendar,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
): Promise<BusyAndOwned> {
  const busy: Interval[] = [];
  const owned: OwnedEvent[] = [];
  for (const calendarId of calendarIds) {
    let pageToken: string | undefined;
    do {
      const res = await withRetry(() =>
        cal.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          showDeleted: false,
          maxResults: 2500,
          pageToken,
        }),
      );
      for (const e of res.data.items ?? []) {
        if (e.status === "cancelled") continue;
        const priv = e.extendedProperties?.private;
        if (priv?.[OWNED_KEY] === OWNED_VAL) {
          const start = e.start?.dateTime;
          const end = e.end?.dateTime;
          if (e.id && start && end) {
            owned.push({
              id: e.id,
              taskId: priv[TASK_KEY] ?? "",
              chunkIndex: Number(priv.chunkIndex ?? "0"),
              startMs: Date.parse(start),
              endMs: Date.parse(end),
              summary: e.summary ?? "",
            });
          }
          continue; // ours: never counts as busy
        }
        if (e.transparency === "transparent") continue; // marked "free"
        if ((e.attendees ?? []).some((a) => a.self && a.responseStatus === "declined")) continue;
        const start = e.start?.dateTime;
        const end = e.end?.dateTime;
        if (start && end) busy.push({ start, end });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return { busy, owned };
}

/** Update the title/description of an event we own (for renames). */
export async function patchEvent(
  cal: Calendar,
  calendarId: string,
  eventId: string,
  fields: { summary?: string; description?: string },
): Promise<void> {
  await withRetry(() => cal.events.patch({ calendarId, eventId, requestBody: fields }));
}

/** Event ids we previously created in a calendar (found via our marker). */
export async function listOwnedEventIds(
  cal: Calendar,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() =>
      cal.events.list({
        calendarId,
        privateExtendedProperty: [`${OWNED_KEY}=${OWNED_VAL}`],
        singleEvents: true,
        showDeleted: false,
        maxResults: 2500,
        timeMin,
        timeMax,
        pageToken,
      }),
    );
    for (const e of res.data.items ?? []) if (e.id) ids.push(e.id);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

/** Delete events, tolerating already-gone ones (user may have deleted manually). */
export async function deleteEvents(cal: Calendar, calendarId: string, ids: string[]): Promise<void> {
  await mapLimit(ids, 5, async (id) => {
    try {
      await withRetry(() => cal.events.delete({ calendarId, eventId: id }));
    } catch (e: unknown) {
      const code = (e as { code?: number }).code;
      if (code === 404 || code === 410) return; // already gone — fine
      throw e;
    }
  });
}

export interface NewEvent {
  taskId: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  timeZone: string;
  chunkIndex: number;
}

/** Create one owned event; returns the Google event id. */
export async function insertEvent(
  cal: Calendar,
  calendarId: string,
  e: NewEvent,
): Promise<string> {
  const res = await withRetry(() =>
    cal.events.insert({
    calendarId,
    requestBody: {
      summary: e.summary,
      description: e.description,
      start: { dateTime: e.startIso, timeZone: e.timeZone },
      end: { dateTime: e.endIso, timeZone: e.timeZone },
      colorId: OUR_COLOR_ID,
      extendedProperties: {
        private: {
          [OWNED_KEY]: OWNED_VAL,
          [TASK_KEY]: e.taskId,
          chunkIndex: String(e.chunkIndex),
        },
      },
    },
    }),
  );
  return res.data.id!;
}

/** Insert many events with bounded concurrency; returns ids in input order. */
export async function insertEvents(
  cal: Calendar,
  calendarId: string,
  events: NewEvent[],
): Promise<string[]> {
  const ids: string[] = new Array(events.length);
  await mapLimit(events, 5, async (e, i) => {
    ids[i] = await insertEvent(cal, calendarId, e);
  });
  return ids;
}

// Retry Google's transient errors (rate limits, backend blips). Calendar API
// signals rate limiting with HTTP 403 + reason rateLimitExceeded/userRateLimitExceeded.
function isTransient(e: unknown): boolean {
  const err = e as { code?: number; response?: { status?: number }; errors?: { reason?: string }[] };
  const code = err.code ?? err.response?.status;
  const reason = err.errors?.[0]?.reason;
  if (code === 429) return true;
  if (typeof code === "number" && code >= 500) return true;
  if (code === 403 && (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded")) return true;
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || i === tries - 1) throw e;
      const delay = 300 * 2 ** i + Math.floor(Math.random() * 250); // 300, 600, 1200… + jitter
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// small concurrency limiter (googleapis has no first-class batch in node)
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}
