"use client";

import Link from "next/link";
import { RestaurantKitchenTab } from "./RestaurantKitchenTab";

export function RestaurantInventorySection() {
  return (
    <div className="rs">
      <header className="rs-hero" style={{ marginBottom: "0.5rem" }}>
        <div className="rs-row rs-row--between" style={{ alignItems: "flex-start", gap: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0, letterSpacing: "-0.01em" }}>
              Store Inventory
            </h2>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.84rem", color: "var(--app-text-secondary)" }}>
              Manage ingredients and supplies stored in the main store and release portions to the kitchen for meal preparation.
            </p>
          </div>
          <div className="rs-row" style={{ gap: "0.5rem" }}>
            <Link
              href="/trans-chap/purchases/issue?new=1&from=store"
              className="rs-btn rs-btn--primary"
              style={{ fontWeight: 700 }}
            >
              <i className="fa-solid fa-dolly" aria-hidden /> Release to Kitchen
            </Link>
            <Link href="/trans-chap/purchases/new" className="rs-btn">
              <i className="fa-solid fa-basket-shopping" aria-hidden /> Buy Supplies
            </Link>
          </div>
        </div>
      </header>

      <RestaurantKitchenTab />
    </div>
  );
}
