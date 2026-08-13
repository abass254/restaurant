type Listener = () => void;

const startListeners = new Set<Listener>();
const completeListeners = new Set<Listener>();

let active = false;

export function isNavigationLoading() {
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

export function notifyNavigationStart() {
  if (active) return;
  active = true;
  if (typeof document !== "undefined") {
    document.documentElement.classList.add("is-nav-loading");
  }
  startListeners.forEach((listener) => listener());
}

export function notifyNavigationComplete() {
  if (!active) return;
  active = false;
  if (typeof document !== "undefined") {
    document.documentElement.classList.remove("is-nav-loading");
  }
  completeListeners.forEach((listener) => listener());
}
