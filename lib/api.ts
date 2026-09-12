import { NextResponse } from "next/server";

export function errorResponse(e: unknown) {
  const status = (e as { status?: number })?.status ?? 500;
  const message = e instanceof Error ? e.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status });
}

/** Estimates are positive minutes, capped at 24h. */
export function clampEstimate(v: unknown, fallback = 30): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 24 * 60);
}
