"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";

export type TransChapFabOption = {
  href: string;
  label: string;
  icon: string;
};

export function TransChapFab({
  label,
  options,
}: {
  label: string;
  options: TransChapFabOption[];
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`trans-chap-fab-wrap${open ? " is-open" : ""}`}>
      {open ? (
        <button
          type="button"
          className="trans-chap-fab__scrim"
          aria-label="Close"
          onClick={() => setOpen(false)}
        />
      ) : null}
      {open ? (
        <div className="trans-chap-fab__options" id={menuId} role="menu" aria-label={label}>
          {options.map((option) => (
            <Link
              key={option.href}
              href={option.href}
              className="trans-chap-fab__option"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <span>{option.label}</span>
              <i className={`fa-solid ${option.icon}`} aria-hidden />
            </Link>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={`trans-chap-fab${open ? " is-open" : ""}`}
        aria-label={open ? "Close" : label}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <i className={`fa-solid ${open ? "fa-xmark" : "fa-plus"}`} aria-hidden />
      </button>
    </div>
  );
}
