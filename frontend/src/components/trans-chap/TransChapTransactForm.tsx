"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
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
import { receiptFromOrder, saveTransChapReceipt, toWhatsAppMsisdn, transChapReceiptHref } from "@/lib/trans-chap-receipt";
import type {
  InventoryItem,
  MerchantMpesaConfigResponse,
  OrderCreatePayload,
  OrderMutationResponse,
} from "@/lib/types";

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
  const [mpesaReady, setMpesaReady] = useState<boolean | null>(null);

  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";

  const handleItemsChange = useCallback((items: InventoryItem[]) => {
    setInventory(items);
  }, []);

  useEffect(() => {
    const pay = new URLSearchParams(window.location.search).get("pay");
    if (pay === "mpesa" || pay === "cash") {
      setPayMode(pay);
    }
  }, []);

  useEffect(() => {
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((data) => setMpesaReady(Boolean(data.config)))
      .catch(() => setMpesaReady(false));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = product.trim();
    const parsedAmount = Number(amount);
    if (!name || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;

    const msisdn = payMode === "mpesa" ? toWhatsAppMsisdn(phone) : null;
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

    setSaving(true);
    try {
      let item = selectedItem ?? findInventoryByName(inventory, name) ?? null;
      if (!item) {
        try {
          item = await addLiteInventoryProduct(name, amount);
          setSelectedItem(item);
          setInventory((prev) => [item!, ...prev]);
        } catch {
          item = null;
        }
      }

      const customerPhone = msisdn ? `+${msisdn}` : phone.trim() || null;
      const line = {
        product_name: name,
        quantity: 1,
        unit_price: parsedAmount,
      };
      const payload: OrderCreatePayload = {
        source: "walkin",
        fulfillment_type: "pickup",
        payment_method: payMode,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone,
        items: [{ ...line, inventory_item_id: item?.id ?? null }],
      };

      try {
        let created: OrderMutationResponse;
        try {
          created = await apiFetch<OrderMutationResponse>(apiRoutes.orders, {
            method: "POST",
            body: JSON.stringify(payload),
          });
        } catch (err) {
          if (!item) throw err;
          created = await apiFetch<OrderMutationResponse>(apiRoutes.orders, {
            method: "POST",
            body: JSON.stringify({ ...payload, items: [line] } satisfies OrderCreatePayload),
          });
        }
        const receipt = receiptFromOrder(created.data, shopName, created.mpesa_push);
        saveTransChapReceipt(receipt);
        router.push(transChapReceiptHref(created.data.id));
        return;
      } catch (err) {
        if (payMode === "mpesa") {
          await showError("Could not send M-PESA prompt", extractErrorMessage(err));
          return;
        }
        await showError("Sale saved on this device", extractErrorMessage(err));
        saveTransChapReceipt({
          orderId: null,
          orderNumber: `CASH-${Date.now().toString().slice(-6)}`,
          shopName,
          productName: name,
          items: [{ name, quantity: 1, unitPrice: parsedAmount, lineTotal: parsedAmount }],
          amount: parsedAmount,
          currency: "KES",
          payMode: "cash",
          paymentStatus: "paid",
          paidAt: new Date().toISOString(),
          customerName: customerName.trim() || null,
          customerPhone,
          mpesaReceiptNumber: null,
          mpesaMessage: null,
        });
        router.push("/trans-chap/make-a-sale/receipt");
        return;
      }
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

        {payMode === "mpesa" && mpesaReady === false ? (
          <p className="trans-chap-mpesa-gate">
            Set your M-PESA details in Settings before taking M-PESA.{" "}
            <Link href="/trans-chap/settings">Set M-PESA details</Link>
          </p>
        ) : null}

        {payMode === "mpesa" && mpesaReady !== false ? (
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
        <button
          type="submit"
          className="auth-split__btn"
          disabled={saving || (payMode === "mpesa" && mpesaReady !== true)}
        >
          {saving
            ? payMode === "mpesa"
              ? "Sending prompt…"
              : "Saving sale…"
            : payMode === "mpesa"
              ? "Send M-PESA prompt"
              : "Continue"}
        </button>
      </div>
    </form>
  );
}
