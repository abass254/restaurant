"use client";

import { FormEvent, useCallback, useState } from "react";
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
import { saveTransChapReceipt } from "@/lib/trans-chap-receipt";
import type { InventoryItem, OrderCreatePayload, OrderMutationResponse } from "@/lib/types";

type PayMode = "cash" | "mpesa";

export function TransChapTransactForm() {
  const router = useRouter();
  const user = useAuthUser();
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [saving, setSaving] = useState(false);

  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";

  const handleItemsChange = useCallback((items: InventoryItem[]) => {
    setInventory(items);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = product.trim();
    const parsedAmount = Number(amount);
    if (!name || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;

    setSaving(true);
    try {
      let item = selectedItem ?? findInventoryByName(inventory, name) ?? null;
      if (!item) {
        try {
          item = await addLiteInventoryProduct(name, amount);
          setSelectedItem(item);
          setInventory((prev) => [item, ...prev]);
        } catch {
          item = null;
        }
      }

      if (payMode !== "cash") {
        return;
      }

      let orderNumber = `CASH-${Date.now().toString().slice(-6)}`;
      let orderId: string | null = null;
      const line = {
        product_name: name,
        quantity: 1,
        unit_price: parsedAmount,
      };

      try {
        const created = await apiFetch<OrderMutationResponse>(apiRoutes.orders, {
          method: "POST",
          body: JSON.stringify({
            source: "walkin",
            fulfillment_type: "pickup",
            payment_method: "cash",
            customer_name: customerName.trim() || null,
            customer_phone: phone.trim() || null,
            items: [{ ...line, inventory_item_id: item?.id ?? null }],
          } satisfies OrderCreatePayload),
        });
        orderId = created.data.id;
        orderNumber = created.data.order_number;
      } catch (err) {
        try {
          const created = await apiFetch<OrderMutationResponse>(apiRoutes.orders, {
            method: "POST",
            body: JSON.stringify({
              source: "walkin",
              fulfillment_type: "pickup",
              payment_method: "cash",
              customer_name: customerName.trim() || null,
              customer_phone: phone.trim() || null,
              items: [line],
            } satisfies OrderCreatePayload),
          });
          orderId = created.data.id;
          orderNumber = created.data.order_number;
        } catch {
          await showError("Sale saved on this device", extractErrorMessage(err));
        }
      }

      saveTransChapReceipt({
        orderId,
        orderNumber,
        shopName,
        productName: name,
        amount: parsedAmount,
        currency: "KES",
        payMode: "cash",
        paidAt: new Date().toISOString(),
        customerName: customerName.trim() || null,
        customerPhone: phone.trim() || null,
      });
      router.push("/trans-chap/make-a-sale/receipt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="trans-chap-form__fields">
        <TransChapProductField
          value={product}
          amount={amount}
          selectedItem={selectedItem}
          onNameChange={setProduct}
          onAmountChange={setAmount}
          onSelectItem={setSelectedItem}
          onItemsChange={handleItemsChange}
        />

        <div className="auth-split__field">
          <label htmlFor="transact-customer">Customer name</label>
          <input
            id="transact-customer"
            type="text"
            autoComplete="name"
            placeholder="Optional"
            className="auth-split__input"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </div>

        <div className="auth-split__field">
          <label htmlFor="transact-amount">Amount</label>
          <input
            id="transact-amount"
            type="number"
            required
            min={1}
            step="0.01"
            inputMode="decimal"
            placeholder="0"
            className="auth-split__input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="auth-split__field">
          <span id="transact-pay-mode-label">Mode of pay</span>
          <div
            className="trans-chap-pay"
            role="radiogroup"
            aria-labelledby="transact-pay-mode-label"
          >
            <button
              type="button"
              role="radio"
              aria-checked={payMode === "cash"}
              className={`trans-chap-pay__option${payMode === "cash" ? " is-selected" : ""}`}
              onClick={() => setPayMode("cash")}
            >
              Cash
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={payMode === "mpesa"}
              className={`trans-chap-pay__option${payMode === "mpesa" ? " is-selected" : ""}`}
              onClick={() => setPayMode("mpesa")}
            >
              M-Pesa
            </button>
          </div>
        </div>

        {payMode === "mpesa" ? (
          <div className="auth-split__field">
            <label htmlFor="transact-phone">Phone number</label>
            <input
              id="transact-phone"
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
        ) : null}
      </div>

      <div className="trans-chap-form__actions">
        <button type="submit" className="auth-split__btn" disabled={saving}>
          {saving ? "Saving sale…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
