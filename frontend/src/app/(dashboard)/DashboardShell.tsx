"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { AppSidebar } from "@/components/app/AppSidebar";
import { AppTopBar } from "@/components/app/AppTopBar";
import { OnboardingGate } from "@/components/app/OnboardingGate";
import { MerchantSectionGate } from "@/components/app/MerchantSectionGate";
import { MerchantLocationBanner } from "@/components/app/MerchantLocationGate";
import { MerchantNotificationPoller } from "@/components/app/MerchantNotificationPoller";
import { PageTransition } from "@/components/app/PageTransition";
import { SessionTimeoutGuard } from "@/components/app/SessionTimeoutGuard";
import { PlatformRuntimeProvider } from "@/lib/platform-runtime";

function useIsMobileNav() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const user = useAuthUser();
  const pathname = usePathname();
  const isMobileNav = useIsMobileNav();
  const isInbox =
    pathname.startsWith("/messages") || pathname.startsWith("/tickets");

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(
    () => setMobileSidebarOpen((v) => !v),
    [],
  );
  const closeSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileSidebarOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileSidebarOpen]);

  const sidebarExpanded = !isMobileNav || mobileSidebarOpen;

  return (
    <PlatformRuntimeProvider>
      <SessionTimeoutGuard loginPath="/sign-in" />
      <MerchantNotificationPoller />
      <div
        className={[
          "fb-app",
          "fb-app--no-rail",
          isInbox ? "fb-app--messages" : "",
          isMobileNav ? "" : "fb-app--sidebar-desktop",
          mobileSidebarOpen ? "fb-app--sidebar-expanded" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <AppTopBar
          user={user}
          onToggleSidebar={isMobileNav ? toggleSidebar : undefined}
          sidebarExpanded={mobileSidebarOpen}
        />
        <OnboardingGate />
        <MerchantSectionGate />
        <div className="fb-app__body">
          <AppSidebar expanded={sidebarExpanded} />
          <div className="fb-app__content">
            <div
              className={`fb-app__center${isInbox ? " fb-app__center--messages" : ""}`}
            >
              <MerchantLocationBanner />
              <PageTransition>{children}</PageTransition>
            </div>
          </div>
        </div>
        <div
          className="fb-app__backdrop"
          aria-hidden="true"
          onClick={closeSidebar}
        />
      </div>
    </PlatformRuntimeProvider>
  );
}
