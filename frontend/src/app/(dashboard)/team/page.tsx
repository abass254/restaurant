"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { StaffTeamSection } from "@/components/app/StaffTeamSection";
import { isShopOwner } from "@/lib/merchant-permissions";

export default function TeamPage() {
  const user = useAuthUser();
  const router = useRouter();
  const owner = isShopOwner(user);

  useEffect(() => {
    if (!owner) {
      router.replace("/dashboard");
    }
  }, [owner, router]);

  if (!owner) {
    return (
      <section className="settings-shell">
        <p className="settings-muted">Only the shop owner can manage team members.</p>
      </section>
    );
  }

  return (
    <section className="settings-shell">
      <header className="settings-shell__header">
        <div>
          <h1 className="settings-shell__title">Team</h1>
          <p className="settings-shell__lead">
            Invite staff to sign in and work on your shop dashboard with section-based
            access.
          </p>
        </div>
      </header>
      <div className="settings-shell__content">
        <StaffTeamSection />
      </div>
    </section>
  );
}
