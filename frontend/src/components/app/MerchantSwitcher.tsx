"use client";

import { useAuthSwitchMerchant } from "@/components/app/AuthProvider";
import type { AuthUser } from "@/lib/types";

type MerchantSwitcherProps = {
  user: AuthUser;
  className?: string;
};

export function MerchantSwitcher({
  user,
  className = "merchant-switch",
}: MerchantSwitcherProps) {
  const memberships = user.memberships ?? [];
  const activeAccount = user.active_account ?? user.account;
  const switchMerchant = useAuthSwitchMerchant();

  if (!activeAccount || memberships.length === 0) {
    return null;
  }

  // Single-store accounts don't need a switcher — the name already shows in the profile.
  if (memberships.length < 2) {
    return null;
  }

  async function onChange(accountId: string) {
    const next = await switchMerchant(accountId);
    if (next) {
      window.location.reload();
    }
  }

  return (
    <label className={className}>
      <select
        className={`${className}__select`}
        value={activeAccount.id}
        aria-label="Switch store"
        onChange={(e) => void onChange(e.target.value)}
      >
        {memberships.map((membership) => (
          <option key={membership.id} value={membership.account_id}>
            {membership.account.business_name}
          </option>
        ))}
      </select>
    </label>
  );
}
