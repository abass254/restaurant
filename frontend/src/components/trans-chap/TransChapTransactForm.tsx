"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TransChapSaleCatalog } from "@/components/trans-chap/TransChapSaleCatalog";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch, apiFetchCached } from "@/lib/api";
import { showError, showInternalError, toastInfo, toastSuccess, promptMpesaCheckoutAction, promptMpesaReceipt, extractErrorMessage } from "@/lib/alerts";
import { findInventoryByBarcode } from "@/lib/barcode";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  canSellInventoryItem,
  findInventoryByName,
  inventoryProductName,
} from "@/lib/trans-chap-product";
import {
  canSellInUnit,
  normalizeUnitName,
  resolveSellUnit,
  sellUnitPrice,
  type SellUnit,
} from "@/lib/sell-units";
import {
  ensureShopCustomer,
  fetchShopCustomers,
} from "@/lib/trans-chap-customers";
import { formatKsh, receiptFromOrder, saveTransChapReceipt, toWhatsAppMsisdn, transChapReceiptHref } from "@/lib/trans-chap-receipt";
import type {
  InventoryItem,
  InventoryResponse,
  MerchantMpesaConfigResponse,
  OrderCreatePayload,
  OrderMutationResponse,
  ShopCustomer,
  SettingsResponse,
} from "@/lib/types";

type PayMode = "credit" | "mpesa";
type Stage = "catalog" | "customer" | "pay";

type BasketLine = {
  key: string;
  productName: string;
  inventoryItemId: string | null;
  quantity: number;
  unitPrice: number;
  sellUnit: string | null;
  unitFactor: number;
};

function basketKey(name: string, itemId: string | null, sellUnit: string | null): string {
  const unitPart = sellUnit ? `::${normalizeUnitName(sellUnit)}` : "";
  return `${itemId ?? name.trim().toLowerCase()}${unitPart}`;
}

function mergeBasketLine(
  lines: BasketLine[],
  draft: {
    name: string;
    qty: number;
    unitPrice: number;
    sellUnit: string | null;
    unitFactor: number;
  },
  item: InventoryItem | null,
): BasketLine[] {
  const key = basketKey(draft.name, item?.id ?? null, draft.sellUnit);
  const existing = lines.find((line) => line.key === key);
  if (existing) {
    const updated = { ...existing, quantity: existing.quantity + draft.qty };
    return [updated, ...lines.filter((line) => line.key !== key)];
  }
  return [
    {
      key,
      productName: draft.name,
      inventoryItemId: item?.id ?? null,
      quantity: draft.qty,
      unitPrice: draft.unitPrice,
      sellUnit: draft.sellUnit,
      unitFactor: draft.unitFactor,
    },
    ...lines,
  ];
}

