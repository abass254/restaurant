import { apiRoutes } from "./config";
import { isNavigationLoading, trackNavigationPromise } from "./navigation-loading";
import { shouldSuppressUnauthorizedEvents } from "./sessionGuardState";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrfReady = false;

/** Call after login/logout so the next mutation fetches a fresh CSRF cookie. */
export function resetCsrfCookie(): void {
  csrfReady = false;
  clearPageCache();
}

/**
 * In-memory snapshots of page data so revisiting a page renders the last result
 * instantly while it refreshes. Any mutation through {@link apiFetch} clears it,
 * so a snapshot never outlives a write (including merchant switches).
 */
const pageCache = new Map<string, unknown>();
const cachedGets = new Map<string, Promise<unknown>>();

export function readPageCache<T>(key: string): T | undefined {
  return pageCache.get(key) as T | undefined;
}

export function writePageCache(key: string, value: unknown): void {
  pageCache.set(key, value);
}

export function clearPageCache(): void {
  pageCache.clear();
  cachedGets.clear();
}

/** GET shared by every caller until the next mutation (e.g. merchant settings). */
export function apiFetchCached<T>(url: string): Promise<T> {
  let promise = cachedGets.get(url) as Promise<T> | undefined;
  if (!promise) {
    promise = apiFetch<T>(url);
    cachedGets.set(url, promise);
    promise.catch(() => {
      if (cachedGets.get(url) === promise) cachedGets.delete(url);
    });
  }
  return promise;
}

function parseApiErrorMessage(payload: unknown, status: number, fallback?: string): string {
  if (typeof payload === "string" && payload.trim()) {
    const text = payload.trim();
    if (text !== "Internal Server Error") {
      return text;
    }
  }

  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;

    if (typeof body.message === "string" && body.message) {
      return body.message;
    }

    const detail = body.detail;

    if (typeof detail === "string" && detail) {
      return detail;
    }

    if (Array.isArray(detail) && detail.length > 0) {
      // FastAPI/Pydantic validation error shape: detail is an array of issues.
      const first = detail[0] as { loc?: unknown[]; msg?: string };
      const field = Array.isArray(first.loc) ? first.loc.filter((x) => x !== "body").join(".") : "";
      const msg = typeof first.msg === "string" ? first.msg : "Invalid value";
      return field ? `${field}: ${msg}` : msg;
    }

    if (detail && typeof detail === "object") {
      const detailObj = detail as {
        message?: string;
        errors?: Record<string, string[]>;
        missing?: string[];
      };
      if (detailObj.message) {
        if (Array.isArray(detailObj.missing) && detailObj.missing.length) {
          return `${detailObj.message} ${detailObj.missing.join("; ")}.`;
        }
        return detailObj.message;
      }
      if (detailObj.errors) {
        const first = Object.values(detailObj.errors).flat()[0];
        if (first) {
          return first;
        }
      }
    }
  }

  return fallback ?? `Request failed (${status})`;
}

function serverErrorFallback(status: number, payload: unknown): string {
  if (status === 504) {
    return "The request timed out. Please try again shortly.";
  }
  if (status === 502 || status === 503) {
    return "The service is temporarily unavailable. Please try again shortly.";
  }
  if (typeof payload === "string" && payload.includes("Internal Server Error")) {
    return "The server encountered an unexpected error. Please try again shortly.";
  }
  return "The server took too long or returned an unexpected error. Please try again shortly.";
}

export async function ensureCsrfCookie(): Promise<void> {
  if (csrfReady) {
    return;
  }

  await fetch(apiRoutes.csrf, {
    credentials: "include",
  });

  csrfReady = true;
}

function xsrfToken(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);

  return match ? decodeURIComponent(match[1]) : null;
}

async function apiFetchOnce<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  // Auto-set JSON Content-Type for plain bodies. Crucially do NOT touch
  // multipart/FormData — the browser must set its own boundary header.
  const bodyIsFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!headers.has("Content-Type") && init.body && !bodyIsFormData) {
    headers.set("Content-Type", "application/json");
  }

  const token = xsrfToken();
  if (token) {
    headers.set("X-XSRF-TOKEN", token);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });

  const rawText = await response.text();
  let payload: unknown = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !shouldSuppressUnauthorizedEvents()
    ) {
      window.dispatchEvent(new CustomEvent("app:unauthorized"));
    }
    const fallback =
      response.status >= 500 && (payload == null || typeof payload === "string")
        ? serverErrorFallback(response.status, payload)
        : `Request failed (${response.status})`;
    throw new ApiError(parseApiErrorMessage(payload, response.status, fallback), response.status, payload);
  }

  return payload as T;
}

async function apiFetchInternal<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    await ensureCsrfCookie();
  }

  try {
    return await apiFetchOnce<T>(url, init);
  } catch (err) {
    const canRetryCsrf =
      err instanceof ApiError &&
      err.status === 403 &&
      err.message.toLowerCase().includes("csrf") &&
      method !== "GET" &&
      method !== "HEAD";

    if (!canRetryCsrf) {
      throw err;
    }

    resetCsrfCookie();
    await ensureCsrfCookie();
    return apiFetchOnce<T>(url, init);
  }
}

export function apiFetch<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const p = apiFetchInternal<T>(url, init);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    p.then(clearPageCache, clearPageCache);
  }
  if (typeof window !== "undefined" && isNavigationLoading()) {
    trackNavigationPromise(p);
  }
  return p;
}
