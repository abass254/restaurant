import type { ReactNode } from "react";
import Link from "next/link";

export function TransChapStatus({
  children,
  tone = "muted",
  actionHref,
  actionLabel,
  onAction,
}: {
  children: ReactNode;
  tone?: "muted" | "error";
  actionHref?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`trans-chap-status trans-chap-status--${tone}`} role={tone === "error" ? "alert" : undefined}>
      <p>{children}</p>
      {actionLabel && onAction ? (
        <button type="button" className="trans-chap-status__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : actionHref && actionLabel ? (
        <Link href={actionHref} className="trans-chap-status__action">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
