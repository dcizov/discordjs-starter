/** Calendar-day chart data, serialized on the server and reused unchanged at hydration. */
export const activityRanges = [7, 14, 30] as const;
export type ActivityRange = (typeof activityRanges)[number];
export type ActivityCount = { key: string; events: number; members: number };
export type ActivityBucket = {
  key: string;
  label: string;
  events: number;
  members: number;
  previous: ActivityCount;
};
export type ActivitySnapshot = {
  referenceAt: string;
  timeZone: string;
  demo: boolean;
  ranges: Record<
    ActivityRange,
    { start: string; end: string; buckets: ActivityBucket[] }
  >;
};

export function chartTimeZone(value?: string) {
  if (value && !/^[+-]/.test(value)) {
    try {
      // IANA names/UTC only: SQL's POSIX numeric-offset convention has the
      // opposite sign from Intl's offset strings. Never accept that ambiguity.
      return new Intl.DateTimeFormat("en", {
        timeZone: value,
      }).resolvedOptions().timeZone;
    } catch {
      /* Legacy/invalid settings fail back to deterministic UTC, never the host zone. */
    }
  }
  return "UTC";
}
export function calendarKey(value: string | number | Date, timeZone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid activity timestamp");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: chartTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Add calendar dates, NOT 24-hour intervals to zoned instants (DST days vary in length). */
export function shiftCalendarKey(key: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Invalid activity day");
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}
export function activityWindowStart(referenceAt: string, timeZone: string) {
  return shiftCalendarKey(calendarKey(referenceAt, timeZone), -59);
}
export function aggregateActivityRecords(
  records: Array<{ type: string; createdAt: string; userId: string }>,
  referenceAt: string,
  timeZone: string
): ActivityCount[] {
  const ref = Date.parse(referenceAt),
    first = activityWindowStart(referenceAt, timeZone);
  const days = new Map<string, { events: number; users: Set<string> }>();
  for (const record of records) {
    const at = Date.parse(record.createdAt);
    if (record.type !== "activity" || !Number.isFinite(at) || at > ref)
      continue;
    const key = calendarKey(at, timeZone);
    if (key < first) continue;
    const day = days.get(key) ?? { events: 0, users: new Set<string>() };
    day.events++;
    day.users.add(record.userId);
    days.set(key, day);
  }
  return [...days].map(([key, day]) => ({
    key,
    events: day.events,
    members: day.users.size,
  }));
}
export function activitySnapshot(
  referenceAt: string,
  configuredTimeZone: string | undefined,
  counts: ActivityCount[],
  demo = false
): ActivitySnapshot {
  const timeZone = chartTimeZone(configuredTimeZone);
  const today = calendarKey(referenceAt, timeZone);
  const rows = new Map(counts.map((row) => [row.key, row]));
  const read = (key: string): ActivityCount => {
    if (demo) {
      // Explicit sample data only. Stable across requests/ranges for a given day.
      const index = Number(key.replaceAll("-", "")) % 7;
      const events = [390, 590, 475, 715, 640, 320, 465][index];
      return { key, events, members: Math.floor(events * 0.63) };
    }
    return rows.get(key) ?? { key, events: 0, members: 0 };
  };
  const ranges = {} as ActivitySnapshot["ranges"];
  for (const days of activityRanges) {
    const buckets = Array.from({ length: days }, (_, index) => {
      const key = shiftCalendarKey(today, index - days + 1);
      // Format a calendar key as a date, not as an instant in the browser's zone.
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      }).format(new Date(`${key}T12:00:00Z`));
      return {
        ...read(key),
        label,
        previous: read(shiftCalendarKey(key, -days)),
      };
    });
    ranges[days] = { start: buckets[0].key, end: today, buckets };
  }
  return { referenceAt, timeZone, demo, ranges };
}
