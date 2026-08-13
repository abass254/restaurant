/** Normalize API/DB timestamps to a UTC instant (naive values are treated as UTC). */
export function normalizeIso(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return trimmed;
  if (/[Zz]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const withT = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  return withT.endsWith('Z') ? withT : `${withT}Z`;
}

export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(normalizeIso(iso));
  return Number.isNaN(date.getTime()) ? null : date;
}
