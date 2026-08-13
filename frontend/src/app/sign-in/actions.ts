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
import { firstAllowedPath } from "@/lib/merchant-permissions";
import type { AuthUser } from "@/lib/types";

export type LoginActionState = {
  ok: boolean;
  message: string;
};

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

function loginErrorRedirect(message: string): never {
  redirect(`/sign-in?error=${encodeURIComponent(message)}`);
}

export async function verifyLoginCodeAction(formData: FormData): Promise<{
  ok: false;
  message: string;
} | void> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const nextRaw = String(formData.get("next") ?? "").trim();
  const nextPath =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;

  if (!identifier || code.length !== 4) {
    return { ok: false, message: "Enter the 4-digit code." };
  }

  try {
    const { cookieHeader, xsrf } = await fetchCsrf();

    const res = await fetchBackend("/api/v1/auth/verify-code", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        "X-XSRF-TOKEN": xsrf,
      },
      body: JSON.stringify({ identifier, code }),
    });

    const setCookies = res.headers.getSetCookie();
    if (setCookies.length > 0) {
      await applySetCookies(setCookies);
    }

    const body = (await res.json().catch(() => null)) as
      | (AuthUser & { message?: string; detail?: string })
      | null;

    if (!res.ok) {
      const detail =
        typeof body?.detail === "string" ? body.detail : body?.message;
      return {
        ok: false,
        message: detail ?? `Could not verify the code (HTTP ${res.status}).`,
      };
    }

    if (!body) {
      return { ok: false, message: "Login failed: empty response from server." };
    }

    if (body.require_change_password) {
      redirect(
        nextPath
          ? `/change-password?next=${encodeURIComponent(nextPath)}`
          : "/change-password",
      );
    }

    redirect(nextPath || firstAllowedPath(body));
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") {
      throw err;
    }
    return {
      ok: false,
      message:
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : `Cannot reach backend at ${backendUrl}`,
    };
  }
}

export async function loginFormAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextRaw = String(formData.get("next") ?? "").trim();
  const nextPath =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;

  if (!email || !password) {
    loginErrorRedirect("Email and password are required.");
  }

  try {
    const { cookieHeader, xsrf } = await fetchCsrf();

    const res = await fetchBackend("/api/v1/auth/login", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        "X-XSRF-TOKEN": xsrf,
      },
      body: JSON.stringify({ email, password }),
    });

    const setCookies = res.headers.getSetCookie();
    if (setCookies.length > 0) {
      await applySetCookies(setCookies);
    }

    const body = (await res.json().catch(() => null)) as
      | (AuthUser & { message?: string })
      | null;

    if (!res.ok) {
      loginErrorRedirect(body?.message ?? `Login failed (HTTP ${res.status}).`);
    }

    if (!body) {
      loginErrorRedirect("Login failed: empty response from server.");
    }

    if (body.require_change_password) {
      redirect(
        nextPath
          ? `/change-password?next=${encodeURIComponent(nextPath)}`
          : "/change-password",
      );
    }

    redirect(nextPath || firstAllowedPath(body));
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") {
      throw err;
    }
    loginErrorRedirect(
      err instanceof BackendUnavailableError
        ? err.message
        : err instanceof Error
          ? err.message
          : `Cannot reach backend at ${backendUrl}`,
    );
  }
}

/** For useActionState (client-enhanced login). */
export async function loginAction(
  _prev: LoginActionState | null,
  formData: FormData,
): Promise<LoginActionState> {
  try {
    await loginFormAction(formData);
    return { ok: true, message: "" };
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") {
      throw err;
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Login failed.",
    };
  }
}
