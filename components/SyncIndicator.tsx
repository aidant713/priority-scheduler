"use client";

export type SyncState = "idle" | "syncing" | "synced" | "error";

const LABEL: Record<SyncState, string> = {
  idle: "Up to date",
  syncing: "Syncing…",
  synced: "Synced",
  error: "Sync failed",
};

const DOT: Record<SyncState, string> = {
  idle: "bg-neutral-400",
  syncing: "bg-amber-500 animate-pulse",
  synced: "bg-emerald-500",
  error: "bg-red-500",
};

export function SyncIndicator({
  state,
  onRetry,
  errorMsg,
}: {
  state: SyncState;
  onRetry: () => void;
  errorMsg?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span className={`inline-block h-2 w-2 rounded-full ${DOT[state]}`} />
      <span title={state === "error" ? errorMsg : undefined}>{LABEL[state]}</span>
      {state === "error" && (
        <button onClick={onRetry} className="font-medium text-red-600 underline underline-offset-2">
          retry
        </button>
      )}
    </div>
  );
}
