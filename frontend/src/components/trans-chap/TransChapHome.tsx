"use client";

import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapHomePies } from "@/components/trans-chap/TransChapHomePies";
import { userCanAccessSection } from "@/lib/merchant-permissions";

import { isRestaurantStore } from "@/lib/onboarding";

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || "there";
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

export function TransChapHome() {
  const user = useAuthUser();
  const restaurant = isRestaurantStore(user.active_account ?? user.account);
  const name = firstName(user.name);
  const shop =
    user.active_account?.business_name?.trim() ||
    user.account?.business_name?.trim() ||
    "";
  const canPos = userCanAccessSection(user, "pos");
  const canInventory = userCanAccessSection(user, "inventory");

  const initial = (shop || name).charAt(0).toUpperCase();

  return (
    <div className="trans-chap-home trans-chap-dash">
      <section className="trans-chap-dash__hero" aria-label="Welcome">
        <div className="trans-chap-dash__hero-main">
          <div className="trans-chap-dash__hero-avatar" aria-hidden>
            {initial}
          </div>
          <div className="trans-chap-dash__hero-text">
            <div className="trans-chap-dash__hero-badge">
              <i className="fa-solid fa-calendar-day" aria-hidden />
              <span>{todayLabel()}</span>
            </div>
            <h2>Hi, {name}</h2>
            {shop ? <p className="trans-chap-dash__hero-shop">{shop}</p> : null}
          </div>
        </div>

        <div className="trans-chap-dash__quick-actions">
          {restaurant ? (
            <>
              {canPos ? (
                <Link
                  href="/trans-chap/sales/new?mode=select"
                  className="trans-chap-btn trans-chap-btn--primary"
                >
                  <i className="fa-solid fa-plus" aria-hidden />
                  <span>Take Order</span>
                </Link>
              ) : null}
              {canInventory ? (
                <Link
                  href="/trans-chap/stocks"
                  className="trans-chap-btn trans-chap-btn--secondary"
                >
                  <i className="fa-solid fa-utensils" aria-hidden />
                  <span>Hotel Menu</span>
                </Link>
              ) : null}
              {canInventory ? (
                <Link
                  href="/trans-chap/purchases/new?mode=select"
                  className="trans-chap-btn trans-chap-btn--ghost"
                >
                  <i className="fa-solid fa-basket-shopping" aria-hidden />
                  <span>Buy Supplies</span>
                </Link>
              ) : null}
            </>
          ) : (
            <>
              {canPos ? (
                <Link href="/trans-chap/pos" className="trans-chap-btn trans-chap-btn--primary">
                  <i className="fa-solid fa-cash-register" aria-hidden />
                  <span>Open POS</span>
                </Link>
              ) : null},
              {canInventory ? (
                <Link href="/trans-chap/purchases/new" className="trans-chap-btn trans-chap-btn--ghost">
                  <i className="fa-solid fa-cart-flatbed" aria-hidden />
                  <span>Restock</span>
                </Link>
              ) : null}
            </>
          )}
        </div>
      </section>

      <TransChapHomePies />
    </div>
  );
}

