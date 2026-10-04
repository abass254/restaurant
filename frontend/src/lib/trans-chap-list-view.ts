"use client";

import { useCallback, useSyncExternalStore } from "react";

export type TransChapListView = "grid" | "list";

const CHANGE_EVENT = "trans-chap-list-view-change";

function readView(storageKey: string): TransChapListView {
  try {
    return window.localStorage.getItem(storageKey) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Matches the CSS breakpoint that hides `.trans-chap-sales__view`. */
const PHONE_QUERY = "(max-width: 767px)";

function subscribePhone(onChange: () => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Phones always get the grid layout; the list table doesn't fit. */
export function useTransChapIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/** Grid / list layout preference, remembered per page in localStorage. */
export function useTransChapListView(
  storageKey: string,
): [TransChapListView, (next: TransChapListView) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => readView(storageKey),
    () => "grid" as const,
  );
  const phone = useTransChapIsPhone();
  const view: TransChapListView = phone ? "grid" : stored;

  const setView = useCallback(
    (next: TransChapListView) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* ignore quota / private mode */
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [storageKey],
  );

  return [view, setView];
}

export function summarizeFailures(failures: string[]): string {
  const shown = failures.slice(0, 3).join(" · ");
  return failures.length > 3 ? `${shown} · and ${failures.length - 3} more` : shown;
}
