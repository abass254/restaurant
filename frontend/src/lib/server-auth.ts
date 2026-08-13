import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BackendUnavailableError, fetchBackend } from "@/lib/backend";
import { firstAllowedPath } from "@/lib/merchant-permissions";
import type { AuthUser } from "@/lib/types";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>): string {
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** Load the current user on the server (dashboard layouts, RSC). */
export async function getServerUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const cookieHeader = cookieHeaderFromStore(store);
  if (!cookieHeader) {
    return null;
  }

  const res = await fetchBackend("/api/v1/auth/user", {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as AuthUser;
}

/** Send an already-authenticated merchant to their first allowed page. */
export async function redirectIfSignedIn(): Promise<void> {
  let user: AuthUser | null = null;
  try {
    user = await getServerUser();
  } catch (error) {
    if (error instanceof BackendUnavailableError) {
      return;
    }
    throw error;
  }
  if (!user) {
    return;
  }
  if (user.require_change_password) {
    redirect("/change-password");
  }
  redirect(firstAllowedPath(user));
}
