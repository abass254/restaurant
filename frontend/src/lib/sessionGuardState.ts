let suppressUnauthorized = false;

/** Suppress global 401 handling while the session guard is recovering. */
export function setSuppressUnauthorizedEvents(suppress: boolean): void {
  suppressUnauthorized = suppress;
}

export function shouldSuppressUnauthorizedEvents(): boolean {
  return suppressUnauthorized;
}
