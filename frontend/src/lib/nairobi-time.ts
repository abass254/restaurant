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