export function TransChapTransactForm() {
  const router = useRouter();
  const user = useAuthUser();
  const [stage, setStage] = useState<Stage>("catalog");
  const [payMode, setPayMode] = useState<PayMode>("mpesa");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [selectedUnitByItemId, setSelectedUnitByItemId] = useState<Record<string, string>>(
    {},
  );
  const [lastScannedKey, setLastScannedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mpesaReady, setMpesaReady] = useState<boolean | null>(null);
  const [forceMpesaPrompt, setForceMpesaPrompt] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const inventoryRef = useRef<InventoryItem[]>([]);

  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";
  const saleTotal = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [basket],
  );
  const customerMatches = useMemo(() => {
    const nameNeedle = customerName.trim().toLowerCase();
    const phoneDigits = phone.replace(/\D/g, "");
    if (!nameNeedle && phoneDigits.length < 3) return [];
    return customers
      .filter((row) => {
        if (!row.phone) return false;
        if (nameNeedle && row.name.toLowerCase().includes(nameNeedle)) return true;
        const rowDigits = row.phone.replace(/\D/g, "");
        return phoneDigits.length >= 3 && rowDigits.includes(phoneDigits);
      })
      .slice(0, 6);
  }, [customerName, customers, phone]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    let alive = true;
    apiFetch<InventoryResponse>(`${apiRoutes.inventory}?active=true`)
      .then((res) => {
        if (!alive) return;
        setInventory(res.data);
      })
      .catch(() => {
        if (!alive) return;
        setInventory([]);
      })
      .finally(() => {
        if (alive) setInventoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const addItem = useCallback((item: InventoryItem, unit?: SellUnit) => {
    if (!canSellInventoryItem(item)) return;
    const resolved = unit ?? resolveSellUnit(item, selectedUnitByItemId[item.id] ?? null);
    if (!canSellInUnit(item, resolved)) {
      void showError(
        "Not enough stock",
        `${inventoryProductName(item)} needs ${resolved.factor} in stock to sell as ${resolved.name}.`,
      );
      return;
    }
    const name = inventoryProductName(item);
    const unitPrice = sellUnitPrice(resolved) ?? 0;
    if (unitPrice <= 0) return;
    const sellUnit = resolved.factor > 1 ? resolved.name : null;
    const key = basketKey(name, item.id, sellUnit);
    setBasket((prev) =>
      mergeBasketLine(
        prev,
        {
          name,
          qty: 1,
          unitPrice,
          sellUnit,
          unitFactor: resolved.factor,
        },
        item,
      ),
    );
    setLastScannedKey(key);
  }, [selectedUnitByItemId]);

  const handleScan = useCallback((code: string) => {
    const scanned = code.trim();
    if (!scanned) return;
    const item = findInventoryByBarcode(inventoryRef.current, scanned) ?? null;
    if (!item) {
      void toastInfo("Unknown barcode", `${scanned} isn’t in active inventory.`);
      return;
    }
    if (!canSellInventoryItem(item)) {
      void showError(
        "Can’t sell this item",
        inventoryProductName(item) + " is out of stock or has no selling price.",
      );
      return;
    }
    // Barcode scan always sells the base (piece) unit.
    const base = resolveSellUnit(item, null);
    addItem(item, base);
    void toastSuccess(inventoryProductName(item));
  }, [addItem]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSelectMode(params.get("mode") === "select" || params.get("mode") === "single");
    const pay = params.get("pay");
    if (pay === "mpesa" || pay === "credit" || pay === "cash") {
      setPayMode(pay === "cash" ? "credit" : pay);
    }
  }, []);

  useEffect(() => {
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((data) => {
        const ready = Boolean(data.config);
        setMpesaReady(ready);
        if (!ready) {
          setPayMode((current) => (current === "mpesa" ? "credit" : current));
        }
      })
      .catch(() => {
        setMpesaReady(false);
        setPayMode((current) => (current === "mpesa" ? "credit" : current));
      });

    void apiFetchCached<SettingsResponse>(apiRoutes.settings)
      .then((data) => {
        setForceMpesaPrompt(data.force_mpesa_prompt ?? true);
      })
      .catch(() => {
        setForceMpesaPrompt(true);
      });
  }, []);

  useEffect(() => {
    let alive = true;
    fetchShopCustomers()
      .then((rows) => {
        if (!alive) return;
        setCustomers(rows);
      })
      .catch(() => {
        if (!alive) return;
        setCustomers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  function pickCustomer(row: ShopCustomer) {
    setCustomerName(row.name);
    setPhone(row.phone ?? "");
  }

  async function continueCustomer(event: FormEvent) {
    event.preventDefault();
    const name = customerName.trim();
    if (!name) return;
    if (!toWhatsAppMsisdn(phone)) {
      await showError(
        "Phone needed",
        "Enter a valid phone so we can save this person as your customer.",
      );
      return;
    }
    setSavingCustomer(true);
    try {
      const customer = await ensureShopCustomer(name, phone, customers);
      setCustomers((prev) => {
        if (prev.some((row) => row.id === customer.id)) return prev;
        return [customer, ...prev];
      });
      setCustomerName(customer.name);
      setPhone(customer.phone ?? phone);
      setStage("pay");
    } catch {
      await showInternalError();
    } finally {
      setSavingCustomer(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const lines = basket;
    if (!lines.length) return;

    const creditMsisdn = payMode === "credit" ? toWhatsAppMsisdn(phone) : null;
    let mpesaAction: "resend" | "enter_code" | null = null;
    let mpesaReceiptCode: string | null = null;

    if (payMode === "mpesa") {
      if (!mpesaReady) {
        await showError(
          "M-PESA isn't set up",
          "Add your Till, Paybill, Pochi, or phone in Settings before taking M-PESA.",
        );
        return;
      }
      if (forceMpesaPrompt) {
        mpesaAction = await promptMpesaCheckoutAction();
        if (!mpesaAction) return;
      } else {
        mpesaAction = "enter_code";
      }

      if (mpesaAction === "enter_code") {
        mpesaReceiptCode = await promptMpesaReceipt(
          "Enter M-PESA code",
          "Type the transaction code from the customer’s SMS. Use this when they already paid you directly.",
          !forceMpesaPrompt
        );
        if (!forceMpesaPrompt && mpesaReceiptCode === null) {
           return; // cancelled dialog
        } else if (forceMpesaPrompt && !mpesaReceiptCode) {
           return;
        }
      }
    }

    const msisdn =
      payMode === "mpesa"
        ? toWhatsAppMsisdn(phone)
        : creditMsisdn;
    if (payMode === "mpesa" && mpesaAction === "resend" && !msisdn) {
      await showError(
        "M-PESA phone needed",
        "Enter the customer's M-PESA number so we can send the payment prompt.",
      );
      return;
    }
    if (payMode === "credit" && !customerName.trim()) {
      await showError(
        "Customer name needed",
        "Credit sales need the customer's name so we can put it on their tab.",
      );
      return;
    }
    if (payMode === "credit" && !msisdn) {
      await showError(
        "Customer phone needed",
        "Credit sales need a phone number so we can find this customer next time.",
      );
      return;
    }

    setSaving(true);
    try {
      let nextInventory = inventory;
      const payloadItems: OrderCreatePayload["items"] = [];
      for (const line of lines) {
        let item =
          (line.inventoryItemId
            ? nextInventory.find((entry) => entry.id === line.inventoryItemId)
            : undefined) ?? findInventoryByName(nextInventory, line.productName) ?? null;
        if (!item) {
          try {
            item = await addLiteInventoryProduct(line.productName, String(line.unitPrice));
            nextInventory = [item, ...nextInventory];
          } catch {
            item = null;
          }
        }
        payloadItems.push({
          product_name: line.productName,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          inventory_item_id: item?.id ?? null,
          sell_unit: line.sellUnit,
        });
      }
      setInventory(nextInventory);

      const customerPhone = msisdn ? `+${msisdn}` : phone.trim() || null;
      const payload: OrderCreatePayload = {
        source: "walkin",
        fulfillment_type: "pickup",
        payment_method: payMode,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone,
        items: payloadItems,
        ...(mpesaReceiptCode ? { mpesa_receipt_number: mpesaReceiptCode } : {}),
      };

      try {
        let created: OrderMutationResponse;
        try {
          created = await apiFetch<OrderMutationResponse>(apiRoutes.orders, {
            method: "POST",
            body: JSON.stringify(payload),
          });
        } catch (err) {
          if (!payloadItems.some((line) => line.inventory_item_id)) throw err;
          created = await apiFetch<OrderMutationResponse>(apiRoutes.orders, {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              items: payloadItems.map(({ inventory_item_id: _id, ...line }) => line),
            } satisfies OrderCreatePayload),
          });
        }
        const receipt = receiptFromOrder(
          created.data,
          shopName,
          created.mpesa_push,
          created.credit_tab,
        );
        saveTransChapReceipt(receipt);
        router.push(transChapReceiptHref(created.data.id));
        return;
      } catch (err) {
        await showError("Could not save sale", extractErrorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={
        stage === "catalog"
          ? "trans-chap-form trans-chap-form--scan"
          : "auth-split__form trans-chap-form"
      }
      onSubmit={(e) => {
        if (stage === "catalog") {
          e.preventDefault();
          return;
        }
        if (stage === "customer") {
          void continueCustomer(e);
          return;
        }
        void handleSubmit(e);
      }}
    >
      {stage === "catalog" ? (
        <TransChapSaleCatalog
          scan={!selectMode}
          active={!selectMode}
          basket={basket}
          inventory={inventory}
          inventoryLoading={inventoryLoading}
          lastScannedKey={lastScannedKey}
          selectedUnitByItemId={selectedUnitByItemId}
          onScan={handleScan}
          onSelectUnit={(itemId, unitName) => {
            setSelectedUnitByItemId((prev) => ({ ...prev, [itemId]: unitName }));
          }}
          onAdd={addItem}
          onQty={(key, quantity) => {
            if (quantity <= 0) {
              setBasket((prev) => prev.filter((line) => line.key !== key));
              return;
            }
            setBasket((prev) =>
              prev.map((line) => (line.key === key ? { ...line, quantity } : line)),
            );
          }}
          onContinue={() => setStage("customer")}
        />
      ) : stage === "customer" ? (
        <>
          <p className="trans-chap-form__lead">
            Who is this sale for? We’ll save them as a customer.
          </p>
          <div className="trans-chap-form__fields">
            <button
              type="button"
              className="trans-chap-sale-scan__back"
              onClick={() => setStage("catalog")}
            >
              <i className="fa-solid fa-chevron-left" aria-hidden />
              {basket.length} item{basket.length === 1 ? "" : "s"} · {formatKsh(saleTotal)}
            </button>
            <div className="auth-split__field">
              <label htmlFor="transact-customer-name">Name</label>
              <div className="trans-chap-input">
                <input
                  id="transact-customer-name"
                  type="text"
                  required
                  autoComplete="name"
                  placeholder="Customer name"
                  className="auth-split__input"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
            </div>
            <div className="auth-split__field">
              <label htmlFor="transact-customer-phone">Phone</label>
              <div className="trans-chap-input">
                <input
                  id="transact-customer-phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="2547…"
                  className="auth-split__input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            {customerMatches.length > 0 ? (
              <ul className="trans-chap-suggest" role="listbox" aria-label="Saved customers">
                {customerMatches.map((row) => (
                  <li key={row.id} role="option">
                    <button
                      type="button"
                      className="trans-chap-suggest__item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickCustomer(row)}
                    >
                      <span className="trans-chap-suggest__name">{row.name}</span>
                      <span className="trans-chap-suggest__meta">{row.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="trans-chap-form__actions">
            <button type="submit" className="auth-split__btn" disabled={savingCustomer}>
              {savingCustomer ? "Saving customer…" : "Continue to pay"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="trans-chap-form__lead">Choose how they pay.</p>
          <div className="trans-chap-form__fields">
            <button
              type="button"
              className="trans-chap-sale-scan__back"
              onClick={() => setStage("customer")}
            >
              <i className="fa-solid fa-chevron-left" aria-hidden />
              {customerName.trim() || "Customer"} · {formatKsh(saleTotal)}
            </button>
            <div className="auth-split__field">
              <span id="transact-pay-mode-label">How they pay</span>
              <div
                className="trans-chap-pay"
                role="radiogroup"
                aria-labelledby="transact-pay-mode-label"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={payMode === "mpesa"}
                  className={`trans-chap-pay__option${payMode === "mpesa" ? " is-selected" : ""}`}
                  onClick={() => setPayMode("mpesa")}
                >
                  M-Pesa
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={payMode === "credit"}
                  className={`trans-chap-pay__option trans-chap-pay__option--credit${payMode === "credit" ? " is-selected" : ""}`}
                  onClick={() => setPayMode("credit")}
                >
                  Credit
                </button>
              </div>
            </div>

            {payMode === "mpesa" && mpesaReady === false ? (
              <p className="trans-chap-mpesa-gate">
                Set your M-PESA details in Settings before taking M-PESA.{" "}
                <Link href="/trans-chap/settings">Set M-PESA details</Link>
              </p>
            ) : null}
          </div>

          <div className="trans-chap-form__actions">
            <button
              type="submit"
              className="auth-split__btn"
              disabled={saving || saleTotal <= 0 || (payMode === "mpesa" && mpesaReady !== true)}
            >
              {saving
                ? payMode === "mpesa"
                  ? "Saving…"
                  : "Saving on credit…"
                : payMode === "mpesa"
                  ? "Take M-PESA"
                  : "Save on credit"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
