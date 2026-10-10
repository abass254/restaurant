"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import {
  PAYMENT_STATUS_LABELS,
  PO_STATUS_LABELS,
  fetchPurchaseOrders,
  fetchStockTakes,
  fetchSupplyItems,
  formatQty,
  startStockTake,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type StockTake,
  type SupplierSummary,
  type SupplyItem,
} from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { fetchShopSuppliers } from "@/lib/trans-chap-suppliers";
import type { ShopSupplier } from "@/lib/types";

import { RestaurantKitchenTab } from "./RestaurantKitchenTab";
import { RestaurantReportsTab } from "./RestaurantReportsTab";

type Tab = "orders" | "stock" | "kitchen" | "counts" | "reports";

const TABS: { id: Tab; label: string }[] = [
  { id: "orders", label: "Purchase orders" },
  { id: "stock", label: "Supply stock" },
  { id: "kitchen", label: "Kitchen" },
  { id: "counts", label: "Stock counts" },
  { id: "reports", label: "Reports" },
];

const STATUS_FILTERS: { id: PurchaseOrderStatus | "open" | "all"; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "draft", label: "Drafts" },
  { id: "received", label: "Received" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

const OPEN_STATUSES: PurchaseOrderStatus[] = ["draft", "ordered", "partially_received"];

export function poStatusTone(status: PurchaseOrderStatus): string {
  if (status === "received") return "rs-badge--ok";
  if (status === "cancelled") return "rs-badge--bad";
  if (status === "partially_received") return "rs-badge--warn";
  if (status === "ordered") return "rs-badge--info";
  return "";
}

export function paymentTone(status: string): string {
  if (status === "paid") return "rs-badge--ok";
  if (status === "partial") return "rs-badge--warn";
  return "rs-badge--bad";
}

export function RestaurantSuppliesHub() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = TABS.some((item) => item.id === tabParam) ? (tabParam as Tab) : "orders";

  function setTab(next: Tab) {
    const search = new URLSearchParams(params.toString());
    search.set("tab", next);
    router.replace(`${pathname}?${search.toString()}`);
  }

  return (
    <div className="rs">
      <div className="rs-tabs" role="tablist" aria-label="Supplies">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "is-active" : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "orders" ? <OrdersTab initialSupplier={params.get("supplier")} /> : null}
      {tab === "stock" ? <StockTab /> : null}
      {tab === "kitchen" ? <RestaurantKitchenTab /> : null}
      {tab === "counts" ? <CountsTab /> : null}
      {tab === "reports" ? <RestaurantReportsTab /> : null}
    </div>
  );
}

