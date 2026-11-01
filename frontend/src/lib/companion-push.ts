import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";

const SW_PATH = "/sw.js";

export async function registerStationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  } catch {
    return null;
  }
}

/** Prefer SW showNotification — `new Notification()` is illegal in some PWA contexts. */
export async function showCompanionNotification(
  title: string,
  options?: NotificationOptions,
): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }

  const opts: NotificationOptions = {
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    ...options,
  };

  try {
    const reg =
      "serviceWorker" in navigator
        ? await navigator.serviceWorker.ready
        : null;
    if (reg) {
      await reg.showNotification(title, opts);
      return;
    }
  } catch {
    // Fall through to the constructor when SW path fails.
  }

  try {
    new Notification(title, opts);
  } catch {
    // Unsupported in this environment (e.g. some installed PWAs).
  }
}

/** True when this browser has already granted notification permission. */
export function isCompanionPushEnabled(): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  return Notification.permission === "granted";
}

export type EnableCompanionPushResult = {
  ok: boolean;
  message: string;
};

export async function enableCompanionPush(): Promise<EnableCompanionPushResult> {
  if (typeof window === "undefined") {
    return { ok: false, message: "Push is only available in the browser." };
  }

  await registerStationServiceWorker();

  if (!("Notification" in window)) {
    return { ok: false, message: "This browser does not support notifications." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, message: "Notification permission was not granted." };
  }

  // Prefer Web Push subscription when PushManager is available.
  // Without VAPID public key we still enable local notifications via the
  // companion poller (see CompanionOrderNotifier).
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.pushManager && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      const key = urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key as unknown as BufferSource,
      });
      const json = sub.toJSON();
      await apiFetch(apiRoutes.storeStatusPushSubscribe, {
        method: "POST",
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys?.p256dh ?? "",
            auth: json.keys?.auth ?? "",
          },
        }),
      });
      return { ok: true, message: "Push alerts enabled for this device." };
    }
  } catch {
    // Fall through to local notifications.
  }

  await showCompanionNotification("TransChap Merchant", {
    body: "Order alerts are on while this app is open.",
  });
  return {
    ok: true,
    message: "Alerts enabled. Keep the companion open (or installed) for new-order pings.",
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
