"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { usePlatformRuntime } from "@/lib/platform-runtime";
import {
  extractErrorMessage,
  showError,
  showSuccess,
  toastSuccess,
} from "@/lib/alerts";
import { Skeleton } from "@/components/app/Skeleton";
import { AddressLocationField } from "@/components/shared/AddressLocationField";
import {
  staggerContainer,
  staggerItem,
  springSoft,
  duration as motionDuration,
  easeOutExpressive,
} from "@/lib/motion";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";
import { suppressMerchantOrderNotification } from "@/lib/merchant-notifications";
import {
  ALL_FULFILLMENT_TYPES,
  ALL_PAYMENT_METHODS,
  POS_SOURCES,
  FULFILLMENT_ICONS,
  FULFILLMENT_LABELS,
  PAYMENT_LABELS,
  SOURCE_ICONS,
  SOURCE_LABELS,
  STATUS_LABELS,
  formatMoney,
} from "@/lib/orders";
import { findInventoryByBarcode } from "@/lib/barcode";
import { inventoryRole, isSaleableRole } from "@/lib/trans-chap-product";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import type {
  InventoryItem,
  InventoryResponse,
  Order,
  OrderCreatePayload,
  OrderFulfillmentType,
  OrderMutationResponse,
  OrderPaymentMethod,
  OrderSource,
  ShopCustomer,
  ShopCustomersListResponse,
} from "@/lib/types";

export type PosWorkspaceProps = {
  /**
   * Station terminal mode: stay on this screen after sale and complete
   * paid pickup orders (cash / card / credit) through handoff.
   */
  completeInPlace?: boolean;
  /**
   * Trans Chap counter sales: walk-in + pickup only, M-Pesa / credit.
   * Matches `/trans-chap/make-a-sale` payment rules.
   */
  salesProfile?: "full" | "transchap";
};

const IMMEDIATE_COMPLETE_PAYMENTS: ReadonlySet<OrderPaymentMethod> = new Set([
  "cash",
  "card",
  "credit",
]);

const TRANSCHAP_PAYMENT_METHODS: OrderPaymentMethod[] = ["mpesa", "credit"];

type CartLine = {
  inventoryItemId: string;
  product_id: string | null;
  name: string;
  sku: string | null;
  unit_price: number;
  quantity: number;
  image_url: string | null;
};

