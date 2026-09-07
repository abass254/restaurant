"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TransChapSaleScan } from "@/components/trans-chap/TransChapSaleScan";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastInfo, toastSuccess } from "@/lib/alerts";
import { findInventoryByBarcode } from "@/lib/barcode";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  inventoryProductName,
  updateInventorySellingPrice,
} from "@/lib/trans-chap-product";
import { formatKsh, receiptFromOrder, saveTransChapReceipt, toWhatsAppMsisdn, transChapReceiptHref } from "@/lib/trans-chap-receipt";
import type {
  InventoryItem,
  InventoryResponse,
  MerchantMpesaConfigResponse,
  OrderCreatePayload,
  OrderMutationResponse,
} from "@/lib/types";

type PayMode = "credit" | "mpesa";

type BasketLine = {
  key: string;
  productName: string;
  inventoryItemId: string | null;
  quantity: number;
  unitPrice: number;
};

function basketKey(name: string, itemId: string | null): string {
  return itemId ?? name.trim().toLowerCase();
}

function mergeBasketLine(
  lines: BasketLine[],
  draft: { name: string; qty: number; unitPrice: number },
  item: InventoryItem | null,
): BasketLine[] {
  const key = basketKey(draft.name, item?.id ?? null);
  const existing = lines.find((line) => line.key === key);
  if (existing) {
    return lines.map((line) =>
      line.key === key
        ? { ...line, quantity: line.quantity + draft.qty }
        : line,
    );
  }
  return [
    ...lines,
    {
      key,
      productName: draft.name,
      inventoryItemId: item?.id ?? null,
      quantity: draft.qty,
      unitPrice: draft.unitPrice,
    },
  ];
}

