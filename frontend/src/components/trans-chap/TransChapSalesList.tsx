"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { TransChapViewToggle } from "@/components/trans-chap/TransChapViewToggle";
import { TransChapFilterChips, type ChipOption } from "@/components/trans-chap/TransChapFilterChips";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { summarizeFailures, useTransChapListView } from "@/lib/trans-chap-list-view";
import { showError, showInternalError, toastSuccess, promptMpesaReceipt, promptPendingStk, extractErrorMessage } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { formatNairobiStamp24, isWithinLastDays, nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import {
  orderHasPendingMpesa,
  orderHasSuccessfulMpesa,
} from "@/lib/orders";
import { buildMpesaFlowSteps, MpesaFlowStatus } from "@/components/app/MpesaFlowStatus";
import {
  fetchWalkinOrders,
  promptAndUndoWalkinSale,
  promptAndUndoWalkinSales,
  walkinUndoAction,
} from "@/lib/trans-chap-orders";
import { formatKsh, receiptFromOrder, transChapPayLabel, transChapReceiptHref } from "@/lib/trans-chap-receipt";
import type { Order, OrderMutationResponse } from "@/lib/types";

type WhenFilter = "all" | "today" | "week";
type MethodFilter = "all" | "credit" | "mpesa";
type StatusFilter = "all" | "paid" | "waiting" | "failed" | "voided";

const WHEN_CHIPS: ChipOption<Exclude<WhenFilter, "all">>[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
];

const METHOD_CHIPS: ChipOption<Exclude<MethodFilter, "all">>[] = [
  { id: "credit", label: "Credit" },
  { id: "mpesa", label: "M-PESA" },
];

const STATUS_CHIPS: ChipOption<Exclude<StatusFilter, "all">>[] = [
  { id: "paid", label: "Paid" },
  { id: "waiting", label: "Waiting" },
  { id: "failed", label: "Failed" },
  { id: "voided", label: "Voided" },
];

function saleStatus(order: Order): { label: string; tone: "ok" | "wait" | "fail" | "credit" } {
  if (order.status === "cancelled") {
    return { label: "Voided", tone: "fail" };
  }
  if (order.status === "refunded") {
    return { label: "Refunded", tone: "fail" };
  }
  if (order.payment_method === "credit") {
    return { label: "On credit", tone: "credit" };
  }
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

function matchesQuery(order: Order, query: string): boolean {
  if (!query) return true;
  const haystack = [
    ...(order.items?.map((line) => line.product_name) ?? []),
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

export function TransChapSalesList() {
  const user = useAuthUser();
  const listId = useId();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [when, setWhen] = useState<WhenFilter>("all");
  const [method, setMethod] = useState<MethodFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [stkBusyId, setStkBusyId] = useState<string | null>(null);
  const [view, setView] = useTransChapListView("trans-chap-sales-view");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkUndoing, setBulkUndoing] = useState(false);
  const canVoid = isStoreAdmin(user);
  const undoActionFor = (order: Order) => (canVoid ? walkinUndoAction(order) : null);
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await fetchWalkinOrders();
    setOrders(result.orders);
    setError(result.error);
    setTruncated(result.truncated);
    setLoading(false);
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

  async function undoSale(order: Order) {
    setUndoingId(order.id);
    try {
      const updated = await promptAndUndoWalkinSale(order);
      if (!updated) return;
      setOrders((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      await toastSuccess(updated.status === "refunded" ? "Sale refunded" : "Sale voided");
    } catch {
      await showInternalError();
    } finally {
      setUndoingId(null);
    }
  }

  async function handlePendingStk(order: Order) {
    const choice = await promptPendingStk();
    if (!choice) return;
    setStkBusyId(order.id);
    try {
      if (choice === "enter_code") {
        const receipt = await promptMpesaReceipt(
          "Enter M-PESA code",
          "Type the transaction code from the customer’s SMS. Use this when they paid you directly or already finished on their phone.",
        );
        if (!receipt) return;
        const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(order.id), {
          method: "POST",
          body: JSON.stringify({
            to_status: "payment_received",
            mpesa_receipt_number: receipt,
          }),
        });
        setOrders((prev) => prev.map((row) => (row.id === data.data.id ? data.data : row)));
        await toastSuccess("M-PESA sale closed");
        return;
      }
      if (choice === "check") {
        const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderMpesaCheck(order.id), {
          method: "POST",
          body: "{}",
        });
        setOrders((prev) => prev.map((row) => (row.id === data.data.id ? data.data : row)));
        if (data.outcome === "paid") {
          await toastSuccess("Customer already paid");
        } else {
          await showError("Still waiting", "Please try again in a moment.");
        }
        return;
      }
      const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderMpesaStkPush(order.id), {
        method: "POST",
        body: "{}",
      });
      setOrders((prev) => prev.map((row) => (row.id === data.data.id ? data.data : row)));
      if (data.mpesa_push?.status === "sent") {
        await toastSuccess("M-PESA prompt sent");
      } else {
        await showInternalError();
      }
    } catch (err) {
      await showError("Could not complete M-PESA", extractErrorMessage(err));
    } finally {
      setStkBusyId(null);
    }
  }

  const todayKey = nairobiDateKey(new Date());
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (!matchesQuery(order, needle)) return false;
      if (method === "credit" && order.payment_method !== "credit") return false;
      if (method === "mpesa" && order.payment_method !== "mpesa") return false;
      const tone = saleStatus(order).tone;
      if (status === "paid" && tone !== "ok") return false;
      if (status === "waiting" && tone !== "wait") return false;
      if (status === "failed" && (tone !== "fail" || order.status === "cancelled" || order.status === "refunded")) {
        return false;
      }
      if (status === "voided" && order.status !== "cancelled" && order.status !== "refunded") {
        return false;
      }
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
    method === "credit" ? "Credit" : method === "mpesa" ? "M-PESA" : null,
    status === "paid"
      ? "Paid"
      : status === "waiting"
        ? "Waiting"
        : status === "failed"
          ? "Failed"
          : status === "voided"
            ? "Voided"
            : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const undoable = useMemo(
    () => (canVoid ? filtered.filter((order) => walkinUndoAction(order) !== null) : []),
    [canVoid, filtered],
  );
  const selectedOrders = undoable.filter((order) => selectedIds.has(order.id));

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startSelecting() {
    setOpenId(null);
    setSelecting(true);
    setSelectedIds(new Set());
  }

  function stopSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  function toggleSelectAll() {
    setSelectedIds(
      selectedOrders.length === undoable.length
        ? new Set()
        : new Set(undoable.map((order) => order.id)),
    );
  }

  async function undoSelected() {
    if (!selectedOrders.length || bulkUndoing) return;
    setBulkUndoing(true);
    try {
      const result = await promptAndUndoWalkinSales(selectedOrders);
      if (!result) return;
      const byId = new Map(result.updated.map((order) => [order.id, order]));
      setOrders((prev) => prev.map((row) => byId.get(row.id) ?? row));
      if (result.failures.length) {
        setSelectedIds(
          new Set(selectedOrders.filter((o) => !byId.has(o.id)).map((o) => o.id)),
        );
        await showError(
          result.updated.length
            ? `Voided ${result.updated.length}, ${result.failures.length} failed`
            : "Could not void sales",
          summarizeFailures(result.failures),
        );
        return;
      }
      await toastSuccess(
        result.updated.length === 1 ? "Sale voided" : `${result.updated.length} sales voided`,
      );
      stopSelecting();
    } finally {
      setBulkUndoing(false);
    }
  }

  function renderCheck(order: Order, label: string) {
    if (!undoActionFor(order)) return null;
    const picked = selectedIds.has(order.id);
    return (
      <button
        type="button"
        role="checkbox"
        className={`trans-chap-panel__check${picked ? " is-on" : ""}`}
        aria-checked={picked}
        aria-label={`${picked ? "Unselect" : "Select"} ${label}`}
        onClick={() => toggleSelected(order.id)}
      >
        {picked ? <i className="fa-solid fa-check" aria-hidden /> : null}
      </button>
    );
  }

  function renderActions(order: Order, product: string) {
    const sale = saleStatus(order);
    const undo = undoActionFor(order);
    const busy = stkBusyId === order.id || undoingId === order.id || bulkUndoing;
    return (
      <>
        {sale.tone === "wait" || (order.payment_method === "mpesa" && sale.tone === "fail" && order.status !== "cancelled" && order.status !== "refunded") ? (
          <button
            type="button"
            className="trans-chap-panel__link"
            disabled={busy}
            onClick={() => void handlePendingStk(order)}
          >
            {stkBusyId === order.id ? "Working…" : "Complete M-PESA"}
          </button>
        ) : null}
        {undo ? (
          <button
            type="button"
            className="trans-chap-panel__link trans-chap-panel__void"
            disabled={busy}
            onClick={() => void undoSale(order)}
          >
            {undoingId === order.id
              ? "Working…"
              : undo === "refund"
                ? "Refund"
                : "Void sale"}
          </button>
        ) : null}
        <Link
          href={transChapReceiptHref(order.id)}
          className="trans-chap-panel__link"
          aria-label={`Open receipt for ${product}`}
        >
          Open receipt
        </Link>
      </>
    );
  }

  return (
    <div className={`trans-chap-sales${view === "list" ? " trans-chap-sales--list" : ""}`}>
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
          <TransChapViewToggle view={view} onChange={setView} label="Sales layout" />
          {orders.some((order) => undoActionFor(order) !== null) ? (
            <button
              type="button"
              className={`trans-chap-sales__chip${selecting ? " is-active" : ""}`}
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : startSelecting())}
            >
              {selecting ? "Done" : "Select"}
            </button>
          ) : null}
        </div>
        {filtersOpen ? (
          <div id="trans-chap-sales-filters" className="trans-chap-sales__chips">
            <TransChapFilterChips label="When" value={when} options={WHEN_CHIPS} onChange={setWhen} />
            <TransChapFilterChips label="Payment" value={method} options={METHOD_CHIPS} onChange={setMethod} />
            <TransChapFilterChips label="Status" value={status} options={STATUS_CHIPS} onChange={setStatus} />
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
          <TransChapListSkeleton />
        ) : error && orders.length === 0 ? (
          <TransChapStatus tone="error">{error}</TransChapStatus>
        ) : orders.length === 0 ? (
          <TransChapStatus
            actionHref="/trans-chap/sales/new"
            actionLabel="Make a sale"
          >
            No sales yet.
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">
            {filtersOn
              ? "No sales match these filters."
              : "No sales yet."}
          </p>
        ) : view === "list" ? (
          <div className="trans-chap-stock-table-wrap trans-chap-stock-table-wrap--cards">
            <table className="trans-chap-stock-table trans-chap-stock-table--cards trans-chap-stock-table--sale">
              <thead>
                <tr>
                  {selecting ? <th className="trans-chap-stock-table__check" scope="col"> </th> : null}
                  <th scope="col">Items</th>
                  <th scope="col">Ref</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Total</th>
                  <th scope="col">Method</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                  <th className="trans-chap-stock-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const items = order.items ?? [];
                  const product = items[0]?.product_name || "Sale";
                  const extra = items.length > 1 ? ` +${items.length - 1}` : "";
                  const qty = items.reduce((sum, line) => sum + (line.quantity || 0), 0);
                  const sale = saleStatus(order);
                  const receipt = receiptFromOrder(order, shopName);
                  const picked = selectedIds.has(order.id);
                  const undone = order.status === "cancelled" || order.status === "refunded";
                  return (
                    <tr
                      key={order.id}
                      className={`${undone ? "is-inactive" : ""}${picked ? " is-picked" : ""}`}
                    >
                      {selecting ? (
                        <td className="trans-chap-stock-table__check">
                          {renderCheck(order, `${product}${extra}`)}
                        </td>
                      ) : null}
                      <td className="trans-chap-stock-table__product">{`${product}${extra}`}</td>
                      <td className="trans-chap-stock-table__mono">{receipt.orderNumber}</td>
                      <td className="trans-chap-stock-table__mono">{qty}</td>
                      <td className="trans-chap-stock-table__strong">{formatKsh(order.total)}</td>
                      <td>{transChapPayLabel(receipt.payMode)}</td>
                      <td className="trans-chap-stock-table__wrap">
                        {receipt.customerName?.trim() || "Walk-in"}
                      </td>
                      <td className="trans-chap-stock-table__mono">
                        {formatNairobiStamp24(receipt.paidAt) || "—"}
                      </td>
                      <td>
                        <em className={`trans-chap-panel__badge is-${sale.tone}`}>{sale.label}</em>
                      </td>
                      <td className="trans-chap-stock-table__actions">
                        <div className="trans-chap-stock-table__actions-inner">
                          {selecting ? null : renderActions(order, product)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <MotionList as="div" className="trans-chap-sales__stagger">
            {filtered.map((order) => {
            const product = order.items?.[0]?.product_name || "Sale";
            const extra = (order.items?.length ?? 0) > 1
              ? ` +${(order.items?.length ?? 0) - 1}`
              : "";
            const qty = (order.items ?? []).reduce(
              (sum, line) => sum + (line.quantity || 0),
              0,
            );
            const sale = saleStatus(order);
            const undoable = undoActionFor(order) !== null;
            const open = !selecting && openId === order.id;
            const panelId = `${listId}-${order.id}`;
            const receipt = receiptFromOrder(order, shopName);
            const paidAt = formatNairobiStamp24(receipt.paidAt);
            return (
              <MotionItem key={order.id} as="div">
              <TransChapPanel
                id={panelId}
                open={open}
                tone="sale"
                title={`${product}${extra}`}
                qty={`Qty ${qty}`}
                price={formatKsh(order.total)}
                badge={sale}
                inactive={selecting && !undoable}
                picking={selecting}
                picked={selectedIds.has(order.id)}
                onToggle={() => {
                  if (!selecting) setOpenId(open ? null : order.id);
                  else if (undoable) toggleSelected(order.id);
                }}
                headAction={
                  selecting ? (
                    renderCheck(order, `${product}${extra}`)
                  ) : (
                    <Link
                      href={transChapReceiptHref(order.id)}
                      className="trans-chap-panel__receipt"
                      aria-label={`Open receipt for ${product}`}
                    >
                      <i className="fa-solid fa-receipt" aria-hidden />
                    </Link>
                  )
                }
                action={renderActions(order, product)}
              >
                <p className="trans-chap-panel__lead">
                  {sale.label === "Voided"
                    ? "This sale was voided. Stock came back."
                    : sale.label === "Refunded"
                      ? "This sale was refunded. Stock came back."
                      : sale.label === "On credit"
                        ? "On the customer’s tab. Not paid yet."
                        : sale.tone === "ok"
                          ? "Payment received."
                          : sale.tone === "wait"
                            ? "Waiting for M-PESA. Tap Complete M-PESA to send a prompt or enter the SMS code."
                            : "M-PESA didn’t go through. Tap Complete M-PESA to try again or enter the SMS code."}
                </p>
                {order.payment_method === "mpesa" && order.mpesa_transaction ? (
                  <MpesaFlowStatus
                    steps={buildMpesaFlowSteps(order.mpesa_transaction)}
                    onStepAction={
                      sale.tone === "wait" || sale.tone === "fail"
                        ? () => void handlePendingStk(order)
                        : undefined
                    }
                  />
                ) : null}
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
                    <dd>{transChapPayLabel(receipt.payMode)}</dd>
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
              </MotionItem>
            );
          })}
          </MotionList>
        )}
        {truncated ? (
          <p className="trans-chap-sales__empty">Showing the most recent 2,000 sales.</p>
        ) : null}
      </div>
      {selecting ? (
        <div className="trans-chap-bulk-bar">
          <p className="trans-chap-bulk-bar__count">
            {selectedOrders.length ? `${selectedOrders.length} selected` : "Tap sales to select"}
          </p>
          <button type="button" disabled={bulkUndoing || !undoable.length} onClick={toggleSelectAll}>
            {undoable.length && selectedOrders.length === undoable.length ? "None" : "All"}
          </button>
          <button
            type="button"
            className="trans-chap-bulk-bar__disable"
            disabled={bulkUndoing || !selectedOrders.length}
            onClick={() => void undoSelected()}
          >
            {bulkUndoing ? "Voiding…" : "Void"}
          </button>
        </div>
      ) : (
        <TransChapFab label="New sale" href="/trans-chap/pos" />
      )}
    </div>
  );
}
