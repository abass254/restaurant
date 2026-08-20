"use client";

import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapHomePies } from "@/components/trans-chap/TransChapHomePies";
import { formatNavBadgeCount } from "@/lib/merchant-nav";
import { userCanAccessSection, type MerchantSection } from "@/lib/merchant-permissions";
import { useNavCounts } from "@/lib/use-nav-counts";

type DashTone = "sale" | "cash" | "mpesa" | "records" | "shop";

type DashTile = {
  href: string;
  label: string;
  icon: string;
  tone: DashTone;
  section?: MerchantSection;
  requiresInstagram?: boolean;
  badgeKey?: "messages";
};

const LOOKUP_TILES: DashTile[] = [
  { href: "/trans-chap/make-a-sale", label: "Sales", icon: "fa-list", tone: "records" },
  { href: "/trans-chap/purchases", label: "Purchases", icon: "fa-truck", tone: "cash" },
  { href: "/trans-chap/stocks", label: "Stocks", icon: "fa-boxes-stacked", tone: "sale" },
  {
    href: "/trans-chap/chats",
    label: "Chats",
    icon: "fa-comments",
    tone: "records",
    section: "tickets",
    requiresInstagram: true,
    badgeKey: "messages",
  },
  {
    href: "/trans-chap/feeds",
    label: "Feeds",
    icon: "fa-images",
    tone: "mpesa",
    section: "feeds",
    requiresInstagram: true,
  },
  { href: "/trans-chap/reports", label: "Reports", icon: "fa-chart-column", tone: "records" },
  { href: "/trans-chap/settings", label: "Settings", icon: "fa-gear", tone: "shop" },
];

const ACTION_TILES: DashTile[] = [
  { href: "/trans-chap/make-a-sale/new", label: "New sale", icon: "fa-cash-register", tone: "sale" },
  { href: "/trans-chap/purchases/new", label: "New purchase", icon: "fa-cart-plus", tone: "cash" },
  { href: "/trans-chap/stocks/stock-up", label: "Stock up", icon: "fa-box-open", tone: "mpesa" },
];

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || "there";
}

function DashTileLink({
  tile,
  disabled,
  badgeCount = 0,
}: {
  tile: DashTile;
  disabled?: boolean;
  badgeCount?: number;
}) {
  const badgeLabel = formatNavBadgeCount(badgeCount);
  const icon = (
    <span className="trans-chap-dash__tile-icon">
      <i className={`fa-solid ${tile.icon}`} aria-hidden />
      {badgeLabel ? (
        <em className="trans-chap-dash__tile-badge" aria-hidden="true">
          {badgeLabel}
        </em>
      ) : null}
    </span>
  );

  if (disabled) {
    return (
      <span
        className={`trans-chap-dash__tile trans-chap-dash__tile--${tile.tone} is-disabled`}
        aria-disabled="true"
        title="Connect Instagram to use this"
      >
        {icon}
        <span className="trans-chap-dash__tile-label">{tile.label}</span>
      </span>
    );
  }

  return (
    <Link
      href={tile.href}
      className={`trans-chap-dash__tile trans-chap-dash__tile--${tile.tone}`}
      aria-label={badgeCount > 0 ? `${tile.label}, ${badgeCount} new` : tile.label}
    >
      {icon}
      <span className="trans-chap-dash__tile-label">{tile.label}</span>
    </Link>
  );
}

export function TransChapHome() {
  const user = useAuthUser();
  const counts = useNavCounts();
  const name = firstName(user.name);
  const email = user.email?.trim() || user.phone || "";
  const instagramConnected = Boolean(user.instagram_account);

  return (
    <div className="trans-chap-home trans-chap-dash">
      <section className="trans-chap-dash__hello">
        <h2>Welcome, {name}</h2>
        {email ? <p>{email}</p> : null}
      </section>

      <TransChapHomePies />

      <section className="trans-chap-dash__section" aria-labelledby="trans-chap-lookup-heading">
        <h3 id="trans-chap-lookup-heading">Your shop</h3>
        <div className="trans-chap-dash__grid">
          {LOOKUP_TILES.filter(
            (tile) => !tile.section || userCanAccessSection(user, tile.section),
          ).map((tile) => (
            <DashTileLink
              key={tile.label}
              tile={tile}
              disabled={Boolean(tile.requiresInstagram && !instagramConnected)}
              badgeCount={tile.badgeKey ? counts[tile.badgeKey] : 0}
            />
          ))}
        </div>
      </section>

      <section className="trans-chap-dash__section" aria-labelledby="trans-chap-action-heading">
        <h3 id="trans-chap-action-heading">Record</h3>
        <div className="trans-chap-dash__grid">
          {ACTION_TILES.map((tile) => (
            <DashTileLink key={tile.label} tile={tile} />
          ))}
        </div>
      </section>
    </div>
  );
}
