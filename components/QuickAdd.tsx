"use client";

import { useState } from "react";

export function QuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");

  function submit() {
    const t = value.trim();
    if (!t) return;
    onAdd(t);
    setValue("");
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
      }}
      placeholder="Add a task and press Enter…"
      className="w-full rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-neutral-400"
      autoComplete="off"
      enterKeyHint="done"
    />
  );
}
