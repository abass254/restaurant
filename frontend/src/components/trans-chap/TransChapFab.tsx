"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";

export type TransChapFabOption = {
  href?: string;
  onClick?: () => void;
  label: string;
  icon: string;
};

export function TransChapFab({
  label,
  options,
  href,
  onClick,
}: {
  label: string;
  options?: TransChapFabOption[];
  /** Direct link — skips the options menu (e.g. staff single purchase entry). */
  href?: string;
  /** Direct action — skips the options menu. */
  onClick?: () => void;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const menuOptions = options ?? [];

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (href) {
    return (
      <div className="trans-chap-fab-wrap">
        <Link href={href} className="trans-chap-fab" aria-label={label} title={label}>
          <i className="fa-solid fa-plus" aria-hidden />
        </Link>
      </div>
    );
  }

  if (onClick) {
    return (
      <div className="trans-chap-fab-wrap">
        <button
          type="button"
          className="trans-chap-fab"
          aria-label={label}
          title={label}
          onClick={onClick}
        >
          <i className="fa-solid fa-plus" aria-hidden />
        </button>
      </div>
    );
  }

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
          {menuOptions.map((option) => {
            const key = option.href ?? option.label;
            if (option.href) {
              return (
                <Link
                  key={key}
                  href={option.href}
                  className="trans-chap-fab__option"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  <span>{option.label}</span>
                  <i className={`fa-solid ${option.icon}`} aria-hidden />
                </Link>
              );
            }
            return (
              <button
                key={key}
                type="button"
                className="trans-chap-fab__option"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  option.onClick?.();
                }}
              >
                <span>{option.label}</span>
                <i className={`fa-solid ${option.icon}`} aria-hidden />
              </button>
            );
          })}
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
