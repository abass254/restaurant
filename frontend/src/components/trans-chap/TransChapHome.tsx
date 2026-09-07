"use client";

import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapHomePies } from "@/components/trans-chap/TransChapHomePies";
import { formatNavBadgeCount } from "@/lib/merchant-nav";
import { liftHover } from "@/lib/motion";
import { userCanAccessSection, type MerchantSection } from "@/lib/merchant-permissions";
import { useNavCounts } from "@/lib/use-nav-counts";

type DashTone = "sale" | "purchase" | "stock" | "records" | "social" | "credit";

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
  { href: "/trans-chap/stocks", label: "Inventory", icon: "fa-boxes-stacked", tone: "stock" },
  { href: "/trans-chap/reports", label: "Reports", icon: "fa-chart-column", tone: "records" },
  {
    href: "/trans-chap/chats",
    label: "Chats",
    icon: "fa-comments",
    tone: "social",
    section: "tickets",
    requiresInstagram: true,
    badgeKey: "messages",
  },
  {
    href: "/trans-chap/feeds",
    label: "Feeds",
    icon: "fa-images",
    tone: "social",
    section: "feeds",
    requiresInstagram: true,
  },
];

const ACTION_TILES: DashTile[] = [
  { href: "/trans-chap/make-a-sale/new", label: "New sale", icon: "fa-cash-register", tone: "sale" },
  { href: "/trans-chap/purchases/new", label: "New purchase", icon: "fa-cart-plus", tone: "purchase" },
  { href: "/trans-chap/credit", label: "On tab", icon: "fa-file-invoice", tone: "credit" },
  { href: "/trans-chap/stocks/stock-up", label: "Stock up", icon: "fa-box-open", tone: "stock" },
];

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || "there";
}

function DashTileLink({
  tile,
  badgeCount = 0,
}: {
  tile: DashTile;
  badgeCount?: number;
}) {
  const badgeLabel = formatNavBadgeCount(badgeCount);
  const reduce = useReducedMotion();
  return (
    <MotionItem as="div" {...(reduce ? {} : liftHover)}>
      <Link
        href={tile.href}
        className={`trans-chap-dash__tile trans-chap-dash__tile--${tile.tone}`}
        aria-label={badgeCount > 0 ? `${tile.label}, ${badgeCount} new` : tile.label}
      >
        <span className="trans-chap-dash__tile-icon">
          <i className={`fa-solid ${tile.icon}`} aria-hidden />
          {badgeLabel ? (
            <em className="trans-chap-dash__tile-badge" aria-hidden="true">
              {badgeLabel}
            </em>
          ) : null}
        </span>
        <span className="trans-chap-dash__tile-label">{tile.label}</span>
      </Link>
    </MotionItem>
  );
}

export function TransChapHome() {
  const user = useAuthUser();
  const counts = useNavCounts();
  const name = firstName(user.name);
  const email = user.email?.trim() || user.phone || "";
  const instagramConnected = Boolean(user.instagram_account);

  const lookupTiles = LOOKUP_TILES.filter((tile) => {
    if (tile.section && !userCanAccessSection(user, tile.section)) return false;
    if (tile.requiresInstagram && !instagramConnected) return false;
    return true;
  });

  return (
    <div className="trans-chap-home trans-chap-dash">
      <section className="trans-chap-dash__hello">
        <h2>Welcome, {name}</h2>
        {email ? <p>{email}</p> : null}
      </section>

      <TransChapHomePies />

      <section className="trans-chap-dash__section" aria-labelledby="trans-chap-action-heading">
        <h3 id="trans-chap-action-heading">Record</h3>
        <MotionList className="trans-chap-dash__grid trans-chap-dash__grid--quad" as="div">
          {ACTION_TILES.map((tile) => (
            <DashTileLink key={tile.label} tile={tile} />
          ))}
        </MotionList>
      </section>

      <section className="trans-chap-dash__section" aria-labelledby="trans-chap-lookup-heading">
        <h3 id="trans-chap-lookup-heading">Your shop</h3>
        <MotionList className="trans-chap-dash__grid" as="div" staggerChildren={0.05}>
          {lookupTiles.map((tile) => (
            <DashTileLink
              key={tile.label}
              tile={tile}
              badgeCount={tile.badgeKey ? counts[tile.badgeKey] : 0}
            />
          ))}
        </MotionList>
      </section>
    </div>
  );
}
