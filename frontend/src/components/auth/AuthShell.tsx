import Link from "next/link";
import type { ReactNode } from "react";
import { AuthBrandHeader } from "./AuthBrandHeader";
import { AuthHeroPanel } from "./AuthHeroPanel";

type Props = {
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
  showBrandHeader?: boolean;
  /** Vertical word on the left hero panel. Defaults to MERCHANTS. */
  heroLabel?: string;
  /** Optional control anchored to the top-right of the form panel (e.g. Log out). */
  panelAction?: ReactNode;
  className?: string;
};

export function AuthShell({
  children,
  backHref,
  backLabel = "Back",
  showBrandHeader = true,
  heroLabel = "MERCHANTS",
  panelAction,
  className = "",
}: Props) {
  return (
    <div className={`auth-split ${className}`.trim()}>
      <AuthHeroPanel label={heroLabel} />
      <section className="auth-split__panel">
        {backHref ? (
          <Link href={backHref} className="auth-split__back" aria-label={backLabel}>
            <span aria-hidden="true">←</span>
          </Link>
        ) : null}
        {panelAction ? (
          <div className="auth-split__panel-action">{panelAction}</div>
        ) : null}
        <div className="auth-split__content">
          {showBrandHeader ? <AuthBrandHeader /> : null}
          {children}
        </div>
      </section>
    </div>
  );
}
