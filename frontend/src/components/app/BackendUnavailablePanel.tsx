"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { isDevEnvironment } from "@/lib/config";

type Props = {
  apiUrl: string;
  context?: "dashboard" | "admin";
};

type PanelState = "idle" | "starting" | "error";

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

export function BackendUnavailablePanel({
  apiUrl,
  context = "dashboard",
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<PanelState>("idle");
  const [error, setError] = useState<string | null>(null);

  const waitForBackend = useCallback(async () => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const res = await fetch("/dev/backend-status", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Could not check API status.");
      }
      const body = (await res.json()) as { up?: boolean };
      if (body.up) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(
      "The API did not respond in time. If port 7001 is already in use, stop the old process and try again.",
    );
  }, []);

  const handleStart = useCallback(async () => {
    setState("starting");
    setError(null);

    try {
      const res = await fetch("/dev/start-backend", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        error?: string;
      } | null;

      if (!res.ok) {
        throw new Error(body?.error ?? "Could not start the API server.");
      }

      if (body?.status === "already_running") {
        router.refresh();
        return;
      }

      await waitForBackend();
      router.refresh();
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "Could not start the API server.",
      );
    }
  }, [router, waitForBackend]);

  const contextLabel = context === "admin" ? "Admin" : "The dashboard";

  return (
    <div className="mx-auto max-w-lg p-8 text-sm text-slate-700">
      <h1 className="mb-2 text-lg font-semibold text-slate-900">
        API server unavailable
      </h1>
      <p className="mb-4">
        {contextLabel} cannot reach the API at{" "}
        <code className="rounded bg-slate-100 px-1">{apiUrl}</code>.
      </p>

      {isDevEnvironment ? (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleStart}
            disabled={state === "starting"}
            aria-busy={state === "starting"}
          >
            {state === "starting" ? "Starting API server…" : "Start API server"}
          </button>

          {error ? (
            <p className="text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <p className="text-slate-500">
            This runs <code className="rounded bg-slate-100 px-1">backend/run.sh</code>{" "}
            locally. If you see &quot;Address already in use&quot;, stop the process on
            port 7001 and try again.
          </p>
        </div>
      ) : (
        <p className="text-slate-500">
          Contact your administrator — the API service is not responding.
        </p>
      )}
    </div>
  );
}
