"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { isRestaurantStore } from "@/lib/onboarding";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import { purchaseDraftSummary } from "@/lib/trans-chap-purchase-draft";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { inventoryRoleLabel } from "@/lib/trans-chap-product";
import {
  fetchTransChapPurchases,
  type TransChapPurchase,
} from "@/lib/trans-chap-purchases";

function purchaseRoleTag(row: TransChapPurchase): string | undefined {
  if (row.inventoryRole === "raw_material") return "Raw";
  if (row.inventoryRole === "both") return "Buy & sell";
  if (row.inventoryRole === "for_sale") return "Sell only";
  return undefined;
}

export function TransChapPurchasesList() {
  const user = useAuthUser();
  const restaurant = isRestaurantStore(user.active_account ?? user.account);
  const accountId = user.active_account?.id || user.account?.id;
  const buyHref = "/trans-chap/purchases/unavailable";
  const listId = useId();
  const [purchases, setPurchases] = useState<TransChapPurchase[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [draftSummary, setDraftSummary] = useState<{
    itemCount: number;
    lineCount: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchTransChapPurchases({ accountId }).then((result) => {
      if (!alive) return;
      setPurchases(result.purchases);
      setError(result.error);
      setTruncated(result.truncated);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [accountId]);

  useEffect(() => {
    function refreshDraft() {
      setDraftSummary(purchaseDraftSummary(accountId));
    }
    refreshDraft();
    window.addEventListener("focus", refreshDraft);
    return () => window.removeEventListener("focus", refreshDraft);
  }, [accountId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return purchases;
    return purchases.filter((row) =>
      [row.productName, row.supplier, String(row.quantity)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [purchases, query]);

  return (
    <div className="trans-chap-sales">
      {draftSummary ? (
        <TransChapStatus
          tone="draft"
          actionHref="/trans-chap/purchases/new"
          actionLabel="Continue"
        >
          {draftSummary.lineCount === 1
            ? `You have a purchase draft (${draftSummary.itemCount} qty).`
            : `You have a purchase draft (${draftSummary.lineCount} items · ${draftSummary.itemCount} qty).`}
        </TransChapStatus>
      ) : null}
      <div className="trans-chap-sales__filters">
        <label className="trans-chap-sales__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder={
              restaurant
                ? "Search kitchen supplies & purchases…"
                : "Search purchases…"
            }
            aria-label={restaurant ? "Search kitchen supplies" : "Search purchases"}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="trans-chap-sales__list">
        {loading ? (
          <TransChapListSkeleton />
        ) : error && purchases.length === 0 ? (
          <TransChapStatus tone="error">{error}</TransChapStatus>
        ) : purchases.length === 0 ? (
          <TransChapStatus
            actionHref={
              restaurant
                ? "/trans-chap/purchases/new?mode=select"
                : "/trans-chap/purchases/new"
            }
            actionLabel={restaurant ? "Buy supplies" : "Record a purchase"}
          >
            {restaurant
              ? "No kitchen supplies or purchases yet. Record ingredients and supplies when you buy them."
              : "No purchases yet."}
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">
            {restaurant
              ? "No kitchen supplies match this search."
              : "No purchases match this search."}
          </p>
        ) : (
          <MotionList as="div" className="trans-chap-sales__stagger">
          {filtered.map((row) => {
            const open = openId === row.id;
            const panelId = `${listId}-${row.id}`;
            return (
              <MotionItem key={row.id} as="div">
              <TransChapPanel
                id={panelId}
                open={open}
                tone="purchase"
                title={row.productName}
                tag={purchaseRoleTag(row)}
                qty={`Qty ${row.quantity}`}
                price={formatKsh(row.total)}
                onToggle={() => setOpenId(open ? null : row.id)}
              >
                <p className="trans-chap-panel__lead">
                  Stock was added for this purchase.
                </p>
                <ul className="trans-chap-panel__lines">
                  <li>
                    <span>
                      {row.productName}
                      {row.quantity > 1 ? ` × ${row.quantity}` : ""}
                    </span>
                    <em>{formatKsh(row.total)}</em>
                  </li>
                </ul>
                <dl className="trans-chap-panel__facts">
                  <div>
                    <dt>Type</dt>
                    <dd>{inventoryRoleLabel(row.inventoryRole)}</dd>
                  </div>
                  <div>
                    <dt>Unit cost</dt>
                    <dd>{formatKsh(row.unitCost)}</dd>
                  </div>
                  <div>
                    <dt>Qty</dt>
                    <dd>{row.quantity}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{formatNairobiDateTime(row.paidAt) || "—"}</dd>
                  </div>
                  <div>
                    <dt>Supplier</dt>
                    <dd>{row.supplier?.trim() || "—"}</dd>
                  </div>
                </dl>
              </TransChapPanel>
              </MotionItem>
            );
          })}
          </MotionList>
        )}
        {truncated ? (
          <p className="trans-chap-sales__empty">Showing the most recent 2,000 purchases.</p>
        ) : null}
      </div>
      <TransChapFab
        label={restaurant ? "Buy supplies" : "New purchase"}
        options={
          restaurant
            ? [
                {
                  href: "/trans-chap/purchases/new?mode=select",
                  label: "Select supplies",
                  icon: "fa-list",
                },
                {
                  href: buyHref,
                  label: "New ingredient / supply",
                  icon: "fa-cart-plus",
                },
              ]
            : [
                { href: "/trans-chap/purchases/new", label: "Select", icon: "fa-list" },
                {
                  href: "/trans-chap/purchases/new?mode=scan",
                  label: "Scan",
                  icon: "fa-barcode",
                },
                {
                  href: buyHref,
                  label: "New product",
                  icon: "fa-cart-plus",
                },
              ]
        }
      />
    </div>
  );
}
