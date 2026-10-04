export const NAIROBI_TZ = "Africa/Nairobi";
export const KENYA_LOCALE = "en-KE";

const timeOptions: Intl.DateTimeFormatOptions = {
  timeZone: NAIROBI_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

const listDateOptions: Intl.DateTimeFormatOptions = {
  timeZone: NAIROBI_TZ,
  month: "short",
  day: "numeric",
};

const feedDateOptions: Intl.DateTimeFormatOptions = {
  timeZone: NAIROBI_TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const dayLabelOptions: Intl.DateTimeFormatOptions = {
  timeZone: NAIROBI_TZ,
  weekday: "long",
  month: "short",
  day: "numeric",
};

const dateOptions: Intl.DateTimeFormatOptions = {
  timeZone: NAIROBI_TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
};

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: NAIROBI_TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

/** Normalize API/DB timestamps to a UTC instant (naive values are treated as UTC). */
export function normalizeIso(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/[Zz]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const withT = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  return withT.endsWith("Z") ? withT : `${withT}Z`;
}

export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(normalizeIso(iso));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar date in Nairobi (YYYY-MM-DD). */
export function nairobiDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NAIROBI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** True when `key` falls within the last `days` Nairobi calendar days, today included. */
export function isWithinLastDays(key: string, days: number, todayKey: string): boolean {
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const [ky, km, kd] = key.split("-").map(Number);
  const diff =
    (Date.UTC(ty, tm - 1, td) - Date.UTC(ky, km - 1, kd)) / 86_400_000;
  return diff >= 0 && diff < days;
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function formatNairobiTime(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) {
    return "";
  }
  return date.toLocaleTimeString(KENYA_LOCALE, timeOptions);
}

export function formatNairobiDate(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) {
    return "";
  }
  return date.toLocaleDateString(KENYA_LOCALE, dateOptions);
}

export function formatNairobiDateTime(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) {
    return "";
  }
  return date.toLocaleString(KENYA_LOCALE, dateTimeOptions);
}

const stamp24Format = new Intl.DateTimeFormat("en-GB", {
  timeZone: NAIROBI_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Nairobi time as `HH:mm dd/mm/yyyy` (24-hour), e.g. `14:05 03/10/2026`. */
export function formatNairobiStamp24(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) {
    return "";
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    stamp24Format.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("day")}/${part("month")}/${part("year")}`;
}

export function formatNairobiListTime(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) {
    return "";
  }
  const messageDay = nairobiDateKey(date);
  const today = nairobiDateKey(new Date());
  if (messageDay === today) {
    return formatNairobiTime(iso);
  }
  return date.toLocaleDateString(KENYA_LOCALE, listDateOptions);
}

export function formatNairobiFeedDate(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) {
    return "";
  }
  return date.toLocaleDateString(KENYA_LOCALE, feedDateOptions);
}

export function formatNairobiDayLabel(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) {
    return "Earlier";
  }
  const messageDay = nairobiDateKey(date);
  const today = nairobiDateKey(new Date());
  if (messageDay === today) {
    return "Today";
  }
  if (messageDay === shiftDateKey(today, -1)) {
    return "Yesterday";
  }
  return date.toLocaleDateString(KENYA_LOCALE, dayLabelOptions);
}

export function nairobiRelativeTimeFormatter(): Intl.RelativeTimeFormat {
  return new Intl.RelativeTimeFormat(KENYA_LOCALE, { numeric: "auto" });
}
