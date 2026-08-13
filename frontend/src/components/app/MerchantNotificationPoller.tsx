"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { toastInfo, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { shouldSuppressMerchantOrderNotification } from "@/lib/merchant-notifications";
import type {
  MerchantNotification,
  MerchantNotificationsReadResponse,
  MerchantNotificationsResponse,
} from "@/lib/types";

const POLL_MS = 5_000;

function latestCreatedAt(notifications: MerchantNotification[]): string | null {
  let latest: string | null = null;
  for (const row of notifications) {
    const createdAt = row.created_at;
    if (!createdAt) continue;
    if (!latest || createdAt > latest) latest = createdAt;
  }
  return latest;
}

async function markNotificationsRead(ids: string[]) {
  if (!ids.length) return;
  await apiFetch<MerchantNotificationsReadResponse>(apiRoutes.notificationsRead, {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
}

function showNotificationToast(notification: MerchantNotification) {
  if (
    notification.kind === "order" &&
    notification.entity_type === "order" &&
    notification.entity_id &&
    shouldSuppressMerchantOrderNotification(notification.entity_id)
  ) {
    return;
  }

  const { title, body, kind } = notification;
  if (kind === "order") {
    if (body) {
      void toastInfo(title, body);
    } else {
      void toastSuccess(title);
    }
    return;
  }

  void toastInfo(title, body ?? undefined);
}

export function MerchantNotificationPoller() {
  const sinceRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);
  const shownRef = useRef(new Set<string>());
  const pollingRef = useRef(false);

  useEffect(() => {
    async function poll() {
      if (pollingRef.current) return;
      pollingRef.current = true;

      try {
        const params =
          bootstrappedRef.current && sinceRef.current
            ? `?since=${encodeURIComponent(sinceRef.current)}`
            : "";
        const data = await apiFetch<MerchantNotificationsResponse>(
          `${apiRoutes.notifications}${params}`,
        );
        const notifications = data.data.notifications;

        if (!bootstrappedRef.current) {
          bootstrappedRef.current = true;
          if (notifications.length) {
            for (const row of notifications) shownRef.current.add(row.id);
            await markNotificationsRead(notifications.map((row) => row.id));
            sinceRef.current =
              latestCreatedAt(notifications) ?? new Date().toISOString();
          } else {
            sinceRef.current = new Date().toISOString();
          }
          return;
        }

        if (!notifications.length) return;

        const toMark: string[] = [];
        for (const row of notifications) {
          if (shownRef.current.has(row.id)) continue;
          shownRef.current.add(row.id);
          showNotificationToast(row);
          toMark.push(row.id);
        }

        if (toMark.length) {
          await markNotificationsRead(toMark);
        }

        const latest = latestCreatedAt(notifications);
        if (latest) sinceRef.current = latest;
      } catch {
        /* keep polling — auth may be refreshing */
      } finally {
        pollingRef.current = false;
      }
    }

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);

    function onFocus() {
      void poll();
    }
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
