"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ESTIMATE_CHIPS, formatEstimate } from "@/lib/format";

export interface RowTask {
  id: string;
  title: string;
  estimate_minutes: number;
  deadline: string | null;
}

export function TaskRow({
  task,
  tz,
  scheduledLabel,
  overdueRisk,
  onRename,
  onEstimate,
  onDeadline,
  onDone,
  onDelete,
}: {
  task: RowTask;
  tz: string;
  scheduledLabel?: string;
  overdueRisk: boolean;
  onRename: (title: string) => void;
  onEstimate: (minutes: number) => void;
  onDeadline: (dateStr: string | null) => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [custom, setCustom] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [showDue, setShowDue] = useState(false);

  const style = { transform: CSS.Transform.toString(transform), transition };

  const dd = task.deadline ? DateTime.fromISO(task.deadline, { zone: "utc" }).setZone(tz) : null;
  const dueValue = dd ? dd.toFormat("yyyy-LL-dd") : "";
  const dueDisplay = dd ? dd.toFormat("d LLL") : null;

  function commitCustom() {
    const n = Math.round(Number(custom));
    if (Number.isFinite(n) && n > 0) {
      onEstimate(n);
      setEditingEstimate(false);
      setCustom("");
    }
  }

  function commitTitle() {
    const t = titleDraft.trim();
    if (t && t !== task.title) onRename(t);
    else setTitleDraft(task.title);
    setEditingTitle(false);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder (or focus and use arrow keys)"
        className="mt-0.5 cursor-grab touch-none select-none px-1 text-neutral-400 hover:text-neutral-600"
      >
        ⠿
      </button>

      <div className="min-w-0 flex-1">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleDraft(task.title);
                setEditingTitle(false);
              }
            }}
            onBlur={commitTitle}
            className="w-full rounded border border-neutral-300 px-2 py-0.5 text-sm outline-none focus:border-neutral-500"
          />
        ) : (
          <button
            onClick={() => {
              setTitleDraft(task.title);
              setEditingTitle(true);
            }}
            className="block max-w-full truncate text-left text-sm font-medium hover:text-neutral-600"
            title="Click to rename"
          >
            {task.title}
          </button>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button
            onClick={() => setEditingEstimate((v) => !v)}
            className="whitespace-nowrap rounded bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700 hover:bg-neutral-200"
          >
            {formatEstimate(task.estimate_minutes)}
          </button>
          {scheduledLabel && (
            <span className="whitespace-nowrap text-neutral-400">{scheduledLabel}</span>
          )}
          {dueDisplay ? (
            <span
              className={`flex items-center gap-1 whitespace-nowrap ${
                overdueRisk ? "text-amber-600" : "text-neutral-500"
              }`}
            >
              <button
                onClick={() => setShowDue((v) => !v)}
                title={overdueRisk ? "Scheduled to finish after its due date" : "Change due date"}
              >
                {overdueRisk ? "⚠ " : ""}due {dueDisplay}
              </button>
              <button
                onClick={() => onDeadline(null)}
                title="Clear due date"
                className="text-neutral-300 hover:text-red-500"
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              onClick={() => setShowDue((v) => !v)}
              className="whitespace-nowrap text-neutral-400 hover:text-neutral-600"
            >
              + due date
            </button>
          )}
        </div>

        {showDue && (
          <div className="mt-2">
            <input
              type="date"
              value={dueValue}
              onChange={(e) => {
                onDeadline(e.target.value || null);
                setShowDue(false);
              }}
              className="rounded border border-neutral-200 px-2 py-0.5 text-xs"
            />
          </div>
        )}

        {editingEstimate && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {ESTIMATE_CHIPS.map((m) => (
              <button
                key={m}
                onClick={() => {
                  onEstimate(m);
                  setEditingEstimate(false);
                }}
                className={`rounded px-2 py-0.5 text-xs ${
                  m === task.estimate_minutes
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {m}m
              </button>
            ))}
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitCustom()}
              onBlur={commitCustom}
              inputMode="numeric"
              placeholder="min"
              className="w-16 rounded border border-neutral-200 px-2 py-0.5 text-xs outline-none focus:border-neutral-400"
            />
          </div>
        )}
      </div>

      {/* explicit actions — no ambiguous checkbox */}
      <button
        onClick={onDone}
        title="Mark done (removes it from the list)"
        aria-label="Mark done"
        className="mt-0.5 rounded px-1.5 text-neutral-400 hover:bg-emerald-50 hover:text-emerald-600"
      >
        ✓
      </button>
      <button
        onClick={onDelete}
        title="Delete task"
        aria-label="Delete task"
        className="mt-0.5 rounded px-1.5 text-neutral-300 hover:bg-red-50 hover:text-red-500"
      >
        ✕
      </button>
    </li>
  );
}
