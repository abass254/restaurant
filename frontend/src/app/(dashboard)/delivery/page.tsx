"use client";

import { RidersSettingsSection } from "@/components/app/RidersSettingsSection";
import { TestDeliveryDispatchSection } from "@/components/app/TestDeliveryDispatchSection";

export default function DeliveryPage() {
  return (
    <section className="settings-shell">
      <header className="settings-shell__header">
        <div>
          <h1 className="settings-shell__title">Delivery</h1>
          <p className="settings-shell__lead">
            Watch your fleet go online, pin test drop-offs on the map, and invite
            new delivery partners.
          </p>
        </div>
      </header>
      <div className="settings-shell__content">
        <RidersSettingsSection />
        <TestDeliveryDispatchSection />
      </div>
    </section>
  );
}
