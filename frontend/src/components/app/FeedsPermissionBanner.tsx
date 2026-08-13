"use client";

import Link from "next/link";
import { resolveSameOriginUrl } from "@/lib/config";

type FeedsPermissionBannerProps = {
  connectUrl: string | null;
  compact?: boolean;
};

export function FeedsPermissionBanner({
  connectUrl,
  compact = false,
}: FeedsPermissionBannerProps) {
  return (
    <div
      className={`feeds-permission-banner${compact ? " feeds-permission-banner--compact" : ""}`}
      role="status"
    >
      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
      <div className="feeds-permission-banner__copy">
        <strong>Instagram permissions need updating</strong>
        <p>
          Insights and comments need the latest Meta permissions. Reconnect
          Instagram to pull likes, comments, and analytics.
        </p>
      </div>
      {connectUrl ? (
        <a
          href={resolveSameOriginUrl(connectUrl)}
          className="btn btn-primary btn-sm"
        >
          Reconnect Instagram
        </a>
      ) : (
        <Link href="/settings#section-channels" className="btn btn-primary btn-sm">
          Go to Settings
        </Link>
      )}
    </div>
  );
}