export function TransChapTransactForm() {
  const router = useRouter();
  const user = useAuthUser();
  const [stage, setStage] = useState<"scan" | "pay">("scan");
  const [payMode, setPayMode] = useState<PayMode>("mpesa");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [lastScannedKey, setLastScannedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mpesaReady, setMpesaReady] = useState<boolean | null>(null);
  const inventoryRef = useRef<InventoryItem[]>([]);
  const basketRef = useRef<BasketLine[]>([]);
  const priceSaveRef = useRef<Set<string>>(new Set());

  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";
  const saleTotal = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [basket],
  );

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    basketRef.current = basket;
  }, [basket]);

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

  const replaceInventoryItem = useCallback((item: InventoryItem) => {
    setInventory((prev) => {
      const index = prev.findIndex((entry) => entry.id === item.id);
      if (index === -1) return [item, ...prev];
      const next = [...prev];
      next[index] = item;
      return next;
    });
  }, []);

  const commitPrice = useCallback(
    async (key: string, unitPrice: number) => {
      if (!(unitPrice > 0)) return;
      const line = basketRef.current.find((entry) => entry.key === key);
      if (!line) return;
      const saveKey = `${key}:${unitPrice}`;
      if (priceSaveRef.current.has(saveKey)) return;

      try {
        if (line.inventoryItemId) {
          const existing = inventoryRef.current.find(
            (entry) => entry.id === line.inventoryItemId,
          );
          if (existing?.selling_price === unitPrice) return;
          priceSaveRef.current.add(saveKey);
          const updated = await updateInventorySellingPrice(
            line.inventoryItemId,
            unitPrice,
          );
          replaceInventoryItem(updated);
          return;
        }

        const compactName = line.productName.trim();
        const sku =
          /^[a-zA-Z0-9-]{4,40}$/.test(compactName) && /\d/.test(compactName)
            ? compactName
            : undefined;
        priceSaveRef.current.add(saveKey);
        const created = await addLiteInventoryProduct(compactName, String(unitPrice), {
          sku,
        });
        replaceInventoryItem(created);
        setBasket((prev) =>
          prev.map((entry) =>
            entry.key === key
              ? { ...entry, inventoryItemId: created.id, unitPrice }
              : entry,
          ),
        );
      } catch (err) {
        priceSaveRef.current.delete(saveKey);
        await showError("Could not save price", extractErrorMessage(err));
      }
    },
    [replaceInventoryItem],
  );

  const addProduct = useCallback((name: string, item: InventoryItem | null) => {
    const unitPrice =
      item?.selling_price != null && item.selling_price > 0 ? item.selling_price : 0;
    const key = basketKey(name, item?.id ?? null);
    setBasket((prev) => mergeBasketLine(prev, { name, qty: 1, unitPrice }, item));
    setLastScannedKey(key);
  }, []);

  const handleScan = useCallback((code: string) => {
    const scanned = code.trim();
    if (!scanned) return;
    const item = findInventoryByBarcode(inventoryRef.current, scanned) ?? null;
    if (item) {
      addProduct(inventoryProductName(item), item);
      void toastSuccess(inventoryProductName(item));
      return;
    }
    addProduct(scanned, null);
    void toastInfo(
      "Unknown barcode",
      `${scanned} isn’t in inventory. Set a price if you still want to sell it.`,
    );
  }, [addProduct]);

  useEffect(() => {
    const pay = new URLSearchParams(window.location.search).get("pay");
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
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const lines = basket;
    if (!lines.length) return;

    const creditMsisdn = payMode === "credit" ? toWhatsAppMsisdn(phone) : null;
    const msisdn = payMode === "mpesa" ? toWhatsAppMsisdn(phone) : creditMsisdn;
    if (payMode === "mpesa" && !mpesaReady) {
      await showError(
        "M-PESA isn't set up",
        "Add your Till, Paybill, Pochi, or phone in Settings before taking M-PESA.",
      );
      return;
    }
    if (payMode === "mpesa" && !msisdn) {
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
        const receipt = receiptFromOrder(created.data, shopName, created.mpesa_push);
        saveTransChapReceipt(receipt);
        router.push(transChapReceiptHref(created.data.id));
        return;
      } catch (err) {
        await showError(
          payMode === "mpesa" ? "Could not send M-PESA prompt" : "Could not save credit sale",
          extractErrorMessage(err),
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={
        stage === "scan"
          ? "trans-chap-form trans-chap-form--scan"
          : "auth-split__form trans-chap-form"
      }
      onSubmit={(e) => {
        if (stage === "scan") {
          e.preventDefault();
          return;
        }
        void handleSubmit(e);
      }}
    >
      {stage === "scan" ? (
        <TransChapSaleScan
          active
          basket={basket}
          inventory={inventory}
          inventoryLoading={inventoryLoading}
          lastScannedKey={lastScannedKey}
          onScan={handleScan}
          onAddProduct={addProduct}
          onQty={(key, quantity) => {
            if (quantity <= 0) {
              setBasket((prev) => prev.filter((line) => line.key !== key));
              return;
            }
            setBasket((prev) =>
              prev.map((line) => (line.key === key ? { ...line, quantity } : line)),
            );
          }}
          onPrice={(key, unitPrice) => {
            setBasket((prev) =>
              prev.map((line) => (line.key === key ? { ...line, unitPrice } : line)),
            );
          }}
          onCommitPrice={(key, unitPrice) => {
            void commitPrice(key, unitPrice);
          }}
          onRemove={(key) => {
            setBasket((prev) => prev.filter((line) => line.key !== key));
          }}
          onContinue={() => {
            void (async () => {
              await Promise.all(
                basket
                  .filter((line) => line.unitPrice > 0)
                  .map((line) => commitPrice(line.key, line.unitPrice)),
              );
              setStage("pay");
            })();
          }}
        />
      ) : (
        <>
          <p className="trans-chap-form__lead">Choose how they pay.</p>
          <div className="trans-chap-form__fields">
            <button
              type="button"
              className="trans-chap-sale-scan__back"
              onClick={() => setStage("scan")}
            >
              <i className="fa-solid fa-chevron-left" aria-hidden />
              {basket.length} item{basket.length === 1 ? "" : "s"} · {formatKsh(saleTotal)}
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

            {payMode === "mpesa" && mpesaReady !== false ? (
              <div className="trans-chap-form__block">
                <p className="trans-chap-form__block-title">Customer</p>
                <div className="auth-split__field">
                  <label htmlFor="transact-mpesa-phone">M-PESA number</label>
                  <div className="trans-chap-input">
                    <input
                      id="transact-mpesa-phone"
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
                <div className="auth-split__field">
                  <label htmlFor="transact-mpesa-name">Name</label>
                  <div className="trans-chap-input">
                    <input
                      id="transact-mpesa-name"
                      type="text"
                      autoComplete="name"
                      placeholder="Optional"
                      className="auth-split__input"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {payMode === "credit" ? (
              <div className="trans-chap-form__block">
                <p className="trans-chap-form__block-title">Customer</p>
                <p className="trans-chap-form__lead">Goes on their tab. They pay later.</p>
                <div className="auth-split__field">
                  <label htmlFor="transact-credit-name">Name</label>
                  <div className="trans-chap-input">
                    <input
                      id="transact-credit-name"
                      type="text"
                      autoComplete="name"
                      required
                      placeholder="Required"
                      className="auth-split__input"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="auth-split__field">
                  <label htmlFor="transact-credit-phone">Phone</label>
                  <div className="trans-chap-input">
                    <input
                      id="transact-credit-phone"
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
              </div>
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
                  ? "Sending prompt…"
                  : "Saving on credit…"
                : payMode === "mpesa"
                  ? "Send M-PESA prompt"
                  : "Save on credit"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
