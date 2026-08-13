"use client";

import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";

export default function MobileProfilePage() {
  const user = useAuthUser();
  const businessName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    null;

  async function logout() {
    try {
      await apiFetch(apiRoutes.logout, { method: "POST" });
    } catch {
      /* still leave */
    }
    window.location.href = "/sign-in";
  }

  return (
    <>
      <div className="mobile-card">
        <h3>Profile</h3>
        <p style={{ margin: "0 0 0.35rem", fontWeight: 700 }}>{user.name}</p>
        {user.email && (
          <p style={{ color: "var(--station-muted)", margin: "0 0 0.25rem" }}>
            {user.email}
          </p>
        )}
        {user.phone && (
          <p style={{ color: "var(--station-muted)", margin: "0 0 0.25rem" }}>
            {user.phone}
          </p>
        )}
        {businessName && (
          <p style={{ color: "var(--station-muted)", margin: 0 }}>{businessName}</p>
        )}
      </div>

      <div className="mobile-card">
        <h3>Account</h3>
        <div className="station-ticket__actions">
          <button
            type="button"
            className="station-btn station-btn--danger"
            onClick={() => void logout()}
          >
            Log out
          </button>
        </div>
      </div>
    </>
  );
}
