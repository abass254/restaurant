const SUPPRESS_KEY = "merchant-notif-suppress-orders";

type SuppressMap = Record<string, number>;

function readSuppressMap(): SuppressMap {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SUPPRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SuppressMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSuppressMap(map: SuppressMap) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SUPPRESS_KEY, JSON.stringify(map));
}

/** Skip the dashboard poller toast when the same user already got local feedback (e.g. POS). */
export function suppressMerchantOrderNotification(
  orderId: string,
  ttlMs = 30_000,
) {
  const map = readSuppressMap();
  const now = Date.now();
  for (const [id, expiresAt] of Object.entries(map)) {
    if (expiresAt <= now) delete map[id];
  }
  map[orderId] = now + ttlMs;
  writeSuppressMap(map);
}

export function shouldSuppressMerchantOrderNotification(orderId: string): boolean {
  const map = readSuppressMap();
  const expiresAt = map[orderId];
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    delete map[orderId];
    writeSuppressMap(map);
    return false;
  }
  return true;
}
