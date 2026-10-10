type Listener = () => void;

const startListeners = new Set<Listener>();
const completeListeners = new Set<Listener>();

let active = false;
let targetPath: string | null = null;
let routeChanged = false;
let dataFetchObserved = false;
const pendingPromises = new Set<Promise<unknown>>();

let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let skeletonCheckTimer: ReturnType<typeof setTimeout> | null = null;

const SAFETY_TIMEOUT_MS = 25000;
const STATIC_PAGE_GRACE_MS = 320;
const MAX_SKELETON_WAIT_MS = 3000;

function cleanupTimers() {
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (skeletonCheckTimer) {
    clearTimeout(skeletonCheckTimer);
    skeletonCheckTimer = null;
  }
}

export function isNavigationLoading(): boolean {
  return active;
}

export function subscribeNavigationStart(listener: Listener): () => void {
  startListeners.add(listener);
  return () => startListeners.delete(listener);
}

export function subscribeNavigationComplete(listener: Listener): () => void {
  completeListeners.add(listener);
  return () => completeListeners.delete(listener);
}

export function isPageStillBusy(): boolean {
  if (typeof document === "undefined") return false;

  const content =
    document.querySelector(
      "main, .fb-app__content, .trans-chap-app__content, .admin-shell__main, .admin-page",
    ) || document.body;
  if (!content) return false;

  const busyEl = content.querySelector(
    '[aria-busy="true"]:not(.dukai-swal-toast):not(.trans-chap-swal):not(.trans-chap-swal--loading), .page-loading-shell, .trans-chap-panel--skeleton, .skeleton:not(.dukai-swal-toast *):not(.trans-chap-swal *)',
  );
  return Boolean(busyEl);
}

function stopSkeletonWait() {
  if (skeletonCheckTimer) {
    clearTimeout(skeletonCheckTimer);
    skeletonCheckTimer = null;
  }
}

function startSkeletonWait() {
  stopSkeletonWait();
  const startTime = Date.now();

  const poll = () => {
    if (!active) {
      stopSkeletonWait();
      return;
    }
    if (pendingPromises.size > 0) {
      stopSkeletonWait();
      return;
    }

    if (!isPageStillBusy() || Date.now() - startTime > MAX_SKELETON_WAIT_MS) {
      stopSkeletonWait();
      notifyNavigationComplete();
      return;
    }

    skeletonCheckTimer = setTimeout(poll, 60);
  };

  skeletonCheckTimer = setTimeout(poll, 60);
}

function scheduleCompletionCheck() {
  if (!active) return;
  if (!routeChanged) return;
  if (pendingPromises.size > 0) return;

  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      setTimeout(() => {
        if (!active || pendingPromises.size > 0) return;

        if (isPageStillBusy()) {
          startSkeletonWait();
          return;
        }

        notifyNavigationComplete();
      }, 60);
    });
  } else {
    notifyNavigationComplete();
  }
}

export function notifyNavigationStart(targetHref?: string) {
  targetPath = targetHref ?? null;
  routeChanged = false;
  dataFetchObserved = false;
  pendingPromises.clear();

  cleanupTimers();

  if (!active) {
    active = true;
    if (typeof document !== "undefined") {
      document.documentElement.classList.add("is-nav-loading");
    }
    startListeners.forEach((listener) => listener());
  }

  safetyTimer = setTimeout(() => {
    if (active) {
      notifyNavigationComplete();
    }
  }, SAFETY_TIMEOUT_MS);
}

export function notifyRouteChange(pathname?: string) {
  if (!active) return;
  routeChanged = true;

  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!active) return;
    if (pendingPromises.size > 0) return;

    if (!dataFetchObserved && !isPageStillBusy()) {
      notifyNavigationComplete();
      return;
    }

    scheduleCompletionCheck();
  }, STATIC_PAGE_GRACE_MS);
}

export function trackNavigationPromise(promise: Promise<unknown>) {
  if (!active) return;
  pendingPromises.add(promise);
  dataFetchObserved = true;

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  const onSettled = () => {
    pendingPromises.delete(promise);
    if (!active) return;
    if (pendingPromises.size === 0) {
      scheduleCompletionCheck();
    }
  };

  promise.then(onSettled, onSettled);
}

export function notifyNavigationComplete() {
  if (!active) return;
  active = false;
  targetPath = null;
  routeChanged = false;
  dataFetchObserved = false;
  pendingPromises.clear();

  cleanupTimers();

  if (typeof document !== "undefined") {
    document.documentElement.classList.remove("is-nav-loading");
  }
  completeListeners.forEach((listener) => listener());
}

function shouldTrackFetch(url: string): boolean {
  if (!url) return false;
  if (
    url.includes("google-analytics") ||
    url.includes("googletagmanager") ||
    url.includes("/dev/backend-status") ||
    url.includes("fonts.")
  ) {
    return false;
  }
  return true;
}

// Hook browser fetch so any data fetch initiated during navigation is monitored.
if (typeof window !== "undefined") {
  const globalWin = window as unknown as { __navFetchHooked?: boolean };
  if (!globalWin.__navFetchHooked && typeof window.fetch === "function") {
    globalWin.__navFetchHooked = true;
    const originalFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const p = originalFetch.apply(this, [input, init]);
      if (active) {
        const urlStr =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input instanceof Request
                ? input.url
                : "";
        if (shouldTrackFetch(urlStr)) {
          trackNavigationPromise(p);
        }
      }
      return p;
    };
  }
}
