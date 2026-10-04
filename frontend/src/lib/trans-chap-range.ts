import { NAIROBI_TZ, nairobiDateKey } from "@/lib/nairobi-time";

export type RangePreset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "month"
  | "all"
  | "custom";

/** Inclusive Nairobi calendar-day range (YYYY-MM-DD keys). */
export type DateRange = { preset: RangePreset; from: string; to: string };

export type ChartBucket = {
  key: string;
  label: string;
  sales: number;
  purchases: number;
};

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "7 days",
  "30d": "30 days",
  month: "This month",
  all: "All time",
  custom: "Custom",
};

export const MAX_CUSTOM_RANGE_DAYS = 366;

const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: NAIROBI_TZ,
  hour: "2-digit",
  hourCycle: "h23",
});

const dayLabelFormat = new Intl.DateTimeFormat("en-KE", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const monthLabelFormat = new Intl.DateTimeFormat("en-KE", {
  timeZone: "UTC",
  month: "short",
  year: "2-digit",
});

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function dayLabel(key: string): string {
  return dayLabelFormat.format(new Date(`${key}T00:00:00Z`));
}

function monthLabel(monthKey: string): string {
  return monthLabelFormat.format(new Date(`${monthKey}-01T00:00:00Z`));
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * Resolve a preset to concrete dates. `earliestKey` is the oldest day with
 * data and is only used by the "all" preset.
 */
export function rangeForPreset(
  preset: Exclude<RangePreset, "custom">,
  todayKey: string,
  earliestKey?: string | null,
): DateRange {
  switch (preset) {
    case "yesterday": {
      const key = addDays(todayKey, -1);
      return { preset, from: key, to: key };
    }
    case "7d":
      return { preset, from: addDays(todayKey, -6), to: todayKey };
    case "30d":
      return { preset, from: addDays(todayKey, -29), to: todayKey };
    case "month":
      return { preset, from: `${todayKey.slice(0, 8)}01`, to: todayKey };
    case "all":
      return {
        preset,
        from: earliestKey && earliestKey < todayKey ? earliestKey : todayKey,
        to: todayKey,
      };
    default:
      return { preset, from: todayKey, to: todayKey };
  }
}

export function rangeLabel(range: DateRange, todayKey: string): string {
  switch (range.preset) {
    case "today":
      return "today";
    case "yesterday":
      return "yesterday";
    case "7d":
      return "last 7 days";
    case "30d":
      return "last 30 days";
    case "month":
      return "this month";
    case "all":
      return "all time";
    default:
      if (range.from === range.to) {
        return range.from === todayKey ? "today" : `on ${dayLabel(range.from)}`;
      }
      return `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
  }
}

export function inRange(when: Date | null, range: DateRange): when is Date {
  if (!when) return false;
  const key = nairobiDateKey(when);
  return key >= range.from && key <= range.to;
}

/** Hourly for one day, daily up to ~2 months, monthly beyond that. */
export function buildChartBuckets(
  range: DateRange,
  sales: { when: Date; total: number }[],
  purchases: { when: Date; total: number }[],
): ChartBucket[] {
  if (range.from === range.to) {
    const hourOf = (d: Date) => Number(hourFormat.format(d)) % 24;
    const hours = [...sales, ...purchases].map((row) => hourOf(row.when));
    const start = Math.min(8, ...hours);
    const end = Math.max(18, ...hours);
    const buckets: ChartBucket[] = [];
    for (let h = start; h <= end; h += 1) {
      buckets.push({ key: String(h), label: hourLabel(h), sales: 0, purchases: 0 });
    }
    for (const row of sales) buckets[hourOf(row.when) - start].sales += row.total;
    for (const row of purchases) buckets[hourOf(row.when) - start].purchases += row.total;
    return buckets;
  }

  const monthly = daysBetween(range.from, range.to) > 62;
  const keyOf = (dayKey: string) => (monthly ? dayKey.slice(0, 7) : dayKey);
  const buckets: ChartBucket[] = [];
  const index = new Map<string, ChartBucket>();
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const key = keyOf(day);
    if (index.has(key)) continue;
    const bucket = {
      key,
      label: monthly ? monthLabel(key) : dayLabel(key),
      sales: 0,
      purchases: 0,
    };
    buckets.push(bucket);
    index.set(key, bucket);
  }
  for (const row of sales) {
    const bucket = index.get(keyOf(nairobiDateKey(row.when)));
    if (bucket) bucket.sales += row.total;
  }
  for (const row of purchases) {
    const bucket = index.get(keyOf(nairobiDateKey(row.when)));
    if (bucket) bucket.purchases += row.total;
  }
  return buckets;
}
