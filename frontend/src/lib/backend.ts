/** Server-side FastAPI base URL (never exposed to the browser). */
export const backendUrl =
  process.env.BACKEND_URL ?? "http://127.0.0.1:7001";

/** Thrown when Next.js cannot reach the FastAPI process (e.g. backend not started). */
export class BackendUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(`Cannot reach the API at ${backendUrl}.`);
    this.name = "BackendUnavailableError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code =
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    error.cause instanceof Error &&
    "code" in error.cause
      ? String((error.cause as NodeJS.ErrnoException).code)
      : "";
  return (
    error.message.includes("fetch failed") ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND"
  );
}

/** Server-side fetch to FastAPI; maps connection errors to {@link BackendUnavailableError}. */
export async function fetchBackend(
  path: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${backendUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BackendUnavailableError(
        new Error(`Request timed out after ${timeoutMs}ms`),
      );
    }
    if (isConnectionFailure(error)) {
      throw new BackendUnavailableError(error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

type ParsedCookie = {
  name: string;
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  maxAge?: number;
  path?: string;
};

export function parseSetCookie(header: string): ParsedCookie | null {
  const parts = header.split(";").map((p) => p.trim());
  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf("=");
  if (eq <= 0) {
    return null;
  }

  const name = nameValue.slice(0, eq);
  const value = nameValue.slice(eq + 1);
  const cookie: ParsedCookie = {
    name,
    value,
    path: "/",
    sameSite: "lax",
  };

  for (const attr of attrs) {
    const lower = attr.toLowerCase();
    if (lower === "httponly") {
      cookie.httpOnly = true;
    } else if (lower === "secure") {
      cookie.secure = true;
    } else if (lower.startsWith("path=")) {
      cookie.path = attr.slice(5);
    } else if (lower.startsWith("max-age=")) {
      cookie.maxAge = Number.parseInt(attr.slice(8), 10);
    } else if (lower === "samesite=lax") {
      cookie.sameSite = "lax";
    } else if (lower === "samesite=strict") {
      cookie.sameSite = "strict";
    } else if (lower === "samesite=none") {
      cookie.sameSite = "none";
    }
  }

  return cookie;
}

/** Merge Set-Cookie headers into a single Cookie request header. */
export function cookieHeaderFromSetCookies(setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const header of setCookies) {
    const parsed = parseSetCookie(header);
    if (parsed) {
      jar.set(parsed.name, parsed.value);
    }
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export function xsrfFromCookieHeader(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  if (!match) {
    return null;
  }
  return decodeURIComponent(match[1]);
}
