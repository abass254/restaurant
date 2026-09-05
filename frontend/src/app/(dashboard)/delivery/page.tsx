"use client";

import { BusinessLocationSection } from "@/components/app/BusinessLocationSection";
import { DeliveryBoard } from "@/components/app/DeliveryBoard";
import { RidersSettingsSection } from "@/components/app/RidersSettingsSection";
import { TestDeliveryDispatchSection } from "@/components/app/TestDeliveryDispatchSection";
import { useAuthUser } from "@/components/app/AuthProvider";
import { accountHasLocationCoordinates } from "@/lib/account-location";
import { isInternalToolsUser } from "@/lib/internal-tools-access";

export default function DeliveryPage() {
  const user = useAuthUser();
  const account = user.active_account ?? user.account;
  const hasPin = accountHasLocationCoordinates(account);
  const showTestDispatch = isInternalToolsUser(user);

  return (
    <DeliveryBoard>
      <details className="delivery-setup" open={!hasPin}>
        <summary>Store pin and riders</summary>
        <div className="delivery-setup__body">
          <article id="section-store-location" className="settings-card">
            <header className="settings-card__head">
              <div className="settings-card__title">
                <i className="fa-solid fa-location-dot settings-card__icon" aria-hidden="true" />
                <h2>Store location</h2>
              </div>
              <span className={`settings-pill settings-pill--${hasPin ? "ok" : "warn"}`}>
                {hasPin ? "Pinned" : "Required"}
              </span>
            </header>
            <div className="settings-card__body">
              {account ? (
                <BusinessLocationSection
                  account={account}
                  hideSignedInAs
                  requiredForRiders
                />
              ) : (
                <p className="settings-muted">No shop is linked to this account yet.</p>
              )}
            </div>
          </article>
          <RidersSettingsSection />
          {showTestDispatch ? <TestDeliveryDispatchSection /> : null}
        </div>
      </details>
    </DeliveryBoard>
  );
}
