"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { showSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { OnboardingChecklist } from "@/lib/types";
import { useAuthUser } from "@/components/app/AuthProvider";
import { OnboardingChecklistPanel } from "@/components/app/OnboardingChecklistPanel";
import { Skeleton } from "@/components/app/Skeleton";

export default function OnboardingPage() {
  const router = useRouter();
  const user = useAuthUser();
  const [data, setData] = useState<OnboardingChecklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user.instagram_account) {
      router.replace("/settings#section-channels");
      return;
    }

    try {
      const result = await apiFetch<OnboardingChecklist>(apiRoutes.onboarding);
      setData(result);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        router.replace("/settings#section-channels");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load onboarding checklist.");
    }
  }, [router, user.instagram_account]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setError(null);

    try {
      const result = await apiFetch<OnboardingChecklist>(apiRoutes.onboardingRefresh, {
        method: "POST",
      });
      setData(result);
      if (result.message) {
        void showSuccess(
          result.onboarding_complete ? "Setup complete" : "Checklist updated",
          result.message,
        );
      }
      if (result.onboarding_complete) {
        router.replace("/messages");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  if (!data) {
    return (
      <section className="app-panel onboarding-page" aria-busy="true" aria-live="polite">
        <Skeleton variant="text" height={14} width={120} />
        <Skeleton variant="text" height={28} width="50%" />
        <Skeleton variant="text" height={14} width="70%" short />
        <div className="onboarding-card">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="text" height={52} width="100%" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="app-panel">
      {error ? <p className="app-error">{error}</p> : null}
      <OnboardingChecklistPanel data={data} refreshing={refreshing} onRefresh={() => void refresh()} />
    </section>
  );
}
