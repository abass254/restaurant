"use client";

import { TransChapInstallPanel } from "@/components/trans-chap/TransChapInstallPanel";
import { TransChapMpesaSettings } from "@/components/trans-chap/TransChapMpesaSettings";

export default function TransChapSettingsPage() {
  return (
    <div className="trans-chap-settings">
      <TransChapMpesaSettings />
      <TransChapInstallPanel showOpenLink={false} />
    </div>
  );
}
