"use client";

import { useEffect } from "react";
import { notifyNavigationStart } from "@/lib/navigation-loading";
import { toastLoading } from "@/lib/alerts";

function isModifiedClick(event: MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function hrefWillNavigate(href: string, current: URL) {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("javascript:")
  ) {
    return false;
  }

  let next: URL;
  try {
    next = new URL(href, current.origin);
  } catch {
    return false;
  }

  if (next.origin !== current.origin) return false;

  return (
    next.pathname !== current.pathname ||
    next.search !== current.search ||
    next.hash !== current.hash
  );
}

function beginNavigationLoading() {
  notifyNavigationStart();
  void toastLoading("Loading…");
}

export function NavigationClickLoading() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || isModifiedClick(event)) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest("[data-no-nav-loading], .waitlist-backdrop, .cookie-consent")) {
        return;
      }

      const marked = target.closest("[data-nav-loading]");
      if (marked instanceof HTMLElement) {
        if (marked.getAttribute("aria-disabled") === "true") return;
        beginNavigationLoading();
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      if (anchor.getAttribute("aria-disabled") === "true") return;

      const href = anchor.getAttribute("href");
      if (!href || !hrefWillNavigate(href, new URL(window.location.href))) return;

      beginNavigationLoading();
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
