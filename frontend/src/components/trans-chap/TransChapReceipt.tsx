"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapReceiptPrint, TransChapReceiptSlip } from "@/components/trans-chap/TransChapReceiptSlip";
import { showError, showInternalError, toastSuccess, promptEmail, promptMpesaReceipt, promptPendingStk, promptWhatsAppPhone, extractErrorMessage } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { isRestaurantStore } from "@/lib/onboarding";
import { promptAndUndoWalkinSale, walkinUndoAction } from "@/lib/trans-chap-orders";
import {
  isTransChapReceiptClosed,
  isTransChapReceiptPaid,
  loadTransChapReceipt,
  receiptFromOrder,
  receiptHeaderLines,
  saveTransChapReceipt,
  type TransChapReceipt,
} from "@/lib/trans-chap-receipt";
import { buildTransChapReceiptPdf, saveReceiptFile } from "@/lib/trans-chap-receipt-pdf";
import type { Order, OrderDetailResponse, OrderMutationResponse } from "@/lib/types";
import { TransChapGoodsOnReturnModal } from "@/components/trans-chap/TransChapGoodsOnReturnModal";

const ORDER_POLL_MS = 4_000;

export function TransChapReceiptView() {
  const router = useRouter();
  const user = useAuthUser();
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "TransChap";
  const [receipt, setReceipt] = useState<TransChapReceipt | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [openingWhatsApp, setOpeningWhatsApp] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [resending, setResending] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const slipRef = useRef<HTMLElement>(null);
  const hasAutoPrintedRef = useRef(false);

  function applyReceipt(next: TransChapReceipt) {
    setReceipt(next);
    saveTransChapReceipt(next);
  }

  useEffect(() => {
    let cancelled = false;
    const orderId = new URLSearchParams(window.location.search).get("order");

    async function load() {
      if (orderId) {
        try {
          const data = await apiFetch<OrderDetailResponse>(apiRoutes.order(orderId));
          if (cancelled) return;
          setOrder(data.data);
          applyReceipt(receiptFromOrder(data.data, shopName));
          return;
        } catch {
          const stored = loadTransChapReceipt();
          if (!cancelled && stored?.orderId === orderId) {
            applyReceipt(stored);
            return;
          }
          if (!cancelled) {
            setMissing(true);
            router.replace("/trans-chap/sales");
          }
          return;
        }
      }

      const stored = loadTransChapReceipt();
      if (!stored) {
        if (!cancelled) {
          setMissing(true);
          router.replace("/trans-chap/sales");
        }
        return;
      }
      if (!cancelled) {
        applyReceipt(stored);
        if (stored.orderId) {
          void apiFetch<OrderDetailResponse>(apiRoutes.order(stored.orderId))
            .then((res) => {
              if (!cancelled) {
                setOrder(res.data);
                applyReceipt(receiptFromOrder(res.data, shopName));
              }
            })
            .catch(() => {});
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router, shopName]);

  useEffect(() => {
    if (!receipt?.orderId || isTransChapReceiptPaid(receipt) || isTransChapReceiptClosed(receipt)) {
      return;
    }
    let cancelled = false;
    const currentShop = receipt.shopName;
    const orderId = receipt.orderId;

    const poll = async () => {
      try {
        const data = await apiFetch<OrderDetailResponse>(apiRoutes.order(orderId));
        if (cancelled) return;
        setOrder(data.data);
        const next = receiptFromOrder(data.data, currentShop);
        let becamePaid = false;
        setReceipt((current) => {
          if (!current) return next;
          const merged: TransChapReceipt = {
            ...current,
            ...next,
            customerPhone: current.customerPhone,
            customerEmail: current.customerEmail,
            mpesaMessage: next.mpesaMessage || current.mpesaMessage,
          };
          if (
            current.paymentStatus === merged.paymentStatus &&
            current.mpesaReceiptNumber === merged.mpesaReceiptNumber &&
            current.orderStatus === merged.orderStatus
          ) {
            return current;
          }
          becamePaid = current.paymentStatus !== "paid" && merged.paymentStatus === "paid";
          saveTransChapReceipt(merged);
          return merged;
        });
        if (becamePaid) void toastSuccess("M-PESA payment received");
      } catch {
        /* keep the waiting ticket */
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), ORDER_POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [receipt?.orderId, receipt?.orderStatus, receipt?.paymentStatus, receipt?.shopName]);

  async function openWhatsApp() {
    if (!receipt) return;
    if (!receipt.orderId) {
      await showError(
        "Sale not on the server",
        "Make the sale again to send the receipt on WhatsApp.",
      );
      return;
    }
    const entered = await promptWhatsAppPhone(
      "Send receipt on WhatsApp",
      "We'll send this till receipt from TransChap WhatsApp.",
      receipt.customerPhone ?? "",
      { confirmButtonText: "Send" },
    );
    if (!entered) return;

    setOpeningWhatsApp(true);
    try {
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderSendReceiptWhatsApp(receipt.orderId),
        { method: "POST", body: JSON.stringify({ phone: entered }) },
      );
      applyReceipt({
        ...receipt,
        ...receiptFromOrder(data.data, receipt.shopName),
        customerPhone: data.recipient ?? entered,
        customerEmail: receipt.customerEmail,
      });
      await toastSuccess(data.message || `Receipt sent to ${entered}`);
    } catch (err) {
      applyReceipt({ ...receipt, customerPhone: entered });
      await showError("Could not send WhatsApp", extractErrorMessage(err));
    } finally {
      setOpeningWhatsApp(false);
    }
  }

  async function sendEmail() {
    if (!receipt) return;
    if (!receipt.orderId) {
      await showError("Sale not on the server", "Make the sale again to email the receipt.");
      return;
    }
    const entered = await promptEmail(
      "Send receipt by email",
      "We'll email this till receipt to the customer.",
      receipt.customerEmail ?? "",
    );
    if (!entered) return;

    setSendingEmail(true);
    try {
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderSendReceiptEmail(receipt.orderId),
        { method: "POST", body: JSON.stringify({ email: entered }) },
      );
      applyReceipt({
        ...receipt,
        ...receiptFromOrder(data.data, receipt.shopName),
        customerPhone: receipt.customerPhone,
        customerEmail: data.recipient ?? entered,
      });
      await toastSuccess(data.message || `Receipt sent to ${entered}`);
    } catch (err) {
      applyReceipt({ ...receipt, customerEmail: entered });
      await showInternalError();
    } finally {
      setSendingEmail(false);
    }
  }

  function printReceipt() {
    window.print();
  }

  useEffect(() => {
    if (!receipt || hasAutoPrintedRef.current) return;
    const shouldPrint =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("print") === "1";
    if (!shouldPrint) return;
    hasAutoPrintedRef.current = true;
    const timer = window.setTimeout(() => {
      window.print();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [receipt]);

  async function downloadPdf() {
    if (!receipt) return;
    setDownloading(true);
    try {
      saveReceiptFile(buildTransChapReceiptPdf(receipt));
    } catch {
      await showError("Could not download receipt", "Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function resendMpesaPrompt() {
    if (!receipt?.orderId) {
      await showError("Sale not on the server", "Make the sale again to send an M-PESA prompt.");
      return;
    }
    const choice = await promptPendingStk();
    if (!choice) return;
    setResending(true);
    try {
      if (choice === "enter_code") {
        const code = await promptMpesaReceipt(
          "Enter M-PESA code",
          "Type the transaction code from the customer’s SMS. Use this when they paid you directly or already finished on their phone.",
        );
        if (!code) return;
        const data = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderTransition(receipt.orderId),
          {
            method: "POST",
            body: JSON.stringify({
              to_status: "payment_received",
              mpesa_receipt_number: code,
            }),
          },
        );
        const next = receiptFromOrder(data.data, receipt.shopName);
        const updated = {
          ...receipt,
          ...next,
          customerPhone: receipt.customerPhone,
          customerEmail: receipt.customerEmail,
        };
        saveTransChapReceipt(updated);
        setReceipt(updated);
        await toastSuccess("M-PESA sale closed");
        return;
      }
      if (choice === "check") {
        const data = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderMpesaCheck(receipt.orderId),
          { method: "POST", body: "{}" },
        );
        const next = receiptFromOrder(data.data, receipt.shopName);
        const updated = {
          ...receipt,
          ...next,
          customerPhone: receipt.customerPhone,
          customerEmail: receipt.customerEmail,
        };
        saveTransChapReceipt(updated);
        setReceipt(updated);
        if (data.outcome === "paid") {
          await toastSuccess("Customer already paid");
        } else {
          await showError("Still waiting", "Please try again in a moment.");
        }
        return;
      }
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderMpesaStkPush(receipt.orderId),
        { method: "POST", body: "{}" },
      );
      const next = receiptFromOrder(data.data, receipt.shopName, data.mpesa_push);
      const updated = {
        ...receipt,
        ...next,
        customerPhone: receipt.customerPhone,
        customerEmail: receipt.customerEmail,
      };
      saveTransChapReceipt(updated);
      setReceipt(updated);
      if (data.mpesa_push?.status === "sent") {
        await toastSuccess("M-PESA prompt sent");
      } else {
        await showInternalError();
      }
    } catch (err) {
      await showError("Could not complete M-PESA", extractErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  async function undoSale() {
    if (!receipt?.orderId) return;
    setUndoing(true);
    try {
      const updated = await promptAndUndoWalkinSale(
        {
          id: receipt.orderId,
          status: receipt.orderStatus ?? "",
          allowed_next_statuses: receipt.allowedNextStatuses,
          payment_method: receipt.payMode,
        },
        { restaurant: isRestaurantStore(user.active_account ?? user.account) },
      );
      if (!updated) return;
      applyReceipt(receiptFromOrder(updated, receipt.shopName));
      await toastSuccess(updated.status === "refunded" ? "Sale refunded" : "Sale voided");
    } catch {
      await showInternalError();
    } finally {
      setUndoing(false);
    }
  }

  if (!receipt) {
    return (
      <p className="trans-chap-sales__empty">
        {missing ? "Receipt not found." : "Loading receipt…"}
      </p>
    );
  }

  const paid = isTransChapReceiptPaid(receipt);
  const closed = isTransChapReceiptClosed(receipt);
  const onCredit = !closed && receipt.payMode === "credit";
  const undo = receipt.orderId && isStoreAdmin(user)
    ? walkinUndoAction({
        status: receipt.orderStatus ?? "",
        allowed_next_statuses: receipt.allowedNextStatuses,
      })
    : null;
  const canReturnGoods = Boolean(
    order &&
    order.status !== "cancelled" &&
    order.status !== "refunded" &&
    (order.items ?? []).some((line) => {
      const returned = line.returned_quantity ?? 0;
      return line.quantity - returned > 0;
    })
  );

  const shownReceipt = {
    ...receipt,
    headerLines: receiptHeaderLines(user.active_account ?? user.account),
  };

  return (
    <div className="trans-chap-receipt">
      <TransChapReceiptSlip ref={slipRef} receipt={shownReceipt} />
      <TransChapReceiptPrint receipt={shownReceipt} />

      <div className="trans-chap-slip__actions">
        {closed ? null : paid || onCredit ? (
          <div className="trans-chap-slip__choices">
            <button
              type="button"
              className="trans-chap-slip__wa"
              onClick={() => void openWhatsApp()}
              disabled={openingWhatsApp || sendingEmail || downloading || undoing}
            >
              <i className="fa-brands fa-whatsapp" aria-hidden />
              {openingWhatsApp ? "Sending…" : "WhatsApp"}
            </button>
            <button
              type="button"
              className="trans-chap-slip__email"
              onClick={() => void sendEmail()}
              disabled={openingWhatsApp || sendingEmail || downloading || undoing}
            >
              <i className="fa-solid fa-envelope" aria-hidden />
              {sendingEmail ? "Sending…" : "Email"}
            </button>
            <button
              type="button"
              className="trans-chap-slip__print"
              onClick={printReceipt}
              disabled={openingWhatsApp || sendingEmail || undoing}
            >
              <i className="fa-solid fa-print" aria-hidden />
              Print
            </button>
            <button
              type="button"
              className="trans-chap-slip__pdf"
              onClick={() => void downloadPdf()}
              disabled={downloading || openingWhatsApp || sendingEmail || undoing}
            >
              <i className="fa-solid fa-file-pdf" aria-hidden />
              {downloading ? "Saving…" : "Download PDF"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="trans-chap-slip__retry"
            onClick={() => void resendMpesaPrompt()}
            disabled={resending || undoing}
          >
            <i className="fa-solid fa-rotate-right" aria-hidden />
            {resending ? "Working…" : "Complete M-PESA"}
          </button>
        )}
        {canReturnGoods ? (
          <button
            type="button"
            className="trans-chap-slip__return-btn"
            onClick={() => setReturnOpen(true)}
            disabled={openingWhatsApp || sendingEmail || downloading || undoing || resending}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              padding: "0.625rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--app-border)",
              backgroundColor: "var(--app-secondary)",
              color: "var(--app-secondary-text)",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <i className="fa-solid fa-rotate-left" aria-hidden="true" />
            Record goods on return
          </button>
        ) : null}
        {undo && !closed ? (
          <button
            type="button"
            className="trans-chap-receipt__void"
            onClick={() => void undoSale()}
            disabled={undoing || resending}
          >
            {undoing ? "Working…" : undo === "refund" ? "Refund sale" : "Void sale"}
          </button>
        ) : null}
        <Link href="/trans-chap/sales/new" className="trans-chap-receipt__again">
          Make another sale
        </Link>
      </div>

      <TransChapGoodsOnReturnModal
        order={order}
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onSuccess={(updated) => {
          setOrder(updated);
          applyReceipt(receiptFromOrder(updated, receipt.shopName));
          void toastSuccess("Goods on return recorded successfully");
        }}
      />
    </div>
  );
}