function nameInitial(name: string | null | undefined): string {
  if (!name) return "?";
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function isServiceItem(item: InventoryItem): boolean {
  return item.product?.product_type === "service";
}

/** Physical products need tracked stock; services are always available. */
function isOutOfStock(item: InventoryItem): boolean {
  if (isServiceItem(item)) return false;
  const stock = item.stock_quantity;
  return stock == null || stock <= 0;
}

function maxCartQty(item: InventoryItem): number | null {
  if (isServiceItem(item)) return null;
  const stock = item.stock_quantity;
  if (stock == null || stock <= 0) return 0;
  return stock;
}

export function PosWorkspace({
  completeInPlace = false,
  salesProfile = "full",
}: PosWorkspaceProps) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { priceEditEnabled } = usePlatformRuntime();
  const { mapEnabled } = useGoogleMapsPublicConfig();
  const isTransChapSale = salesProfile === "transchap";
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const printAfterSaleRef = useRef(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  // Visual "just-added" pulse: holds the inventoryItem id that should flash.
  // Cleared on a short timer so the animation can replay if the same item is
  // tapped again in quick succession.
  const [pulseId, setPulseId] = useState<string | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const scannerBuffer = useRef("");
  const scannerLastKeyAt = useRef(0);
  const scannerResetTimer = useRef<number | null>(null);
  const scanToastTimer = useRef<number | null>(null);

  const [source, setSource] = useState<OrderSource>("walkin");
  const [fulfillment, setFulfillment] =
    useState<OrderFulfillmentType>("pickup");
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod | "">(
    isTransChapSale ? "mpesa" : "",
  );
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const [quickAddQty, setQuickAddQty] = useState(1);

  const AUTO_PRINT_STORAGE_KEY = "pos:auto_print_receipt";
  const QUICK_ADD_QTY_STORAGE_KEY = "pos:quick_add_qty";

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const data = await apiFetch<InventoryResponse>(
        `${apiRoutes.inventory}?active=true`,
      );
      setItems(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load inventory."));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void apiFetch<ShopCustomersListResponse>(apiRoutes.customers)
      .then((res) => setCustomers(res.data))
      .catch(() => {
        /* POS still works with typed name and phone. */
      });
  }, []);

  useEffect(() => {
    return () => {
      if (pulseTimer.current !== null) {
        window.clearTimeout(pulseTimer.current);
      }
      if (scannerResetTimer.current !== null) {
        window.clearTimeout(scannerResetTimer.current);
      }
      if (scanToastTimer.current !== null) {
        window.clearTimeout(scanToastTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUTO_PRINT_STORAGE_KEY);
      if (raw === null) return;
      setAutoPrintReceipt(raw === "1");
    } catch {
      // Ignore storage access failures and keep sensible default.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(QUICK_ADD_QTY_STORAGE_KEY);
      if (raw === null) return;
      const parsed = Math.max(1, Math.floor(Number(raw) || 1));
      setQuickAddQty(parsed);
    } catch {
      // Ignore storage access failures and keep sensible default.
    }
  }, []);

  function handleAutoPrintChange(next: boolean) {
    setAutoPrintReceipt(next);
    try {
      window.localStorage.setItem(AUTO_PRINT_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage access failures; setting still applies this session.
    }
  }

  function handleQuickAddQtyChange(value: string) {
    const next = Math.max(1, Math.floor(Number(value) || 1));
    setQuickAddQty(next);
    try {
      window.localStorage.setItem(QUICK_ADD_QTY_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage access failures; setting still applies this session.
    }
  }

  function clearScannerBuffer() {
    scannerBuffer.current = "";
    scannerLastKeyAt.current = 0;
    if (scannerResetTimer.current !== null) {
      window.clearTimeout(scannerResetTimer.current);
      scannerResetTimer.current = null;
    }
  }

  function flashPulse(id: string) {
    setPulseId(id);
    if (pulseTimer.current !== null) {
      window.clearTimeout(pulseTimer.current);
    }
    pulseTimer.current = window.setTimeout(() => {
      setPulseId(null);
      pulseTimer.current = null;
    }, 350);
  }

  const addToCart = useCallback((item: InventoryItem, qty = quickAddQty) => {
    const addAmount = Math.max(1, Math.floor(qty || 1));
    if (!isSaleableRole(inventoryRole(item))) {
      void showError(
        "Raw material",
        `"${item.product?.name ?? "This item"}" is marked as a raw material and can’t be sold.`,
      );
      return;
    }
    if (item.selling_price === null && !priceEditEnabled) {
      void showError(
        "No price set",
        `"${item.product?.name ?? "This item"}" doesn't have a selling price yet. Set one in Inventory first.`,
      );
      return;
    }
    if (isOutOfStock(item)) {
      void showError(
        "Out of stock",
        `"${item.product?.name ?? "This item"}" has no stock available. Update quantity in Inventory first.`,
      );
      return;
    }

    const cap = maxCartQty(item);
    let blocked = false;
    setCart((prev) => {
      const existing = prev.find((c) => c.inventoryItemId === item.id);
      const nextQty = (existing?.quantity ?? 0) + addAmount;
      if (cap !== null && nextQty > cap) {
        blocked = true;
        return prev;
      }
      if (existing) {
        return prev.map((c) =>
          c.inventoryItemId === item.id ? { ...c, quantity: nextQty } : c,
        );
      }
      return [
        ...prev,
        {
          inventoryItemId: item.id,
          product_id: item.product_id,
          name: item.product?.name ?? `#${item.product_id}`,
          sku: item.product?.sku ?? null,
          unit_price: item.selling_price ?? 0,
          quantity: addAmount,
          image_url: item.product?.image_url ?? null,
        },
      ];
    });
    if (blocked) {
      void showError(
        "Not enough stock",
        cap === 1
          ? `Only 1 unit of "${item.product?.name ?? "this item"}" is available.`
          : `Only ${cap} units of "${item.product?.name ?? "this item"}" are available.`,
      );
      return;
    }
    flashPulse(item.id);
  }, [priceEditEnabled, quickAddQty]);

  useEffect(() => {
    function isEditableElement(el: Element | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    async function handleUnknownBarcode(code: string) {
      await showError(
        "Barcode not found",
        `No product matched "${code}". Use Product code or SKU from Inventory.`,
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableElement(document.activeElement)) return;

      if (event.key === "Enter") {
        const scanned = scannerBuffer.current.trim();
        clearScannerBuffer();
        if (scanned.length < 3) return;
        event.preventDefault();

        const matched = findInventoryByBarcode(items, scanned);
        if (!matched) {
          void handleUnknownBarcode(scanned);
          return;
        }

        addToCart(matched);
        setSearch("");
        if (scanToastTimer.current !== null) {
          window.clearTimeout(scanToastTimer.current);
        }
        scanToastTimer.current = window.setTimeout(() => {
          scanToastTimer.current = null;
        }, 1000);
        void toastSuccess(`Scanned: ${matched.product?.name ?? "item"} added`);
        return;
      }

      if (event.key.length !== 1) return;

      const now = Date.now();
      if (now - scannerLastKeyAt.current > 140) {
        scannerBuffer.current = "";
      }
      scannerLastKeyAt.current = now;
      scannerBuffer.current += event.key;

      if (scannerResetTimer.current !== null) {
        window.clearTimeout(scannerResetTimer.current);
      }
      scannerResetTimer.current = window.setTimeout(() => {
        clearScannerBuffer();
      }, 280);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [addToCart, clearScannerBuffer, items]);

  const itemsById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!item.is_active) return false;
      if (!isSaleableRole(inventoryRole(item))) return false;
      if (!term) return true;
      const haystacks = [
        item.product?.name,
        item.product?.brand,
        item.product?.category,
        item.product?.product_code,
        item.product?.sku,
      ];
      return haystacks.some((h) => h && h.toLowerCase().includes(term));
    });
  }, [items, search]);

  function changeQuantity(inventoryItemId: string, delta: number) {
    const item = itemsById.get(inventoryItemId);
    const cap = item ? maxCartQty(item) : null;
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.inventoryItemId !== inventoryItemId) return c;
          let next = c.quantity + delta;
          if (cap !== null) next = Math.min(next, cap);
          return { ...c, quantity: next };
        })
        .filter((c) => c.quantity > 0),
    );
  }

  function setQuantity(inventoryItemId: string, value: string) {
    const item = itemsById.get(inventoryItemId);
    const cap = item ? maxCartQty(item) : null;
    let next = Math.max(0, Math.floor(Number(value) || 0));
    if (cap !== null) next = Math.min(next, cap);
    setCart((prev) =>
      prev
        .map((c) =>
          c.inventoryItemId === inventoryItemId
            ? { ...c, quantity: next }
            : c,
        )
        .filter((c) => c.quantity > 0),
    );
  }

  function setUnitPrice(inventoryItemId: string, value: string) {
    const next = Math.max(0, Number(value) || 0);
    setCart((prev) =>
      prev.map((c) =>
        c.inventoryItemId === inventoryItemId ? { ...c, unit_price: next } : c,
      ),
    );
  }

  function removeLine(inventoryItemId: string) {
    setCart((prev) => prev.filter((c) => c.inventoryItemId !== inventoryItemId));
  }

  function clearCart() {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setDeliveryCoords(null);
    setDeliveryNotes("");
    setDeliveryFee("");
    setDiscount("");
    setNotes("");
    setPaymentMethod("");
    setSelectedCustomerId("");
  }

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  function applyCustomer(customerId: string) {
    setSelectedCustomerId(customerId);
    if (!customerId) {
      setCustomerName("");
      setCustomerPhone("");
      return;
    }
    const customer = customers.find((row) => row.id === customerId);
    if (!customer) return;
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone);
    if (customer.address) {
      setDeliveryAddress(customer.address);
    }
  }

  const itemCount = useMemo(
    () => cart.reduce((sum, c) => sum + c.quantity, 0),
    [cart],
  );
  const subtotal = useMemo(
    () => cart.reduce((sum, c) => sum + c.unit_price * c.quantity, 0),
    [cart],
  );
  const deliveryFeeNum = Number(deliveryFee) || 0;
  const discountNum = Number(discount) || 0;
  const total = Math.max(0, subtotal + deliveryFeeNum - discountNum);

  async function completePaidPickup(orderId: string): Promise<Order> {
    const ready = await apiFetch<OrderMutationResponse>(
      apiRoutes.orderTransition(orderId),
      {
        method: "POST",
        body: JSON.stringify({
          to_status: "ready",
          note: "Counter sale completed at station.",
        }),
      },
    );
    const handedOff = await apiFetch<OrderMutationResponse>(
      apiRoutes.orderConfirmHandoff(orderId),
      { method: "POST" },
    );
    return handedOff.data.items?.length
      ? handedOff.data
      : { ...ready.data, ...handedOff.data, items: ready.data.items };
  }

  useEffect(() => {
    if (!completeInPlace || !receiptOrder || !printAfterSaleRef.current) return;
    printAfterSaleRef.current = false;
    const timer = window.setTimeout(() => {
      window.print();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [completeInPlace, receiptOrder]);

  const canCompleteSaleNow =
    completeInPlace &&
    (isTransChapSale || fulfillment === "pickup") &&
    paymentMethod !== "" &&
    IMMEDIATE_COMPLETE_PAYMENTS.has(paymentMethod);

  const paymentOptions = isTransChapSale
    ? TRANSCHAP_PAYMENT_METHODS
    : ALL_PAYMENT_METHODS;

  const placeDisabled =
    cart.length === 0 ||
    submitting ||
    (isTransChapSale && paymentMethod !== "mpesa" && paymentMethod !== "credit");

  const placeLabel = (() => {
    if (submitting) {
      if (isTransChapSale) {
        return paymentMethod === "mpesa"
          ? "Sending M-Pesa…"
          : "Saving on credit…";
      }
      return canCompleteSaleNow ? "Completing…" : "Placing order…";
    }
    if (isTransChapSale) {
      return paymentMethod === "mpesa" ? "Send M-Pesa prompt" : "Save on credit";
    }
    return canCompleteSaleNow ? "Complete order" : "Place order";
  })();

  async function placeOrder() {
    if (cart.length === 0) return;
    const orderSource = isTransChapSale ? "walkin" : source;
    const orderFulfillment = isTransChapSale ? "pickup" : fulfillment;
    if (isTransChapSale && (paymentMethod !== "mpesa" && paymentMethod !== "credit")) {
      await showError(
        "Choose how they pay",
        "Pick M-Pesa or credit before completing this sale.",
      );
      return;
    }
    if (orderFulfillment === "delivery" && !deliveryAddress.trim()) {
      await showError(
        "Delivery address required",
        "Add a delivery address before placing this order.",
      );
      return;
    }
    if (orderFulfillment === "delivery" && mapEnabled && !deliveryCoords) {
      await showError(
        "Pin the delivery address",
        "Pick a suggestion from the search results or use Pin on map so the address is resolved accurately.",
      );
      return;
    }
    if (paymentMethod === "mpesa" && !customerPhone.trim()) {
      await showError(
        "Customer phone required",
        "Enter the customer's M-PESA phone number so we can send them the payment prompt.",
      );
      return;
    }
    if (paymentMethod === "credit" && !customerName.trim()) {
      await showError(
        "Customer name required",
        "Credit sales need the customer's name so we can put it on their tab.",
      );
      return;
    }
    if (paymentMethod === "credit" && !customerPhone.trim()) {
      await showError(
        "Customer phone required",
        "Credit sales need a phone number so we can find this customer next time.",
      );
      return;
    }
    if (isTransChapSale && paymentMethod === "mpesa" && !customerName.trim()) {
      await showError(
        "Customer name required",
        "Enter the customer's name so we can save them for this walk-in sale.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const payload: OrderCreatePayload = {
        source: orderSource,
        fulfillment_type: orderFulfillment,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        delivery_address: orderFulfillment === "delivery" ? deliveryAddress.trim() || null : null,
        delivery_notes: orderFulfillment === "delivery" ? deliveryNotes.trim() || null : null,
        payment_method: paymentMethod || null,
        delivery_fee: orderFulfillment === "delivery" ? deliveryFeeNum : 0,
        discount: discountNum,
        notes: notes.trim() || null,
        items: cart.map((c) => ({
          inventory_item_id: c.inventoryItemId,
          quantity: c.quantity,
          ...(priceEditEnabled ? { unit_price: c.unit_price } : {}),
        })),
      };
      const data = await apiFetch<OrderMutationResponse>(apiRoutes.orders, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      let order = data.data;
      const willCompleteNow =
        completeInPlace &&
        orderFulfillment === "pickup" &&
        paymentMethod !== "" &&
        IMMEDIATE_COMPLETE_PAYMENTS.has(paymentMethod);

      if (willCompleteNow) {
        try {
          order = await completePaidPickup(order.id);
        } catch (completeErr) {
          await showError(
            `Order ${data.data.order_number} placed, but could not mark it complete`,
            extractErrorMessage(completeErr),
          );
        }
      }

      // M-PESA: surface the STK push outcome separately so the cashier
      // knows whether the customer received the prompt. The order itself
      // is always saved, even if the push failed (they can retry from
      // the order detail page).
      const push = data.mpesa_push;
      if (push && push.status === "sent") {
        await showSuccess(
          `Order ${order.order_number} · STK push sent`,
          push.message,
        );
      } else if (push && push.status !== "sent") {
        await showError(
          `Order ${order.order_number} placed, but M-PESA push didn't go through`,
          push.message,
        );
      } else if (willCompleteNow && order.status === "picked_up") {
        await toastSuccess(`Order ${order.order_number} completed`);
      } else {
        await toastSuccess(`Order ${order.order_number} placed`);
      }
      suppressMerchantOrderNotification(order.id);
      clearCart();
      void reload({ silent: true });

      if (completeInPlace) {
        setReceiptOrder(order);
        printAfterSaleRef.current = autoPrintReceipt;
        return;
      }

      router.push(
        autoPrintReceipt
          ? `/orders/${order.id}?print=1`
          : `/orders/${order.id}`,
      );
    } catch (err) {
      await showError("Could not place order", extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="app-panel pos-panel">
      <div className="pos-grid">
        {/* ── Catalog (left) ─────────────────────────────────────── */}
        <div className="pos-catalog">
          <header className="pos-catalog__head">
            <h1 className="pos-title">
              <i
                className="fa-solid fa-cash-register pos-title__icon"
                aria-hidden="true"
              />
              Point of sale
            </h1>
            <div className="pos-catalog__tools">
              <label className="pos-quick-qty" title="Units added per product tap or scan">
                <span className="pos-quick-qty__label">Qty</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={quickAddQty}
                  onChange={(e) => handleQuickAddQtyChange(e.target.value)}
                  aria-label="Quantity per tap"
                />
              </label>
              <div className="pos-quick-qty__presets" role="group" aria-label="Quick quantity presets">
                {[1, 5, 10].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`pos-quick-qty__preset${quickAddQty === preset ? " is-active" : ""}`}
                    onClick={() => handleQuickAddQtyChange(String(preset))}
                    aria-pressed={quickAddQty === preset}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <label className="pos-search">
              <i
                className="fa-solid fa-magnifying-glass pos-search__icon"
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder="Search inventory or scan barcode…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {search ? (
                <button
                  type="button"
                  className="pos-search__clear"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              ) : null}
            </label>
            </div>
          </header>

          {error ? <p className="app-error">{error}</p> : null}

          {loading ? (
            <CatalogSkeleton />
          ) : filteredItems.length === 0 ? (
            <div className="pos-empty">
              <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
              <h3>
                {items.length === 0
                  ? "Inventory is empty"
                  : "No items match your filters"}
              </h3>
              <p>
                {items.length === 0
                  ? "Add products in Inventory and they'll appear here for one-tap selling."
                  : "Try a different search."}
              </p>
            </div>
          ) : (
            <motion.ul
              className="pos-cards"
              variants={reduce ? undefined : staggerContainer}
              initial={reduce ? false : "hidden"}
              animate={reduce ? undefined : "visible"}
            >
              {filteredItems.map((item) => {
                const coverUrl = item.product?.image_url ?? null;
                const inCartQty =
                  cart.find((c) => c.inventoryItemId === item.id)?.quantity ?? 0;
                const isPulsing = pulseId === item.id;
                const subtitleParts = [
                  item.product?.category,
                  item.product?.brand,
                ].filter(Boolean) as string[];
                const subtitle = subtitleParts.join(" · ");
                const hasPrice = item.selling_price !== null;
                const outOfStock = isOutOfStock(item);
                const canAdd =
                  (hasPrice || priceEditEnabled) && !outOfStock;
                const stockCap = maxCartQty(item);
                const atStockCap =
                  stockCap !== null && inCartQty >= stockCap;
                return (
                  <motion.li
                    key={item.id}
                    variants={reduce ? undefined : staggerItem}
                    animate={
                      isPulsing && !reduce
                        ? { scale: [1, 1.025, 1] }
                        : { scale: 1 }
                    }
                    transition={{
                      duration: motionDuration.base,
                      ease: easeOutExpressive,
                    }}
                    className={`pos-card${inCartQty > 0 ? " is-in-cart" : ""}${!canAdd ? " is-disabled" : ""}`}
                  >
                    <div className="pos-card__hit">
                      <button
                        type="button"
                        className="pos-card__main"
                        onClick={() => addToCart(item)}
                        aria-label={`Add ${quickAddQty > 1 ? `${quickAddQty} of ` : ""}${item.product?.name ?? "item"} to order`}
                        disabled={!canAdd}
                      >
                        <div className="pos-card__thumb" aria-hidden="true">
                          {coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={resolveAssetUrl(coverUrl)}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="pos-card__thumb-fallback">
                              {nameInitial(item.product?.name)}
                            </span>
                          )}
                        </div>

                        <div className="pos-card__info">
                          <span className="pos-card__name">
                            {item.product?.name ?? `Item #${item.product_id}`}
                          </span>
                          {subtitle ? (
                            <span className="pos-card__subtitle">
                              {subtitle}
                            </span>
                          ) : null}
                          <span className="pos-card__price">
                            {outOfStock ? (
                              <span className="pos-card__price-unset">
                                Out of stock
                              </span>
                            ) : hasPrice && item.selling_price !== null ? (
                              <>
                                <span className="pos-card__price-amount">
                                  {formatMoney(item.selling_price)}
                                </span>
                                {item.product?.unit ? (
                                  <span className="pos-card__price-unit">
                                    /{item.product.unit}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="pos-card__price-unset">
                                No price set
                              </span>
                            )}
                          </span>
                        </div>
                      </button>

                      <div className="pos-card__action">
                        {inCartQty > 0 ? (
                          <div
                            className="pos-card__qty"
                            role="group"
                            aria-label={`Quantity of ${item.product?.name ?? "item"} in order`}
                          >
                            <button
                              type="button"
                              aria-label="Decrease quantity"
                              onClick={() =>
                                changeQuantity(item.id, -1)
                              }
                            >
                              <i
                                className="fa-solid fa-minus"
                                aria-hidden="true"
                              />
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={stockCap ?? undefined}
                              value={inCartQty}
                              onChange={(e) =>
                                setQuantity(item.id, e.target.value)
                              }
                              aria-label={`Quantity of ${item.product?.name ?? "item"}`}
                            />
                            <button
                              type="button"
                              aria-label="Increase quantity"
                              disabled={atStockCap}
                              onClick={() => changeQuantity(item.id, 1)}
                            >
                              <i
                                className="fa-solid fa-plus"
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="pos-card__add"
                            onClick={() => addToCart(item)}
                            disabled={!canAdd}
                            aria-label={`Add ${quickAddQty > 1 ? `${quickAddQty} of ` : ""}${item.product?.name ?? "item"} to order`}
                          >
                            <i className="fa-solid fa-plus" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </div>

        {/* ── Cart (right) ───────────────────────────────────────── */}
        <aside className="pos-cart" aria-label="Current order">
          <header className="pos-cart__head">
            <h2>
              <i className="fa-solid fa-receipt" aria-hidden="true" />
              Current order
              <span className="pos-cart__count">
                {itemCount === 0 ? "empty" : `${itemCount}`}
              </span>
            </h2>
            {cart.length > 0 ? (
              <button
                type="button"
                className="pos-cart__reset"
                onClick={clearCart}
                title="Reset order"
              >
                <i className="fa-solid fa-rotate-left" aria-hidden="true" />
              </button>
            ) : null}
          </header>

          <div className="pos-cart__body">
            {isTransChapSale ? (
              <div className="pos-cart__row">
                <span className="pos-label">Channel</span>
                <p className="pos-cart__fixed-meta">
                  <i className={SOURCE_ICONS.walkin} aria-hidden="true" />
                  Walk-in · Pickup
                </p>
              </div>
            ) : (
              <>
                <div className="pos-cart__row">
                  <span className="pos-label">Channel</span>
                  <div className="pos-pickers pos-pickers--two" role="radiogroup">
                    {POS_SOURCES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={source === s}
                        className={`pos-picker pos-picker--wide${source === s ? " is-active" : ""}`}
                        onClick={() => setSource(s)}
                      >
                        <i className={SOURCE_ICONS[s]} aria-hidden="true" />
                        <span>{SOURCE_LABELS[s]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pos-cart__row">
                  <span className="pos-label">Type</span>
                  <div className="pos-pickers pos-pickers--two" role="radiogroup">
                    {ALL_FULFILLMENT_TYPES.map((f) => (
                      <button
                        key={f}
                        type="button"
                        role="radio"
                        aria-checked={fulfillment === f}
                        className={`pos-picker pos-picker--wide${fulfillment === f ? " is-active" : ""}`}
                        onClick={() => setFulfillment(f)}
                      >
                        <i className={FULFILLMENT_ICONS[f]} aria-hidden="true" />
                        <span>{FULFILLMENT_LABELS[f]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="pos-fields pos-fields--customer">
              {customers.length > 0 ? (
                <label className="pos-customer-pick">
                  <span className="pos-label">Customer</span>
                  <select
                    value={selectedCustomerId}
                    onChange={(event) => applyCustomer(event.target.value)}
                    aria-label="Saved customer"
                  >
                    <option value="">Walk-in / new customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} · {customer.phone}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <input
                type="text"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setSelectedCustomerId("");
                }}
                placeholder={
                  isTransChapSale || paymentMethod === "credit"
                    ? "Customer name (required)"
                    : "Customer name (optional)"
                }
                aria-label="Customer name"
                aria-required={isTransChapSale || paymentMethod === "credit"}
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(e.target.value);
                  setSelectedCustomerId("");
                }}
                placeholder={
                  paymentMethod === "mpesa"
                    ? "M-PESA phone (required) · 2547…"
                    : paymentMethod === "credit"
                      ? "Credit phone (required) · 2547…"
                      : "Phone"
                }
                aria-label="Customer phone"
                aria-required={paymentMethod === "mpesa" || paymentMethod === "credit"}
                className={
                  (paymentMethod === "mpesa" || paymentMethod === "credit") && !customerPhone.trim()
                    ? "pos-input--required"
                    : undefined
                }
              />
              {selectedCustomer && selectedCustomer.credit_limit > 0 ? (
                <p className="pos-customer-credit">
                  Available credit {formatMoney(selectedCustomer.available_credit)} of{" "}
                  {formatMoney(selectedCustomer.credit_limit)}
                </p>
              ) : null}
            </div>

            <AnimatePresence initial={false}>
              {!isTransChapSale && fulfillment === "delivery" ? (
                <motion.div
                  key="delivery-fields"
                  className="pos-fields pos-fields--delivery"
                  initial={reduce ? false : { opacity: 0, height: 0 }}
                  animate={reduce ? undefined : { opacity: 1, height: "auto" }}
                  exit={reduce ? undefined : { opacity: 0, height: 0 }}
                  transition={springSoft}
                  style={{ overflow: "hidden" }}
                >
                  <AddressLocationField
                    value={deliveryAddress}
                    onChange={(text) => {
                      setDeliveryAddress(text);
                    }}
                    onCoordsChange={setDeliveryCoords}
                    label="Delivery address"
                    placeholder="Search for a delivery address"
                    fallback="textarea"
                    allowMapPin
                  />
                  <input
                    type="text"
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="Notes (gate code, landmark…)"
                    aria-label="Delivery notes"
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="pos-cart__lines-wrap">
              <div className="pos-cart__lines">
                {cart.length === 0 ? (
                  <div className="pos-cart__empty">
                    <i className="fa-solid fa-cart-plus" aria-hidden="true" />
                    <p>Tap a product on the left to add it to the order.</p>
                  </div>
                ) : (
                  <ul>
                    <AnimatePresence initial={false}>
                      {cart.map((line) => {
                        const lineTotal = line.unit_price * line.quantity;
                        const stockItem = itemsById.get(line.inventoryItemId);
                        const stockCap = stockItem ? maxCartQty(stockItem) : null;
                        const atStockCap =
                          stockCap !== null && line.quantity >= stockCap;
                        return (
                          <motion.li
                            key={line.inventoryItemId}
                            layout={!reduce}
                            initial={
                              reduce ? false : { opacity: 0, y: 6, scale: 0.98 }
                            }
                            animate={
                              reduce
                                ? undefined
                                : { opacity: 1, y: 0, scale: 1 }
                            }
                            exit={
                              reduce
                                ? undefined
                                : { opacity: 0, scale: 0.96, x: 8 }
                            }
                            transition={springSoft}
                            className="pos-line"
                          >
                            <div className="pos-line__thumb" aria-hidden="true">
                              {line.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={resolveAssetUrl(line.image_url)}
                                  alt=""
                                />
                              ) : (
                                <span>{nameInitial(line.name)}</span>
                              )}
                            </div>
                            <div className="pos-line__main">
                              <strong>{line.name}</strong>
                              {priceEditEnabled ? (
                                <label className="pos-line__price-edit">
                                  <span className="pos-line__price-label">Price</span>
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={line.unit_price}
                                    onChange={(e) =>
                                      setUnitPrice(
                                        line.inventoryItemId,
                                        e.target.value,
                                      )
                                    }
                                    aria-label={`Unit price for ${line.name}`}
                                  />
                                </label>
                              ) : (
                                <span>{formatMoney(line.unit_price)} ea</span>
                              )}
                            </div>
                            <div className="pos-line__qty">
                              <button
                                type="button"
                                aria-label="Decrease quantity"
                                onClick={() =>
                                  changeQuantity(line.inventoryItemId, -1)
                                }
                              >
                                <i
                                  className="fa-solid fa-minus"
                                  aria-hidden="true"
                                />
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={stockCap ?? undefined}
                                value={line.quantity}
                                onChange={(e) =>
                                  setQuantity(
                                    line.inventoryItemId,
                                    e.target.value,
                                  )
                                }
                                aria-label={`Quantity of ${line.name}`}
                              />
                              <button
                                type="button"
                                aria-label="Increase quantity"
                                disabled={atStockCap}
                                onClick={() =>
                                  changeQuantity(line.inventoryItemId, 1)
                                }
                              >
                                <i
                                  className="fa-solid fa-plus"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                            <div className="pos-line__total">
                              <strong>{formatMoney(lineTotal)}</strong>
                              <button
                                type="button"
                                className="pos-line__remove"
                                aria-label={`Remove ${line.name}`}
                                onClick={() =>
                                  removeLine(line.inventoryItemId)
                                }
                              >
                                <i
                                  className="fa-solid fa-trash"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                )}
              </div>
            </div>
          </div>

          <footer className="pos-cart__footer">
            {isTransChapSale ? (
              <div className="pos-cart__row pos-cart__row--pay">
                <span className="pos-label" id="pos-pay-mode-label">
                  How they pay
                </span>
                <div
                  className="pos-pickers pos-pickers--two"
                  role="radiogroup"
                  aria-labelledby="pos-pay-mode-label"
                >
                  {paymentOptions.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod === p}
                      className={`pos-picker pos-picker--wide${paymentMethod === p ? " is-active" : ""}${p === "credit" ? " pos-picker--credit" : ""}`}
                      onClick={() => setPaymentMethod(p)}
                    >
                      <span>{PAYMENT_LABELS[p]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div
              className={`pos-money-row${isTransChapSale ? " pos-money-row--transchap" : ""}`}
            >
              {!isTransChapSale ? (
                <label className="pos-money-input">
                  <span className="pos-money-input__prefix">Delivery</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                    placeholder="0"
                    disabled={fulfillment !== "delivery"}
                  />
                </label>
              ) : null}
              <label className="pos-money-input">
                <span className="pos-money-input__prefix">Discount</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0"
                />
              </label>
              {!isTransChapSale ? (
                <select
                  className="pos-payment-select"
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(e.target.value as OrderPaymentMethod | "")
                  }
                  aria-label="Payment method"
                >
                  <option value="">Pay later</option>
                  {paymentOptions.map((p) => (
                    <option key={p} value={p}>
                      {PAYMENT_LABELS[p]}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <dl className="pos-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(subtotal)}</dd>
              </div>
              {deliveryFeeNum > 0 ? (
                <div>
                  <dt>Delivery</dt>
                  <dd>+ {formatMoney(deliveryFeeNum)}</dd>
                </div>
              ) : null}
              {discountNum > 0 ? (
                <div className="pos-totals__discount">
                  <dt>Discount</dt>
                  <dd>− {formatMoney(discountNum)}</dd>
                </div>
              ) : null}
              <div className="pos-totals__grand">
                <dt>Total</dt>
                <dd>{formatMoney(total)}</dd>
              </div>
            </dl>

            <button
              type="button"
              className="pos-place"
              onClick={() => void placeOrder()}
              disabled={placeDisabled}
            >
              {submitting ? (
                <>
                  <i
                    className="fa-solid fa-spinner fa-spin"
                    aria-hidden="true"
                  />
                  {placeLabel}
                </>
              ) : (
                <>
                  <span className="pos-place__label">
                    <i className="fa-solid fa-check" aria-hidden="true" />
                    {placeLabel}
                  </span>
                  <span className="pos-place__total">{formatMoney(total)}</span>
                </>
              )}
            </button>
            <label className="pos-autoprint-toggle">
              <input
                type="checkbox"
                checked={autoPrintReceipt}
                onChange={(e) => handleAutoPrintChange(e.target.checked)}
              />
              <span>Auto-print receipt after sale</span>
            </label>
          </footer>
        </aside>
      </div>

      {completeInPlace && receiptOrder ? (
        <section className="orders-receipt-print" aria-hidden="true">
          <header className="orders-receipt-print__head">
            <h2>Sales Receipt</h2>
            <p>Order #{receiptOrder.order_number}</p>
          </header>
          <dl className="orders-receipt-print__meta">
            <div>
              <dt>Date</dt>
              <dd>
                {formatNairobiDateTime(
                  receiptOrder.placed_at ?? receiptOrder.created_at,
                ) || "—"}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{STATUS_LABELS[receiptOrder.status]}</dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{receiptOrder.customer_name ?? "Walk-in customer"}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>
                {receiptOrder.payment_method
                  ? PAYMENT_LABELS[receiptOrder.payment_method]
                  : "Pay later"}
              </dd>
            </div>
          </dl>
          <table className="orders-receipt-print__items">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {(receiptOrder.items ?? []).map((line) => (
                <tr key={line.id}>
                  <td>{line.product_name}</td>
                  <td>{line.quantity}</td>
                  <td>{formatMoney(line.unit_price, receiptOrder.currency)}</td>
                  <td>{formatMoney(line.line_total, receiptOrder.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Subtotal</td>
                <td>{formatMoney(receiptOrder.subtotal, receiptOrder.currency)}</td>
              </tr>
              {receiptOrder.delivery_fee > 0 ? (
                <tr>
                  <td colSpan={3}>Delivery</td>
                  <td>
                    {formatMoney(receiptOrder.delivery_fee, receiptOrder.currency)}
                  </td>
                </tr>
              ) : null}
              {receiptOrder.discount > 0 ? (
                <tr>
                  <td colSpan={3}>Discount</td>
                  <td>
                    -{formatMoney(receiptOrder.discount, receiptOrder.currency)}
                  </td>
                </tr>
              ) : null}
              <tr className="orders-receipt-print__grand">
                <td colSpan={3}>Total</td>
                <td>{formatMoney(receiptOrder.total, receiptOrder.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      ) : null}
    </section>
  );
}

function CatalogSkeleton() {
  const cards = Array.from({ length: 8 });
  return (
    <ul className="pos-cards" aria-busy="true" aria-live="polite">
      {cards.map((_, i) => (
        <li key={i} className="pos-card pos-card--skeleton">
          <div className="pos-card__hit">
            <div className="pos-card__thumb">
              <Skeleton variant="rect" width="100%" height="100%" />
            </div>
            <div className="pos-card__info">
              <Skeleton variant="text" width="70%" height={13} />
              <Skeleton variant="text" width="45%" height={10} />
              <Skeleton variant="text" width="35%" height={13} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
