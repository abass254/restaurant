"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { formatNairobiDateTime, formatNairobiListTime } from "@/lib/nairobi-time";
import { formatKsh } from "@/lib/trans-chap-receipt";
import {
  loadTransChapPurchases,
  type TransChapPurchase,
} from "@/lib/trans-chap-purchases";

function accountId(user: { active_account?: { id: string } | null; account?: { id: string } | null }): string {
  return user.active_account?.id || user.account?.id || "local";
}

export function TransChapPurchasesList() {
  const user = useAuthUser();
  const listId = useId();
  const shopId = accountId(user);
  const [purchases, setPurchases] = useState<TransChapPurchase[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setPurchases(loadTransChapPurchases(shopId));
  }, [shopId]);

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
      <div className="trans-chap-sales__filters">
        <label className="trans-chap-sales__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search purchases…"
            aria-label="Search purchases"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="trans-chap-sales__list">
        {purchases.length === 0 ? (
          <p className="trans-chap-sales__empty">
            No purchases yet. Tap + to record a purchase.
          </p>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">No purchases match this search.</p>
        ) : (
          filtered.map((row) => {
            const open = openId === row.id;
            const panelId = `${listId}-${row.id}`;
            const whenLabel = formatNairobiListTime(row.paidAt);
            return (
              <TransChapPanel
                key={row.id}
                id={panelId}
                open={open}
                tone="purchase"
                title={row.productName}
                subtitle={`${formatKsh(row.total)}${whenLabel ? ` · ${whenLabel}` : ""}`}
                badge={{ label: `${row.quantity} bought`, tone: "ok" }}
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
            );
          })
        )}
      </div>
      <Link
        href="/trans-chap/purchases/new"
        className="trans-chap-fab"
        aria-label="Record a new purchase"
      >
        <i className="fa-solid fa-plus" aria-hidden />
      </Link>
    </div>
  );
}
