"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type {
  MerchantNotificationsReadResponse,
  MerchantNotificationsResponse,
} from "@/lib/types";
import {
  registerStationServiceWorker,
  showCompanionNotification,
} from "@/lib/companion-push";

/**
 * While the phone companion is open, surface order notifications via the
 * Notification API (and keep the service worker registered for PWA install).
 */
export function CompanionOrderNotifier() {
  const sinceRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    void registerStationServiceWorker();

    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const params =
          bootstrappedRef.current && sinceRef.current
            ? `?since=${encodeURIComponent(sinceRef.current)}`
            : "";
        const data = await apiFetch<MerchantNotificationsResponse>(
          `${apiRoutes.notifications}${params}`,
        );
        const rows = data.data.notifications;
        if (!bootstrappedRef.current) {
          bootstrappedRef.current = true;
          if (rows[0]?.created_at) sinceRef.current = rows[0].created_at;
          for (const row of rows) {
            if (row.created_at && (!sinceRef.current || row.created_at > sinceRef.current)) {
              sinceRef.current = row.created_at;
            }
          }
          return;
        }

        const orderNotes = rows.filter((n) => n.kind === "order");
        // Foreground: full-page StationNewOrderAlert handles the takeover.
        // Background only: use OS notifications so the phone still pings.
        const pageHidden =
          typeof document !== "undefined" && document.visibilityState === "hidden";
        if (
          orderNotes.length &&
          pageHidden &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          for (const note of orderNotes.slice(0, 3)) {
            await showCompanionNotification(note.title, {
              body: note.body ?? "New merchant update",
              tag: note.id,
            });
          }
          await apiFetch<MerchantNotificationsReadResponse>(
            apiRoutes.notificationsRead,
            {
              method: "PATCH",
              body: JSON.stringify({ ids: orderNotes.map((n) => n.id) }),
            },
          );
        } else if (orderNotes.length && !pageHidden) {
          // Mark read so we don't re-fire OS alerts after they confirm in-app.
          await apiFetch<MerchantNotificationsReadResponse>(
            apiRoutes.notificationsRead,
            {
              method: "PATCH",
              body: JSON.stringify({ ids: orderNotes.map((n) => n.id) }),
            },
          );
        }

        for (const row of rows) {
          if (row.created_at && (!sinceRef.current || row.created_at > sinceRef.current)) {
            sinceRef.current = row.created_at;
          }
        }
      } catch {
        // Ignore transient poll errors.
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
