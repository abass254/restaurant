"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDateTime, formatNairobiListTime, nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import {
  orderHasPendingMpesa,
  orderHasSuccessfulMpesa,
} from "@/lib/orders";
import { formatKsh, receiptFromOrder, transChapReceiptHref } from "@/lib/trans-chap-receipt";
import type { Order, OrdersListResponse } from "@/lib/types";

type WhenFilter = "all" | "today" | "week";
type MethodFilter = "all" | "cash" | "mpesa";
type StatusFilter = "all" | "paid" | "waiting" | "failed";

type ChipOption<T extends string> = { id: T; label: string };

const WHEN_CHIPS: ChipOption<Exclude<WhenFilter, "all">>[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
];

const METHOD_CHIPS: ChipOption<Exclude<MethodFilter, "all">>[] = [
  { id: "cash", label: "Cash" },
  { id: "mpesa", label: "M-PESA" },
];

const STATUS_CHIPS: ChipOption<Exclude<StatusFilter, "all">>[] = [
  { id: "paid", label: "Paid" },
  { id: "waiting", label: "Waiting" },
  { id: "failed", label: "Failed" },
];

function saleStatus(order: Order): { label: string; tone: "ok" | "wait" | "fail" } {
  if (order.payment_method !== "mpesa") {
    return { label: "Paid", tone: "ok" };
  }
  if (orderHasSuccessfulMpesa(order)) {
    return { label: "Paid", tone: "ok" };
  }
  if (orderHasPendingMpesa(order) || order.status === "awaiting_payment") {
    return { label: "Waiting", tone: "wait" };
  }
  return { label: "Failed", tone: "fail" };
}

function orderDateKey(order: Order): string | null {
  const date = parseIso(order.paid_at || order.placed_at || order.created_at);
  return date ? nairobiDateKey(date) : null;
}

function isWithinLastDays(key: string, days: number, todayKey: string): boolean {
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const [ky, km, kd] = key.split("-").map(Number);
  const diff =
    (Date.UTC(ty, tm - 1, td) - Date.UTC(ky, km - 1, kd)) / 86_400_000;
  return diff >= 0 && diff < days;
}

