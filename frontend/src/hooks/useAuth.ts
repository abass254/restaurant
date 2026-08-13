"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { ApiError, apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { AuthUser } from "@/lib/types";

type UseAuthOptions = {
  requireInstagram?: boolean;
  requireOnboarded?: boolean;
};

function applyRouteGuards(
  data: AuthUser,
  opts: UseAuthOptions,
  router: ReturnType<typeof useRouter>,
): boolean {
  if (opts.requireInstagram && !data.instagram_account) {
    router.replace("/settings");
    return false;
  }

  if (opts.requireOnboarded) {
    if (!data.instagram_account) {
      router.replace("/settings");
      return false;
    }
    if (!data.instagram_account.onboarding_complete) {
      router.replace("/tools/onboarding");
      return false;
    }
  }

  return true;
}

export function useAuth(options: boolean | UseAuthOptions = {}) {
  const opts: UseAuthOptions =
    typeof options === "boolean" ? { requireOnboarded: options } : options;

  const router = useRouter();
  const serverUser = useOptionalAuthUser();
  const [user, setUser] = useState<AuthUser | null>(serverUser);
  const [loading, setLoading] = useState(!serverUser);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serverUser) {
      if (applyRouteGuards(serverUser, opts, router)) {
        setUser(serverUser);
      }
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const data = await apiFetch<AuthUser>(apiRoutes.user);

        if (cancelled) {
          return;
        }

        if (!applyRouteGuards(data, opts, router)) {
          return;
        }

        setUser(data);
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (err instanceof ApiError && err.status === 401) {
          router.replace("/sign-in");
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Could not load session. Check that the API is running on port 7001.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [serverUser, opts.requireInstagram, opts.requireOnboarded, router]);

  return { user, loading, error };
}
