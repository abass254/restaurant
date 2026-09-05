"use client";

import type { ReactNode } from "react";

export function TransChapPanel({
  id,
  open,
  title,
  subtitle,
  badge,
  tone = "sale",
  onToggle,
  action,
  headAction,
  children,
}: {
  id: string;
  open: boolean;
  title: string;
  subtitle?: string;
  badge?: { label: string; tone: "ok" | "wait" | "fail" | "credit" };
  tone?: "sale" | "purchase" | "stock" | "credit";
  onToggle: () => void;
  action?: ReactNode;
  headAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className={`trans-chap-panel trans-chap-panel--${tone}${open ? " is-open" : ""}`}>
      <div className="trans-chap-panel__head">
        <button
          type="button"
          className="trans-chap-panel__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
        >
          <span className="trans-chap-panel__copy">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </span>
          {badge ? (
            <em className={`trans-chap-panel__badge is-${badge.tone}`}>{badge.label}</em>
          ) : null}
          <i className="fa-solid fa-chevron-down" aria-hidden />
        </button>
        {headAction}
      </div>
      {open ? (
        <div className="trans-chap-panel__body" id={id}>
          {children}
          <div className="trans-chap-panel__foot">
            {action}
            <button type="button" className="trans-chap-panel__hide" onClick={onToggle}>
              Hide
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
