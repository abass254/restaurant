import type { ReactNode } from "react";
import Link from "next/link";

export function TransChapStatus({
  children,
  tone = "muted",
  actionHref,
  actionLabel,
}: {
  children: ReactNode;
  tone?: "muted" | "error";
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className={`trans-chap-status trans-chap-status--${tone}`} role={tone === "error" ? "alert" : undefined}>
      <p>{children}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="trans-chap-status__action">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
