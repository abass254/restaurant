"use client";

import Link from "next/link";

type JoinPlatformButtonProps = {
  className?: string;
  children?: React.ReactNode;
  /** @deprecated Prefer href; kept for temporary compatibility. */
  onOpen?: () => void;
  href?: string;
};

export function JoinPlatformButton({
  className = "btn btn-primary",
  children = "Get Started",
  onOpen,
  href = "/signup",
}: JoinPlatformButtonProps) {
  if (onOpen) {
    return (
      <button
        type="button"
        className={className}
        data-no-nav-loading
        onClick={() => onOpen()}
      >
        {children}
      </button>
    );
  }

  return (
    <Link href={href} className={className} data-no-nav-loading>
      {children}
    </Link>
  );
}
