"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = localStorage.getItem("TransChap-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type ThemeToggleProps = {
  /** "icon" for header buttons; "switch" for iOS-style settings rows. */
  variant?: "icon" | "switch";
};

export function ThemeToggle({ variant = "icon" }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
    setMounted(true);
  }, []);

  function applyTheme(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("TransChap-theme", next);
  }

  function toggle() {
    applyTheme(theme === "light" ? "dark" : "light");
  }

  if (variant === "switch") {
    const dark = theme === "dark";
    return (
      <button
        type="button"
        role="switch"
        className={`theme-switch${dark ? " is-on" : ""}`}
        aria-checked={dark}
        aria-label="Dark mode"
        disabled={!mounted}
        onClick={toggle}
      >
        <span className="theme-switch__thumb" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      disabled={!mounted}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Dark mode" : "Light mode"}
    >
      {theme === "light" ? (
        <i className="fas fa-moon" aria-hidden="true" />
      ) : (
        <i className="fas fa-sun" aria-hidden="true" />
      )}
    </button>
  );
}
