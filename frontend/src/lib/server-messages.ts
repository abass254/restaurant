import { cookies } from "next/headers";
import { BackendUnavailableError, fetchBackend } from "@/lib/backend";
import type { InboxResponse, InstagramConversation } from "@/lib/types";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>): string {
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

type StructuredDetail = { code?: string; message?: string };

function parseDetail(
  body: { detail?: string | StructuredDetail } | null,
  status: number,
): { error: string; errorCode: string | null } {
  const raw = body?.detail;
  if (typeof raw === "string") {
    return { error: raw, errorCode: null };
  }
  if (raw && typeof raw === "object") {
    return {
      error: raw.message ?? `Could not load messages (${status}).`,
      errorCode: raw.code ?? null,
    };
  }
  return { error: `Could not load messages (${status}).`, errorCode: null };
}

/** Load inbox on the server (same session as dashboard layout). */
export async function getServerInbox(sync = false, lite = true): Promise<{
  inbox: InboxResponse | null;
  error: string | null;
  errorCode: string | null;
}> {
  const store = await cookies();
  const cookieHeader = cookieHeaderFromStore(store);
  if (!cookieHeader) {
    return { inbox: null, error: "Not signed in.", errorCode: "unauthenticated" };
  }

  const params = new URLSearchParams();
  if (sync) {
    params.set("sync", "1");
  }
  if (lite) {
    params.set("lite", "1");
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  let res: Response;
  try {
    res = await fetchBackend(`/api/v1/messages${query}`, {
      headers: { Cookie: cookieHeader, Accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof BackendUnavailableError) {
      return {
        inbox: null,
        error: error.message,
        errorCode: "backend_unavailable",
      };
    }
    throw error;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      detail?: string | StructuredDetail;
    } | null;
    const { error, errorCode } = parseDetail(body, res.status);
    return { inbox: null, error, errorCode };
  }

  return { inbox: (await res.json()) as InboxResponse, error: null, errorCode: null };
}

export async function getServerConversation(
  conversationId: string,
): Promise<InstagramConversation | null> {
  const store = await cookies();
  const cookieHeader = cookieHeaderFromStore(store);
  if (!cookieHeader) {
    return null;
  }

  const res = await fetchBackend(`/api/v1/messages/${conversationId}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    const detail =
      typeof body?.detail === "string" ? body.detail : `Could not load conversation (${res.status}).`;
    throw new Error(detail);
  }

  return (await res.json()) as InstagramConversation;
}
