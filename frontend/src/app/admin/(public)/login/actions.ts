"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BackendUnavailableError,
  backendUrl,
  cookieHeaderFromSetCookies,
  fetchBackend,
  parseSetCookie,
  xsrfFromCookieHeader,
} from "@/lib/backend";

async function applySetCookies(setCookieHeaders: string[]) {
  const store = await cookies();
  for (const header of setCookieHeaders) {
    const parsed = parseSetCookie(header);
    if (!parsed) {
      continue;
    }
    store.set(parsed.name, parsed.value, {
      httpOnly: parsed.httpOnly ?? false,
      secure: parsed.secure === true,
      sameSite: parsed.sameSite ?? "lax",
      maxAge: parsed.maxAge,
      path: parsed.path ?? "/",
    });
  }
}

async function fetchCsrf(): Promise<{ cookieHeader: string; xsrf: string }> {
  const res = await fetchBackend("/sanctum/csrf-cookie", {
    cache: "no-store",
  });
  const setCookies = res.headers.getSetCookie();
  const cookieHeader = cookieHeaderFromSetCookies(setCookies);
  await applySetCookies(setCookies);

  const xsrf = xsrfFromCookieHeader(cookieHeader);
  if (!xsrf) {
    throw new Error("Could not obtain CSRF token from backend.");
  }

  return { cookieHeader, xsrf };
}

function adminLoginErrorRedirect(message: string): never {
  redirect(`/admin/login?error=${encodeURIComponent(message)}`);
}

export async function adminLoginFormAction(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    adminLoginErrorRedirect("Username and password are required.");
  }

  try {
    const { cookieHeader, xsrf } = await fetchCsrf();

    const res = await fetchBackend("/api/v1/auth/admin/login", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        "X-XSRF-TOKEN": xsrf,
      },
      body: JSON.stringify({ username, password }),
    });

    const setCookies = res.headers.getSetCookie();
    if (setCookies.length > 0) {
      await applySetCookies(setCookies);
    }

    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;

    if (!res.ok) {
      adminLoginErrorRedirect(
        body?.message ?? `Admin login failed (HTTP ${res.status}).`,
      );
    }

    redirect("/admin");
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") {
      throw err;
    }
    adminLoginErrorRedirect(
      err instanceof BackendUnavailableError
        ? err.message
        : err instanceof Error
          ? err.message
          : `Cannot reach backend at ${backendUrl}`,
    );
  }
}
