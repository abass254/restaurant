"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { isInternalToolsUser } from "@/lib/internal-tools-access";

export default function ToolsWhatsappPage() {
  const user = useAuthUser();
  const router = useRouter();
  const allowed = isInternalToolsUser(user);

  useEffect(() => {
    if (!allowed) {
      router.replace("/tools/starters");
    }
  }, [allowed, router]);

  if (!allowed) return null;

  return (
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">WhatsApp</h1>
          <p className="app-lead">
            Customer order alerts now use a single platform WhatsApp session (openWA)
            as the primary notifier — managed under <strong>Admin → WhatsApp</strong>.
            Merchants do not connect or scan a number here. Meta Cloud API will replace
            openWA later without a merchant setup step.
          </p>
        </div>
      </header>
    </section>
  );
}
