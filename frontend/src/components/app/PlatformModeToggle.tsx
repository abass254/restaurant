"use client";

import { useState } from "react";
import { usePlatformRuntime, type PlatformRuntimeMode } from "@/lib/platform-runtime";

export function PlatformModeToggle() {
  const { mode, loading, setMode } = usePlatformRuntime();
  const [saving, setSaving] = useState(false);

  async function select(next: PlatformRuntimeMode) {
    if (next === mode || saving) return;
    setSaving(true);
    try {
      await setMode(next);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div
      className="platform-mode-toggle"
      role="group"
      aria-label="Platform runtime mode"
      title="Dev uses Daraja sandbox + editable POS prices"
    >
      <span className="platform-mode-toggle__label">Mode</span>
      <div className="platform-mode-toggle__options">
        {(["dev", "production"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={`platform-mode-toggle__btn${
              mode === option ? " is-active" : ""
            }`}
            aria-pressed={mode === option}
            disabled={saving}
            onClick={() => void select(option)}
          >
            {option === "dev" ? "Dev" : "Production"}
          </button>
        ))}
      </div>
    </div>
  );
}