function matchesQuery(order: Order, query: string): boolean {
  if (!query) return true;
  const haystack = [
    order.items?.[0]?.product_name,
    order.order_number,
    order.customer_name,
    order.customer_phone,
    order.mpesa_transaction?.mpesa_receipt_number,
    ...(order.mpesa_transactions?.map((txn) => txn.mpesa_receipt_number) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | "all";
  options: ChipOption<T>[];
  onChange: (id: T | "all") => void;
}) {
  return (
    <div className="trans-chap-sales__chips-group" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`trans-chap-sales__chip${value === option.id ? " is-active" : ""}`}
          aria-pressed={value === option.id}
          onClick={() => onChange(value === option.id ? "all" : option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TransChapSalesList() {
  const user = useAuthUser();
  const listId = useId();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [when, setWhen] = useState<WhenFilter>("all");
  const [method, setMethod] = useState<MethodFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<OrdersListResponse>(
        `${apiRoutes.orders}?source=walkin&per_page=100`,
      );
      setOrders(data.data);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("when");
    if (value === "today" || value === "week") {
      setWhen(value);
      setFiltersOpen(true);
    }
  }, []);

  const todayKey = nairobiDateKey(new Date());
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (!matchesQuery(order, needle)) return false;
      if (method === "cash" && order.payment_method === "mpesa") return false;
      if (method === "mpesa" && order.payment_method !== "mpesa") return false;
      const tone = saleStatus(order).tone;
      if (status === "paid" && tone !== "ok") return false;
      if (status === "waiting" && tone !== "wait") return false;
      if (status === "failed" && tone !== "fail") return false;
      if (when === "all") return true;
      const key = orderDateKey(order);
      if (!key) return false;
      if (when === "today") return key === todayKey;
      return isWithinLastDays(key, 7, todayKey);
    });
  }, [method, orders, query, status, todayKey, when]);

  const activeFilterCount =
    Number(when !== "all") + Number(method !== "all") + Number(status !== "all");
  const filtersOn = activeFilterCount > 0 || query.trim() !== "";
  const filterSummary = [
    when === "today" ? "Today" : when === "week" ? "7 days" : null,
    method === "cash" ? "Cash" : method === "mpesa" ? "M-PESA" : null,
    status === "paid" ? "Paid" : status === "waiting" ? "Waiting" : status === "failed" ? "Failed" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="trans-chap-sales">
      <div className="trans-chap-sales__filters">
        <div className="trans-chap-sales__search-row">
          <label className="trans-chap-sales__search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search sales…"
              aria-label="Search sales"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={`trans-chap-sales__filter-btn${filtersOpen || activeFilterCount ? " is-on" : ""}`}
            aria-expanded={filtersOpen}
            aria-controls="trans-chap-sales-filters"
            aria-label="Filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <i className="fa-solid fa-sliders" aria-hidden />
            {activeFilterCount ? <em>{activeFilterCount}</em> : null}
          </button>
        </div>
        {filtersOpen ? (
          <div id="trans-chap-sales-filters" className="trans-chap-sales__chips">
            <FilterChips label="When" value={when} options={WHEN_CHIPS} onChange={setWhen} />
            <FilterChips label="Payment" value={method} options={METHOD_CHIPS} onChange={setMethod} />
            <FilterChips label="Status" value={status} options={STATUS_CHIPS} onChange={setStatus} />
            {activeFilterCount ? (
              <button
                type="button"
                className="trans-chap-sales__chip trans-chap-sales__chip--clear"
                onClick={() => {
                  setWhen("all");
                  setMethod("all");
                  setStatus("all");
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : filterSummary ? (
          <button
            type="button"
            className="trans-chap-sales__summary"
            onClick={() => setFiltersOpen(true)}
          >
            {filterSummary}
          </button>
        ) : null}
      </div>
      <div className="trans-chap-sales__list">
        {loading ? (
          <p className="trans-chap-sales__empty">Loading sales…</p>
        ) : orders.length === 0 ? (
          <p className="trans-chap-sales__empty">No sales yet. Tap + to make a sale.</p>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">
            {filtersOn
              ? "No sales match these filters."
              : "No sales yet. Tap + to make a sale."}
          </p>
        ) : (
          filtered.map((order) => {
            const product = order.items?.[0]?.product_name || "Sale";
            const extra = (order.items?.length ?? 0) > 1
              ? ` +${(order.items?.length ?? 0) - 1}`
              : "";
            const sale = saleStatus(order);
            const open = openId === order.id;
            const panelId = `${listId}-${order.id}`;
            const receipt = receiptFromOrder(order, shopName);
            const paidAt = formatNairobiDateTime(receipt.paidAt);
            const whenLabel = formatNairobiListTime(receipt.paidAt);
            return (
              <TransChapPanel
                key={order.id}
                id={panelId}
                open={open}
                tone="sale"
                title={`${product}${extra}`}
                subtitle={`${formatKsh(order.total)}${whenLabel ? ` · ${whenLabel}` : ""}`}
                badge={sale}
                onToggle={() => setOpenId(open ? null : order.id)}
                headAction={
                  <Link
                    href={transChapReceiptHref(order.id)}
                    className="trans-chap-panel__receipt"
                    aria-label={`Open receipt for ${product}`}
                  >
                    <i className="fa-solid fa-receipt" aria-hidden />
                  </Link>
                }
                action={
                  <Link href={transChapReceiptHref(order.id)} className="trans-chap-panel__link">
                    Open receipt
                  </Link>
                }
              >
                <p className="trans-chap-panel__lead">
                  {sale.tone === "ok"
                    ? "Payment received."
                    : sale.tone === "wait"
                      ? "Waiting for the customer to complete M-PESA."
                      : "M-PESA didn’t go through."}
                </p>
                <ul className="trans-chap-panel__lines">
                  {(order.items ?? []).map((line) => (
                    <li key={line.id || `${line.product_name}-${line.quantity}`}>
                      <span>
                        {line.product_name}
                        {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                      </span>
                      <em>{formatKsh(line.line_total)}</em>
                    </li>
                  ))}
                </ul>
                <dl className="trans-chap-panel__facts">
                  <div>
                    <dt>Ref</dt>
                    <dd>{receipt.orderNumber}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{paidAt || "—"}</dd>
                  </div>
                  <div>
                    <dt>Method</dt>
                    <dd>{receipt.payMode === "mpesa" ? "M-PESA" : "Cash"}</dd>
                  </div>
                  <div>
                    <dt>Customer</dt>
                    <dd>{receipt.customerName?.trim() || "Walk-in"}</dd>
                  </div>
                  {receipt.mpesaReceiptNumber ? (
                    <div>
                      <dt>M-PESA code</dt>
                      <dd>{receipt.mpesaReceiptNumber}</dd>
                    </div>
                  ) : null}
                </dl>
              </TransChapPanel>
            );
          })
        )}
      </div>
      <Link
        href="/trans-chap/make-a-sale/new"
        className="trans-chap-fab"
        aria-label="Make a new sale"
      >
        <i className="fa-solid fa-plus" aria-hidden />
      </Link>
    </div>
  );
}
