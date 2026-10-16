import { apiFetch } from "@/lib/api";

type PagedResponse<T> = { data: T[]; meta: { last_page: number } };

export type TimeWindow = { since?: string; until?: string };

/** `&since=…&until=…` suffix for list endpoints that accept a time window. */
export function timeWindowQuery(window?: TimeWindow): string {
  let query = "";
  if (window?.since) query += `&since=${encodeURIComponent(window.since)}`;
  if (window?.until) query += `&until=${encodeURIComponent(window.until)}`;
  return query;
}

/** Kept low so one list load cannot exhaust the API's small DB connection pool. */
const PAGE_CONCURRENCY = 3;

/**
 * Load every page of a paginated list: page 1 first (to learn `last_page`), then
 * the rest in parallel. On failure, returns the contiguous pages loaded so far.
 */
export async function fetchAllPages<T>(
  pageUrl: (page: number) => string,
  maxPages: number,
): Promise<{ rows: T[]; failed: boolean; truncated: boolean }> {
  let first: PagedResponse<T>;
  try {
    first = await apiFetch<PagedResponse<T>>(pageUrl(1));
  } catch {
    return { rows: [], failed: true, truncated: false };
  }

  const lastPage = Math.min(first.meta.last_page, maxPages);
  const truncated = first.meta.last_page > maxPages;
  const pages: (T[] | undefined)[] = [first.data];
  let failed = false;
  let next = 2;

  async function worker() {
    while (!failed && next <= lastPage) {
      const page = next;
      next += 1;
      try {
        const data = await apiFetch<PagedResponse<T>>(pageUrl(page));
        pages[page - 1] = data.data;
      } catch {
        failed = true;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PAGE_CONCURRENCY, Math.max(0, lastPage - 1)) }, worker),
  );

  const rows: T[] = [];
  for (const page of pages) {
    if (!page) break;
    rows.push(...page);
  }
  return { rows, failed, truncated: failed ? false : truncated };
}
