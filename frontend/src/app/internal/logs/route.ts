import { NextResponse, type NextRequest } from "next/server";
import { BackendUnavailableError, fetchBackend } from "@/lib/backend";
import { getLogStore, LOG_CAPACITY, REQUEST_CAPACITY } from "@/lib/server/log-capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Combined backend + frontend log feed for the super-admin Logs page.
 * Authorisation is delegated to the backend endpoint: if the caller's session
 * can't read backend logs, it doesn't get frontend logs either.
 */
export async function GET(request: NextRequest) {
  const headers: Record<string, string> = { Accept: "application/json" };
  const cookie = request.headers.get("cookie");
  const authorization = request.headers.get("authorization");
  if (cookie) headers.Cookie = cookie;
  if (authorization) headers.Authorization = authorization;

  let backend: unknown;
  try {
    const res = await fetchBackend("/api/v1/admin/logs?requests=1000&logs=500", {
      headers,
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        { message: "Super admin access is required." },
        { status: res.status },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { message: `Backend log feed failed (${res.status}).` },
        { status: 502 },
      );
    }
    backend = await res.json();
  } catch (error) {
    if (!(error instanceof BackendUnavailableError)) throw error;
    // Can't verify the session while the backend is down, so frontend logs stay hidden too.
    return NextResponse.json({ message: error.message }, { status: 503 });
  }

  const store = getLogStore();
  return NextResponse.json(
    {
      backend,
      frontend: {
        started_at: store.startedAt,
        capturing: store.installed,
        requests: store.requests.slice(-1000),
        logs: store.logs.slice(-500),
        request_capacity: REQUEST_CAPACITY,
        log_capacity: LOG_CAPACITY,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
