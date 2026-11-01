import http from "node:http";
import { format } from "node:util";

export type CapturedRequest = {
  ts: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  ip: string | null;
  proxied: boolean;
};

export type CapturedLog = {
  ts: string;
  level: "debug" | "info" | "warning" | "error";
  logger: string;
  message: string;
};

type LogStore = {
  installed: boolean;
  startedAt: string;
  requests: CapturedRequest[];
  logs: CapturedLog[];
};

export const REQUEST_CAPACITY = 2000;
export const LOG_CAPACITY = 2000;
const MAX_MESSAGE_CHARS = 4000;
const MAX_PATH_CHARS = 300;

// Must match the rewrites in next.config.ts; those requests are served by FastAPI.
const PROXIED_PREFIXES = [
  "/api/",
  "/auth/",
  "/sanctum/",
  "/webhooks/",
  "/mpesa/",
  "/uploads/",
  "/instagram/callback",
  "/robots.txt",
  "/test",
];
// Build assets, HMR and the dashboard's own polling would bury real traffic.
const IGNORED_PREFIXES = ["/_next/", "/__nextjs", "/internal/logs"];
const SENSITIVE_QUERY = /\b((?:access_)?token|code|secret|password|signature|key|otp)=([^&]*)/gi;
const ANSI = /\x1b\[[0-9;]*m/g;

// Route handlers and instrumentation are bundled separately; globalThis is the
// only place they share state within the Next server process.
const STORE_KEY = Symbol.for("TransChap.logCapture");

export function getLogStore(): LogStore {
  const g = globalThis as unknown as Record<symbol, LogStore | undefined>;
  let store = g[STORE_KEY];
  if (!store) {
    store = {
      installed: false,
      startedAt: new Date().toISOString(),
      requests: [],
      logs: [],
    };
    g[STORE_KEY] = store;
  }
  return store;
}

function push<T>(list: T[], item: T, capacity: number) {
  list.push(item);
  if (list.length > capacity) list.splice(0, list.length - capacity);
}

export function recordLog(level: CapturedLog["level"], logger: string, message: string) {
  push(
    getLogStore().logs,
    {
      ts: new Date().toISOString(),
      level,
      logger,
      message: message.replace(ANSI, "").slice(0, MAX_MESSAGE_CHARS),
    },
    LOG_CAPACITY,
  );
}

function cleanPath(rawUrl: string): string {
  const [pathname, query = ""] = rawUrl.split("?", 2);
  const params = query
    .split("&")
    .filter((part) => part && !part.startsWith("_rsc="))
    .join("&")
    .replace(SENSITIVE_QUERY, "$1=***");
  return (params ? `${pathname}?${params}` : pathname).slice(0, MAX_PATH_CHARS);
}

function clientIp(req: http.IncomingMessage): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(",")[0].trim() || req.socket.remoteAddress || null;
}

function patchHttpServer() {
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emit(
    this: http.Server,
    event: string | symbol,
    ...args: unknown[]
  ) {
    if (event === "request") {
      const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
      const url = req.url ?? "/";
      if (!IGNORED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
        const start = performance.now();
        res.once("close", () => {
          push(
            getLogStore().requests,
            {
              ts: new Date().toISOString(),
              method: req.method ?? "GET",
              path: cleanPath(url),
              status: res.headersSent ? res.statusCode : 499,
              duration_ms: Math.round((performance.now() - start) * 10) / 10,
              ip: clientIp(req),
              proxied: PROXIED_PREFIXES.some(
                (prefix) => url === prefix.replace(/\/$/, "") || url.startsWith(prefix),
              ),
            },
            REQUEST_CAPACITY,
          );
        });
      }
    }
    return originalEmit.apply(this, [event, ...args] as Parameters<typeof originalEmit>);
  } as typeof originalEmit;
}

function patchConsole() {
  const levels: Array<[keyof Console, CapturedLog["level"]]> = [
    ["debug", "debug"],
    ["log", "info"],
    ["info", "info"],
    ["warn", "warning"],
    ["error", "error"],
  ];
  for (const [method, level] of levels) {
    const original = console[method] as (...args: unknown[]) => void;
    (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      try {
        recordLog(level, "next", format(...args));
      } catch {
        /* never break logging */
      }
      original.apply(console, args);
    };
  }
}

export function installLogCapture() {
  const store = getLogStore();
  if (store.installed) return;
  store.installed = true;
  patchHttpServer();
  patchConsole();
}
