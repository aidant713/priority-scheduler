"use client";

import { useState } from "react";
import { DateTime } from "luxon";

export interface CompletedTask {
  id: string;
  title: string;
  updated_at: string;
}

export function CompletedList({ initial, tz }: { initial: CompletedTask[]; tz: string }) {
  const [tasks, setTasks] = useState(initial);

  async function restore(id: string) {
    setTasks((p) => p.filter((t) => t.id !== id)); // optimistic
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "todo" }),
    });
  }

  async function del(id: string) {
    setTasks((p) => p.filter((t) => t.id !== id));
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  }

  if (tasks.length === 0) {
    return <p className="py-10 text-center text-sm text-neutral-400">No completed tasks yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {tasks.map((t) => (
        <li
          key={t.id}
          className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-neutral-700 line-through decoration-neutral-300">
              {t.title}
            </div>
            <div className="text-xs text-neutral-400">
              {DateTime.fromISO(t.updated_at, { zone: "utc" }).setZone(tz).toFormat("ccc d LLL, H:mm")}
            </div>
          </div>
          <button
            onClick={() => restore(t.id)}
            className="rounded px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
            title="Move back to the active list"
          >
            Restore
          </button>
          <button
            onClick={() => del(t.id)}
            className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-red-50 hover:text-red-500"
            title="Delete permanently"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
