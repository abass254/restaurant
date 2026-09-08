"use client";

import type { ReactNode } from "react";
import { TransChapProductThumb } from "@/components/trans-chap/TransChapProductThumb";

export function TransChapPanel({
  id,
  open,
  title,
  subtitle,
  qty,
  price,
  badge,
  tag,
  imageUrl,
  tone = "sale",
  inactive = false,
  picking = false,
  picked = false,
  onToggle,
  action,
  headAction,
  children,
}: {
  id: string;
  open: boolean;
  title: string;
  subtitle?: string;
  qty?: string;
  price?: string;
  badge?: { label: string; tone: "ok" | "wait" | "fail" | "credit" };
  tag?: string;
  imageUrl?: string | null;
  tone?: "sale" | "purchase" | "stock" | "credit";
  inactive?: boolean;
  picking?: boolean;
  picked?: boolean;
  onToggle: () => void;
  action?: ReactNode;
  headAction?: ReactNode;
  children: ReactNode;
}) {
  const showStats = Boolean(qty || price);
  return (
    <article className={`trans-chap-panel trans-chap-panel--${tone}${open ? " is-open" : ""}${inactive ? " is-inactive" : ""}${picking ? " is-picking" : ""}${picked ? " is-picked" : ""}`}>
      <div className="trans-chap-panel__head">
        <button
          type="button"
          className="trans-chap-panel__toggle"
          aria-expanded={picking ? undefined : open}
          aria-pressed={picking ? picked : undefined}
          aria-controls={picking ? undefined : id}
          onClick={onToggle}
        >
          {imageUrl !== undefined ? (
            <TransChapProductThumb src={imageUrl} name={title} size="md" />
          ) : null}
          <span className="trans-chap-panel__copy">
            <span className="trans-chap-panel__title-row">
              <strong>{title}</strong>
              {tag ? <em className="trans-chap-panel__tag">{tag}</em> : null}
            </span>
            {showStats ? (
              <span className="trans-chap-panel__stats">
                {qty ? <span className="trans-chap-panel__qty">{qty}</span> : null}
                {price ? <span className="trans-chap-panel__price">{price}</span> : null}
              </span>
            ) : subtitle ? (
              <span className="trans-chap-panel__subtitle">{subtitle}</span>
            ) : null}
          </span>
          {badge ? (
            <em className={`trans-chap-panel__badge is-${badge.tone}`}>{badge.label}</em>
          ) : null}
          {picking ? null : <i className="fa-solid fa-chevron-down" aria-hidden />}
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
