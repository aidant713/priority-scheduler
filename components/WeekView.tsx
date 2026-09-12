"use client";

import { DateTime } from "luxon";
import type { BlockRow } from "@/lib/types";

export interface BusyInterval {
  start: string;
  end: string;
  summary?: string;
}

interface Item {
  start: string;
  end: string;
  label: string;
  mine: boolean;
}

// Read-only agenda: our scheduled blocks (colour) + existing events (grey),
// grouped by day in the user's timezone. Confidence view only — no editing.
export function WeekView({
  blocks,
  busy,
  settings,
}: {
  blocks: BlockRow[];
  busy: BusyInterval[];
  settings: { timezone: string };
}) {
  const tz = settings.timezone;

  const items: Item[] = [
    ...blocks.map((b) => ({ start: b.start_at, end: b.end_at, label: "Scheduled task", mine: true })),
    ...busy.map((b) => ({ start: b.start, end: b.end, label: b.summary ?? "Busy", mine: false })),
  ].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const byDay = new Map<string, Item[]>();
  for (const it of items) {
    const day = DateTime.fromISO(it.start, { zone: "utc" }).setZone(tz).toFormat("cccc d LLL");
    const list = byDay.get(day);
    if (list) list.push(it);
    else byDay.set(day, [it]);
  }

  const fmt = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("H:mm");

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-neutral-500">Week preview</h2>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400">Nothing scheduled yet.</p>
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {day}
              </div>
              <ul className="space-y-1">
                {list.map((it, i) => (
                  <li
                    key={i}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                      it.mine ? "bg-block/10 text-block" : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    <span className="tabular-nums">
                      {fmt(it.start)}–{fmt(it.end)}
                    </span>
                    <span className="truncate">{it.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