function OrdersTab({ initialSupplier }: { initialSupplier: string | null }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<ShopSupplier[]>([]);
  const [summary, setSummary] = useState<SupplierSummary | null>(null);
  const [status, setStatus] = useState<PurchaseOrderStatus | "open" | "all">("open");
  const [supplierId, setSupplierId] = useState<string>(initialSupplier ?? "");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchShopSuppliers()
      .then(setSuppliers)
      .catch(() => {
        /* supplier filter is optional */
      });
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const handle = setTimeout(() => {
      fetchPurchaseOrders({
        status: status === "open" || status === "all" ? null : status,
        supplierId: supplierId || null,
        q: query,
      })
        .then((res) => {
          if (!alive) return;
          setOrders(
            status === "open" ? res.data.filter((po) => OPEN_STATUSES.includes(po.status)) : res.data,
          );
          setSummary(res.supplier_summary ?? null);
        })
        .catch((err) => {
          if (alive) void showError("Could not load purchase orders", extractErrorMessage(err));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, query ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [status, supplierId, query]);

  const totals = useMemo(
    () => ({
      value: orders.reduce((sum, po) => sum + (po.status === "cancelled" ? 0 : po.total), 0),
      owed: orders.reduce((sum, po) => sum + (po.status === "cancelled" ? 0 : po.balance), 0),
    }),
    [orders],
  );

  return (
    <>
      <div className="rs-row">
        <label className="trans-chap-sales__search" style={{ flex: 1 }}>
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search PO number, supplier or invoice…"
            aria-label="Search purchase orders"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="trans-chap-sales__chips">
        {STATUS_FILTERS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`trans-chap-sales__chip${status === chip.id ? " is-active" : ""}`}
            onClick={() => setStatus(chip.id)}
          >
            {chip.label}
          </button>
        ))}
        {suppliers.length ? (
          <select
            className={`trans-chap-sales__chip trans-chap-sales__select${supplierId ? " is-active" : ""}`}
            value={supplierId}
            aria-label="Supplier"
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">All suppliers</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {summary ? (
        <div className="rs-stats">
          <div className="rs-stat">
            <span>Purchase orders</span>
            <strong>{summary.purchase_orders}</strong>
          </div>
          <div className="rs-stat">
            <span>Bought</span>
            <strong>{formatKsh(summary.total)}</strong>
          </div>
          <div className="rs-stat">
            <span>Paid</span>
            <strong>{formatKsh(summary.paid)}</strong>
          </div>
          <div className="rs-stat">
            <span>Still owed</span>
            <strong className={summary.unpaid > 0 ? "rs-neg" : undefined}>{formatKsh(summary.unpaid)}</strong>
          </div>
        </div>
      ) : !loading && orders.length ? (
        <p className="trans-chap-sales__totals">
          <strong>{formatKsh(totals.value)}</strong>
          <span>
            {orders.length} purchase order{orders.length === 1 ? "" : "s"}
            {totals.owed > 0 ? ` · ${formatKsh(totals.owed)} unpaid` : ""}
          </span>
        </p>
      ) : null}

      {loading ? (
        <p className="rs-empty">Loading purchase orders…</p>
      ) : orders.length === 0 ? (
        <p className="rs-empty">
          No purchase orders here yet. Tap + to order supplies from a supplier.
        </p>
      ) : (
        <ul className="rs-list">
          {orders.map((po) => (
            <li key={po.id}>
              <Link href={`/trans-chap/purchases/po?id=${encodeURIComponent(po.id)}`} className="rs-card">
                <div className="rs-row rs-row--between">
                  <p className="rs-card__title">
                    {po.reference} · {po.supplier_name || "No supplier"}
                  </p>
                  <span className="rs-card__amount">{formatKsh(po.total)}</span>
                </div>
                <div className="rs-row">
                  <em className={`rs-badge ${poStatusTone(po.status)}`}>{PO_STATUS_LABELS[po.status]}</em>
                  {po.status !== "cancelled" && po.status !== "draft" ? (
                    <em className={`rs-badge ${paymentTone(po.payment_status)}`}>
                      {PAYMENT_STATUS_LABELS[po.payment_status]}
                    </em>
                  ) : null}
                  <span className="rs-card__meta">
                    {po.lines.length} item{po.lines.length === 1 ? "" : "s"}
                    {po.order_date ? ` · ${po.order_date}` : ""}
                    {po.expected_date && OPEN_STATUSES.includes(po.status) ? ` · due ${po.expected_date}` : ""}
                  </span>
                </div>
                <p className="rs-card__meta">
                  {po.lines.slice(0, 4).map((line) => line.item_name).join(", ")}
                  {po.lines.length > 4 ? ` +${po.lines.length - 4} more` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <TransChapFab label="New purchase order" href="/trans-chap/purchases/new" />
    </>
  );
}

function StockTab() {
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchSupplyItems()
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch((err) => {
        if (alive) void showError("Could not load supplies", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = items.filter(
    (item) => (!needle || item.name.toLowerCase().includes(needle)) && (!lowOnly || isShort(item)),
  );
  const lowItems = items.filter(isShort);
  const split = items.some((item) => item.kitchen_quantity != null);
  const stockValue = items.reduce((sum, item) => {
    const held = Math.max(item.stock_quantity ?? 0, 0) + Math.max(item.kitchen_quantity ?? 0, 0);
    return sum + (item.average_cost ? held * item.average_cost : 0);
  }, 0);

  return (
    <>
      <div className="rs-row">
        <label className="trans-chap-sales__search" style={{ flex: 1 }}>
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search supplies…"
            aria-label="Search supplies"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={`trans-chap-sales__chip${lowOnly ? " is-active" : ""}`}
          onClick={() => setLowOnly((on) => !on)}
        >
          Low / out ({lowItems.length})
        </button>
      </div>
      {!loading && items.length ? (
        <div className="rs-row rs-row--between">
          <p className="trans-chap-sales__totals">
            <strong>{formatKsh(stockValue)}</strong>
            <span>stock value at average cost</span>
          </p>
          {lowItems.length ? (
            <Link
              className="rs-btn rs-btn--small rs-btn--primary"
              href={`/trans-chap/purchases/new?items=${lowItems.map((item) => item.id).join(",")}`}
            >
              Reorder low stock
            </Link>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <p className="rs-empty">Loading supplies…</p>
      ) : visible.length === 0 ? (
        <p className="rs-empty">
          {items.length
            ? "No supplies match."
            : "No supplies yet. Add ingredients and drinks to your inventory, then buy them here."}
        </p>
      ) : (
        <ul className="rs-list">
          {visible.map((item) => (
            <li key={item.id}>
              <Link href={`/trans-chap/purchases/item?id=${encodeURIComponent(item.id)}`} className="rs-card">
                <div className="rs-row rs-row--between">
                  <p className="rs-card__title">{item.name}</p>
                  <span className={`rs-card__amount${(item.stock_quantity ?? 0) < 0 ? " rs-neg" : ""}`}>
                    {item.stock_quantity == null
                      ? "Not tracked"
                      : `${split ? "Store " : ""}${formatQty(item.stock_quantity, item.base_unit)}`}
                  </span>
                </div>
                {item.kitchen_quantity != null ? (
                  <p className={`rs-card__meta${item.kitchen_quantity < 0 ? " rs-neg" : ""}`}>
                    Kitchen {formatQty(item.kitchen_quantity, item.base_unit)}
                  </p>
                ) : null}
                <div className="rs-row">
                  <em className="rs-badge">
                    {item.inventory_role === "raw_material"
                      ? "Ingredient"
                      : item.inventory_role === "for_sale"
                        ? "Sold as is"
                        : "Ingredient & sold"}
                  </em>
                  {isShort(item) ? (
                    <em className="rs-badge rs-badge--bad">
                      {(item.stock_quantity ?? 0) <= 0 ? "Out of stock" : "Low stock"}
                    </em>
                  ) : null}
                  <span className="rs-card__meta">
                    {item.average_cost != null
                      ? `Avg cost ${formatKsh(item.average_cost)} / ${item.base_unit}`
                      : "No cost yet"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <TransChapFab label="New purchase order" href="/trans-chap/purchases/new" />
    </>
  );
}

function isShort(item: SupplyItem): boolean {
  if (item.stock_quantity == null) return false;
  return item.stock_quantity <= 0 || item.is_low_stock;
}

function CountsTab() {
  const router = useRouter();
  const user = useAuthUser();
  const canApply = isStoreAdmin(user);
  const [takes, setTakes] = useState<StockTake[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchStockTakes("store")
      .then((rows) => {
        if (alive) setTakes(rows);
      })
      .catch((err) => {
        if (alive) void showError("Could not load stock counts", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function start() {
    setStarting(true);
    try {
      const take = await startStockTake("store");
      router.push(`/trans-chap/purchases/count?id=${encodeURIComponent(take.id)}`);
    } catch (err) {
      await showError("Could not start a count", extractErrorMessage(err));
      setStarting(false);
    }
  }

  const open = takes.find((take) => take.status === "draft");

  return (
    <>
      <p className="rs-card__meta">
        Count what is physically on your store shelves. Differences from the system figure are recorded as
        stock-count variance, so losses never disappear silently. Kitchen close-out counts are on the Kitchen tab.
        {canApply ? "" : " Only the shop owner can apply a count."}
      </p>
      {open ? (
        <Link className="rs-btn rs-btn--primary" href={`/trans-chap/purchases/count?id=${encodeURIComponent(open.id)}`}>
          Continue count in progress ({open.counted_count}/{open.line_count})
        </Link>
      ) : (
        <button type="button" className="rs-btn rs-btn--primary" disabled={starting} onClick={() => void start()}>
          {starting ? "Starting…" : "Start a stock count"}
        </button>
      )}
      {loading ? (
        <p className="rs-empty">Loading counts…</p>
      ) : takes.length === 0 ? (
        <p className="rs-empty">No stock counts yet.</p>
      ) : (
        <ul className="rs-list">
          {takes.map((take) => (
            <li key={take.id}>
              <Link href={`/trans-chap/purchases/count?id=${encodeURIComponent(take.id)}`} className="rs-card">
                <div className="rs-row rs-row--between">
                  <p className="rs-card__title">
                    {formatNairobiStamp24(take.counted_at || take.created_at) || "Stock count"}
                  </p>
                  {take.status === "completed" ? (
                    <span className={`rs-card__amount ${take.variance_value < 0 ? "rs-neg" : take.variance_value > 0 ? "rs-pos" : ""}`}>
                      {take.variance_value > 0 ? "+" : ""}
                      {formatKsh(take.variance_value)}
                    </span>
                  ) : null}
                </div>
                <div className="rs-row">
                  <em
                    className={`rs-badge ${
                      take.status === "completed" ? "rs-badge--ok" : take.status === "cancelled" ? "rs-badge--bad" : "rs-badge--warn"
                    }`}
                  >
                    {take.status === "draft" ? "In progress" : take.status === "completed" ? "Applied" : "Cancelled"}
                  </em>
                  <span className="rs-card__meta">
                    {take.counted_count} of {take.line_count} counted
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
