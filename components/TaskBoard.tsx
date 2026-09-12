"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatScheduledStart } from "@/lib/format";
import type { TaskRow as Task, BlockRow } from "@/lib/types";
import { QuickAdd } from "./QuickAdd";
import { TaskList, type ScheduleInfo } from "./TaskList";
import { SyncIndicator, type SyncState } from "./SyncIndicator";

export interface ClientSettings {
  timezone: string;
  work_days: number[];
  work_start: string;
  work_end: string;
}

const H = { "content-type": "application/json" };
interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
}

export default function TaskBoard({
  initialTasks,
  initialBlocks,
  settings,
  googleConnected,
  userEmail,
}: {
  initialTasks: Task[];
  initialBlocks: BlockRow[];
  settings: ClientSettings;
  googleConnected: boolean;
  userEmail: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [blocks, setBlocks] = useState<BlockRow[]>(initialBlocks);
  const [sync, setSync] = useState<SyncState>("idle");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncing = useRef(false);
  const pendingSync = useRef(false);
  const runSyncRef = useRef<() => void>();

  const undoStack = useRef<UndoEntry[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);

  const tz = settings.timezone;

  const info = useMemo<Record<string, ScheduleInfo>>(() => {
    const span: Record<string, { start?: string; end?: string }> = {};
    for (const b of blocks) {
      const cur = span[b.task_id] ?? {};
      if (!cur.start || b.start_at < cur.start) cur.start = b.start_at;
      if (!cur.end || b.end_at > cur.end) cur.end = b.end_at;
      span[b.task_id] = cur;
    }
    const out: Record<string, ScheduleInfo> = {};
    for (const t of tasks) {
      const s = span[t.id];
      out[t.id] = {
        label: s?.start ? formatScheduledStart(s.start, tz) : undefined,
        overdueRisk: !!(t.deadline && s?.end && s.end > t.deadline),
      };
    }
    return out;
  }, [blocks, tasks, tz]);

  const runSync = useCallback(async () => {
    // never overlap syncs — if one's running, coalesce into a single follow-up
    if (syncing.current) {
      pendingSync.current = true;
      return;
    }
    syncing.current = true;
    setSync("syncing");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setBlocks(data.blocks ?? []);
      setSync("synced");
    } catch {
      setSync("error");
    } finally {
      syncing.current = false;
      if (pendingSync.current) {
        pendingSync.current = false;
        runSyncRef.current?.();
      }
    }
  }, []);
  runSyncRef.current = runSync;

  const scheduleSync = useCallback(() => {
    if (!googleConnected) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(runSync, 800);
  }, [googleConnected, runSync]);

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > 25) undoStack.current.shift();
    setUndoLabel(entry.label);
  }, []);

  const doUndo = useCallback(async () => {
    const entry = undoStack.current.pop();
    setUndoLabel(undoStack.current[undoStack.current.length - 1]?.label ?? null);
    if (!entry) return;
    try {
      await entry.undo();
    } catch {
      setSync("error");
    }
    scheduleSync();
  }, [scheduleSync]);

  // ── mutations (optimistic; persist; push an inverse; debounce a resync) ────
  const addTask = useCallback(
    async (title: string) => {
      const res = await fetch("/api/tasks", { method: "POST", headers: H, body: JSON.stringify({ title }) });
      if (!res.ok) return;
      const { task } = await res.json();
      setTasks((prev) => [...prev, task]);
      pushUndo({
        label: `Add "${title}"`,
        undo: async () => {
          setTasks((p) => p.filter((t) => t.id !== task.id));
          await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
        },
      });
      scheduleSync();
    },
    [pushUndo, scheduleSync],
  );

  const reorder = useCallback(
    async (ordered: Task[]) => {
      const prev = tasks;
      setTasks(ordered);
      const res = await fetch("/api/tasks/reorder", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ orderedIds: ordered.map((t) => t.id) }),
      });
      if (!res.ok) {
        setTasks(prev);
        setSync("error");
        return;
      }
      pushUndo({
        label: "Reorder",
        undo: async () => {
          setTasks(prev);
          await fetch("/api/tasks/reorder", {
            method: "POST",
            headers: H,
            body: JSON.stringify({ orderedIds: prev.map((t) => t.id) }),
          });
        },
      });
      scheduleSync();
    },
    [tasks, pushUndo, scheduleSync],
  );

  const renameTask = useCallback(
    async (id: string, title: string) => {
      const prev = tasks;
      const old = prev.find((t) => t.id === id)?.title ?? "";
      setTasks((p) => p.map((t) => (t.id === id ? { ...t, title } : t)));
      const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ title }) });
      if (!res.ok) {
        setTasks(prev);
        setSync("error");
        return;
      }
      pushUndo({
        label: "Rename",
        undo: async () => {
          setTasks((p) => p.map((t) => (t.id === id ? { ...t, title: old } : t)));
          await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ title: old }) });
        },
      });
      scheduleSync();
    },
    [tasks, pushUndo, scheduleSync],
  );

  const setEstimate = useCallback(
    async (id: string, minutes: number) => {
      const prev = tasks;
      const old = prev.find((t) => t.id === id)?.estimate_minutes ?? 30;
      setTasks((p) => p.map((t) => (t.id === id ? { ...t, estimate_minutes: minutes } : t)));
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ estimateMinutes: minutes }),
      });
      if (!res.ok) {
        setTasks(prev);
        setSync("error");
        return;
      }
      pushUndo({
        label: "Change estimate",
        undo: async () => {
          setTasks((p) => p.map((t) => (t.id === id ? { ...t, estimate_minutes: old } : t)));
          await fetch(`/api/tasks/${id}`, {
            method: "PATCH",
            headers: H,
            body: JSON.stringify({ estimateMinutes: old }),
          });
        },
      });
      scheduleSync();
    },
    [tasks, pushUndo, scheduleSync],
  );

  const setDeadline = useCallback(
    async (id: string, dateStr: string | null) => {
      const prev = tasks;
      const old = prev.find((t) => t.id === id)?.deadline ?? null;
      // interpret the picked date as end-of-day in the user's timezone
      const deadline = dateStr
        ? DateTime.fromISO(dateStr, { zone: tz }).endOf("day").toUTC().toISO()
        : null;
      setTasks((p) => p.map((t) => (t.id === id ? { ...t, deadline } : t)));
      const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ deadline }) });
      if (!res.ok) {
        setTasks(prev);
        setSync("error");
        return;
      }
      pushUndo({
        label: "Change due date",
        undo: async () => {
          setTasks((p) => p.map((t) => (t.id === id ? { ...t, deadline: old } : t)));
          await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ deadline: old }) });
        },
      });
      // deadlines don't change the schedule (advisory only), so no resync needed
    },
    [tasks, tz, pushUndo],
  );

  const removeTask = useCallback(
    async (id: string, mode: "done" | "delete") => {
      const prev = tasks;
      const removed = prev.find((t) => t.id === id);
      if (!removed) return;
      setTasks((p) => p.filter((t) => t.id !== id));
      const res =
        mode === "done"
          ? await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "done" }) })
          : await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setTasks(prev);
        setSync("error");
        return;
      }
      const prevIds = prev.map((t) => t.id);
      pushUndo({
        label: mode === "done" ? `Mark done "${removed.title}"` : `Delete "${removed.title}"`,
        undo: async () => {
          setTasks(prev); // optimistic
          if (mode === "done") {
            await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "todo" }) });
            await fetch("/api/tasks/reorder", { method: "POST", headers: H, body: JSON.stringify({ orderedIds: prevIds }) });
          } else {
            const r = await fetch("/api/tasks", {
              method: "POST",
              headers: H,
              body: JSON.stringify({
                title: removed.title,
                estimateMinutes: removed.estimate_minutes,
                notes: removed.notes,
                deadline: removed.deadline,
              }),
            });
            if (!r.ok) return;
            const { task: recreated } = await r.json();
            const restored = prev.map((t) => (t.id === id ? recreated : t));
            setTasks(restored);
            await fetch("/api/tasks/reorder", {
              method: "POST",
              headers: H,
              body: JSON.stringify({ orderedIds: restored.map((t) => t.id) }),
            });
          }
        },
      });
      scheduleSync();
    },
    [tasks, pushUndo, scheduleSync],
  );

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <header className="mb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Priority Scheduler</h1>
            <p className="truncate text-xs text-neutral-400">{userEmail}</p>
          </div>
          <SyncIndicator state={sync} onRetry={runSync} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={doUndo}
            disabled={!undoLabel}
            title={undoLabel ? `Undo: ${undoLabel}` : "Nothing to undo"}
            className="whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 enabled:hover:bg-neutral-50 disabled:opacity-40"
          >
            ↶ Undo
          </button>
          <Link
            href="/completed"
            className="whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Completed
          </Link>
          <Link
            href="/settings"
            className="whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Settings
          </Link>
          <button
            onClick={signOut}
            className="whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Sign out
          </button>
        </div>
      </header>

      {!googleConnected && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Google Calendar isn&apos;t connected yet — connect it from{" "}
          <Link href="/settings" className="font-medium underline">
            Settings
          </Link>{" "}
          to enable auto-scheduling.
        </div>
      )}

      <section>
        <div className="mb-3">
          <QuickAdd onAdd={addTask} />
        </div>
        <TaskList
          tasks={tasks}
          tz={tz}
          info={info}
          onReorder={reorder}
          onRename={renameTask}
          onEstimate={setEstimate}
          onDeadline={setDeadline}
          onDone={(id) => removeTask(id, "done")}
          onDelete={(id) => removeTask(id, "delete")}
        />
      </section>
    </main>
  );
}
