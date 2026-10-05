import { getZonedClock } from "./scheduler-time";

export function getNextRunAt(schedule: unknown, timezone = "America/New_York", now = new Date(), lastRunAt: Date | null = null): Date | null {
  if (!schedule || typeof schedule !== "object" || !Number.isFinite(now.getTime())) return null;
  const data = schedule as Record<string, unknown>;
  if (data.kind === "interval") {
    const minutes = Number(data.everyMinutes);
    const candidate = new Date(now.getTime() + minutes * 60_000);
    return Number.isFinite(minutes) && minutes > 0 && Number.isFinite(candidate.getTime()) ? candidate : null;
  }
  if (data.kind !== "daily_time" && data.kind !== "weekly_time") return null;
  const hour = Number(data.hour ?? 0), minute = Number(data.minute ?? 0), weekday = Number(data.dayOfWeek ?? 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (data.kind === "weekly_time" && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) return null;
  try {
    const local = getZonedClock(now, timezone);
    const previous = lastRunAt && Number.isFinite(lastRunAt.getTime()) ? getZonedClock(lastRunAt, timezone) : null;
    for (let day = 0; day <= 8; day++) {
      const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day + day));
      if (previous && previous.year === calendar.getUTCFullYear() && previous.month === calendar.getUTCMonth() + 1 && previous.day === calendar.getUTCDate()) continue;
      if (data.kind === "weekly_time" && calendar.getUTCDay() !== weekday) continue;
      const target = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), calendar.getUTCDate(), hour, minute);
      // Offsets on either side of a transition cover both occurrences in a DST fold.
      const offsets = new Set<number>();
      for (const delta of [-86_400_000, 0, 86_400_000]) {
        const instant = target + delta;
        const clock = getZonedClock(new Date(instant), timezone);
        offsets.add(Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute) - instant);
      }
      const matches = [...offsets].map((offset) => new Date(target - offset)).filter((candidate) => {
        const clock = getZonedClock(candidate, timezone);
        return candidate > now && clock.year === calendar.getUTCFullYear() && clock.month === calendar.getUTCMonth() + 1
          && clock.day === calendar.getUTCDate() && clock.hour === hour && clock.minute === minute;
      }).sort((a, b) => a.getTime() - b.getTime());
      if (matches.length) return matches[0];
      // A nonexistent spring-forward minute is skipped, matching exact-clock jobs.
    }
  } catch { return null; }
  return null;
}
