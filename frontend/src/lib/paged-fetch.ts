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

export type PageProgressMeta = { isFirstPage: boolean; done: boolean; totalPages: number };
export type PageProgressCallback<T> = (rows: T[], meta: PageProgressMeta) => void;

/**
 * Load pages of a paginated list: page 1 first (to learn `last_page`), then
 * the rest in parallel. On failure, returns the contiguous pages loaded so far.
 * If `onProgress` is supplied, it is called as soon as page 1 arrives so callers
 * can render the first batch immediately without blocking on the whole fetch.
 * If `shouldStop` is supplied, it stops fetching further pages early when true.
 */
export async function fetchAllPages<T>(
  pageUrl: (page: number) => string,
  maxPages: number,
  onProgress?: PageProgressCallback<T>,
  shouldStop?: (pageRows: T[], pageNumber: number, allRowsSoFar: T[]) => boolean,
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

  const stopAfterFirst = shouldStop?.(first.data, 1, first.data) ?? false;

  onProgress?.(first.data, {
    isFirstPage: true,
    done: lastPage <= 1 || stopAfterFirst,
    totalPages: lastPage,
  });

  if (lastPage <= 1 || stopAfterFirst) {
    return { rows: first.data, failed: false, truncated: false };
  }

  let failed = false;
  let stopped = false;
  let next = 2;

  async function worker() {
    while (!failed && !stopped && next <= lastPage) {
      const page = next;
      next += 1;
      try {
        const data = await apiFetch<PagedResponse<T>>(pageUrl(page));
        pages[page - 1] = data.data;

        if (
          shouldStop?.(
            data.data,
            page,
            pages.filter((p): p is T[] => Boolean(p)).flat(),
          )
        ) {
          stopped = true;
          break;
        }
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

  onProgress?.(rows, {
    isFirstPage: false,
    done: true,
    totalPages: lastPage,
  });

  return { rows, failed, truncated: failed ? false : stopped ? false : truncated };
}

export async function fetchSinglePage<T>(
  url: string,
): Promise<{ rows: T[]; lastPage: number; total: number; failed: boolean }> {
  try {
    const res = await apiFetch<PagedResponse<T> & { meta: { total?: number } }>(url);
    return {
      rows: res.data,
      lastPage: res.meta.last_page,
      total: res.meta.total ?? 0,
      failed: false,
    };
  } catch {
    return { rows: [], lastPage: 1, total: 0, failed: true };
  }
}
