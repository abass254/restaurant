"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TransChapProductField } from "@/components/trans-chap/TransChapProductField";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  findInventoryByName,
} from "@/lib/trans-chap-product";
import { formatKsh, receiptFromOrder, saveTransChapReceipt, toWhatsAppMsisdn, transChapReceiptHref } from "@/lib/trans-chap-receipt";
import type {
  InventoryItem,
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

function basketKey(name: string, itemId: string | null, unitPrice: number): string {
  return `${itemId ?? name.trim().toLowerCase()}@${unitPrice}`;
}

function parseDraft(product: string, quantity: string, amount: string) {
  const name = product.trim();
  const qty = Number(quantity);
  const unitPrice = Number(amount);
  if (!name || !Number.isInteger(qty) || qty <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return { name, qty, unitPrice };
}

function mergeBasketLine(
  lines: BasketLine[],
  draft: { name: string; qty: number; unitPrice: number },
  item: InventoryItem | null,
): BasketLine[] {
  const key = basketKey(draft.name, item?.id ?? null, draft.unitPrice);
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
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [amount, setAmount] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("mpesa");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [mpesaReady, setMpesaReady] = useState<boolean | null>(null);

  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";
  const draft = parseDraft(product, quantity, amount);
  const draftTotal = draft ? draft.qty * draft.unitPrice : 0;
  const basketTotal = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [basket],
  );
  const saleTotal = basketTotal + draftTotal;

  const handleItemsChange = useCallback((items: InventoryItem[]) => {
    setInventory(items);
  }, []);

  function clearDraft() {
    setProduct("");
    setQuantity("1");
    setAmount("");
    setSelectedItem(null);
  }

  function addDraftToBasket() {
    if (!draft) return false;
    const item = selectedItem ?? findInventoryByName(inventory, draft.name) ?? null;
    setBasket((prev) => mergeBasketLine(prev, draft, item));
    clearDraft();
    return true;
  }

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
    const lines = draft
      ? mergeBasketLine(basket, draft, selectedItem ?? findInventoryByName(inventory, draft.name) ?? null)
      : basket;
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
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="trans-chap-form__lead">Add products, then choose how they pay.</p>
      <div className="trans-chap-form__fields">
        <TransChapProductField
          fieldId="sale-product"
          value={product}
          amount={amount}
          selectedItem={selectedItem}
          onNameChange={setProduct}
          onAmountChange={setAmount}
          onSelectItem={setSelectedItem}
          onItemsChange={handleItemsChange}
        />

        <div className="trans-chap-form__row">
          <div className="auth-split__field">
            <label htmlFor="transact-qty">Quantity</label>
            <div className="trans-chap-input">
              <input
                id="transact-qty"
                type="text"
                inputMode="numeric"
                placeholder="1"
                className="auth-split__input"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>
          <div className="auth-split__field">
            <label htmlFor="transact-amount">Unit price</label>
            <div className="trans-chap-input">
              <input
                id="transact-amount"
                type="text"
                inputMode="decimal"
                placeholder="0"
                className="auth-split__input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          className="trans-chap-basket__add"
          disabled={!draft || saving}
          onClick={() => addDraftToBasket()}
        >
          Add item
        </button>

        {basket.length ? (
          <ul className="trans-chap-basket">
            {basket.map((line) => (
              <li key={line.key}>
                <span>
                  {line.productName}
                  {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                </span>
                <em>{formatKsh(line.quantity * line.unitPrice)}</em>
                <button
                  type="button"
                  className="trans-chap-basket__remove"
                  aria-label={`Remove ${line.productName}`}
                  onClick={() => setBasket((prev) => prev.filter((entry) => entry.key !== line.key))}
                >
                  <i className="fa-solid fa-xmark" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {saleTotal > 0 ? (
          <p className="trans-chap-form__total">
            Total <strong>{formatKsh(saleTotal)}</strong>
          </p>
        ) : null}

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
    </form>
  );
}
