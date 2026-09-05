"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { formatNairobiDateTime, formatNairobiListTime } from "@/lib/nairobi-time";
import { formatKsh } from "@/lib/trans-chap-receipt";
import {
  fetchTransChapPurchases,
  type TransChapPurchase,
} from "@/lib/trans-chap-purchases";

export function TransChapPurchasesList() {
  const user = useAuthUser();
  const accountId = user.active_account?.id || user.account?.id;
  const listId = useId();
  const [purchases, setPurchases] = useState<TransChapPurchase[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

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
        {loading ? (
          <TransChapListSkeleton />
        ) : error && purchases.length === 0 ? (
          <TransChapStatus tone="error">{error}</TransChapStatus>
        ) : purchases.length === 0 ? (
          <TransChapStatus
            actionHref="/trans-chap/purchases/new"
            actionLabel="Record a purchase"
          >
            No purchases yet.
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">No purchases match this search.</p>
        ) : (
          <MotionList as="div" className="trans-chap-sales__stagger">
          {filtered.map((row) => {
            const open = openId === row.id;
            const panelId = `${listId}-${row.id}`;
            const whenLabel = formatNairobiListTime(row.paidAt);
            return (
              <MotionItem key={row.id} as="div">
              <TransChapPanel
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
              </MotionItem>
            );
          })}
          </MotionList>
        )}
        {truncated ? (
          <p className="trans-chap-sales__empty">Showing the most recent 2,000 purchases.</p>
        ) : null}
      </div>
    </div>
  );
}
