import { DateTime } from "luxon";

/** "Mon 9:00" in the user's timezone. */
export function formatScheduledStart(iso: string, tz: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("ccc H:mm");
}

/** "45m", "1h", "1h 30m" */
export function formatEstimate(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const ESTIMATE_CHIPS = [15, 30, 60, 90, 120, 180];
