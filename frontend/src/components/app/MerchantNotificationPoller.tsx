"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { toastNotification } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { shouldSuppressMerchantOrderNotification } from "@/lib/merchant-notifications";
import type {
  MerchantNotification,
  MerchantNotificationsReadResponse,
  MerchantNotificationsResponse,
} from "@/lib/types";

const POLL_MS = 5_000;

function playNotificationChime() {
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.1); // A5
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch {
    /* AudioContext might be blocked until user gesture, safely ignore */
  }
}

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

function getNotificationDestination(
  notification: MerchantNotification,
  pathname: string,
): string | null {
  const isTransChap = pathname.startsWith("/trans-chap");
  const { kind, entity_type } = notification;

  if (kind === "order" || entity_type === "order") {
    return isTransChap ? "/trans-chap/sales" : "/orders";
  }
  if (kind === "message" || entity_type === "conversation") {
    return isTransChap ? "/trans-chap/chats" : "/messages";
  }
  if (kind === "ticket" || entity_type === "ticket") {
    return isTransChap ? "/trans-chap/chats" : "/tickets";
  }
  return null;
}

function showNotificationToast(
  notification: MerchantNotification,
  pathname: string,
  onNavigate?: (path: string) => void,
) {
  if (
    notification.kind === "order" &&
    notification.entity_type === "order" &&
    notification.entity_id &&
    shouldSuppressMerchantOrderNotification(notification.entity_id)
  ) {
    return;
  }

  const { title, body, kind } = notification;
  const destination = getNotificationDestination(notification, pathname);

  playNotificationChime();

  void toastNotification({
    title,
    text: body ?? undefined,
    icon: kind === "order" ? "success" : "info",
    durationMs: 5200,
    onClick: destination && onNavigate ? () => onNavigate(destination) : undefined,
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("TransChap:notification", { detail: notification }));
    window.dispatchEvent(new CustomEvent("trans-chap:refresh-counts"));
  }
}

export function MerchantNotificationPoller() {
  const pathname = usePathname();
  const router = useRouter();
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
            const now = Date.now();
            const recent = notifications.filter((row) => {
              const dt = row.created_at ? new Date(row.created_at).getTime() : 0;
              return now - dt < 60_000;
            });
            for (const row of notifications) shownRef.current.add(row.id);
            await markNotificationsRead(notifications.map((row) => row.id));
            sinceRef.current =
              latestCreatedAt(notifications) ?? new Date().toISOString();

            // If a notification arrived in the last 60s, show it
            for (const row of recent) {
              showNotificationToast(row, pathname, (href) => router.push(href));
            }
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
          showNotificationToast(row, pathname, (href) => router.push(href));
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
  }, [pathname, router]);

  return null;
}
