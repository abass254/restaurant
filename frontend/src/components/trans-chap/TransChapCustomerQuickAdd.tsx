"use client";

import { useEffect, useId, useState } from "react";
import { MotionModal } from "@/components/app/MotionModal";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { createShopCustomer, findCustomerByPhone } from "@/lib/trans-chap-customers";
import { toWhatsAppMsisdn } from "@/lib/whatsapp-phone";
import type { ShopCustomer } from "@/lib/types";

type Props = {
  open: boolean;
  /** Existing customers, used to stop duplicates by phone. */
  customers: ShopCustomer[];
  /** Pre-fill the mobile field (e.g. the walk-in phone already typed on the till). */
  initialPhone?: string;
  onClose: () => void;
  onCreated: (customer: ShopCustomer) => void;
};

/**
 * POS quick-add for customers — same flow as the supplier "Add a new contact"
 * modal on Purchases, so cashiers can save a buyer without leaving the till.
 */
export function TransChapCustomerQuickAdd({
  open,
  customers,
  initialPhone = "",
  onClose,
  onCreated,
}: Props) {
  const baseId = useId();
  const [saving, setSaving] = useState(false);
  const [contactType, setContactType] = useState<"individual" | "business">("individual");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [alternate, setAlternate] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [creditLimit, setCreditLimit] = useState("");

  useEffect(() => {
    if (!open) return;
    setContactType("individual");
    setName("");
    setMobile(initialPhone);
    setAlternate("");
    setEmail("");
    setLocation("");
    setCreditLimit("");
  }, [open, initialPhone]);

  function close() {
    if (saving) return;
    onClose();
  }

  async function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanMobile = mobile.trim();
    if (!cleanName) {
      await showError("Customer name", "Enter the customer or business name.");
      return;
    }
    if (!toWhatsAppMsisdn(cleanMobile)) {
      await showError("Mobile", "Enter a valid mobile number, e.g. 0712 345 678.");
      return;
    }
    const existing = findCustomerByPhone(customers, cleanMobile);
    if (existing) {
      onCreated(existing);
      await toastSuccess(`${existing.name} is already saved — selected`);
      return;
    }
    const limit = creditLimit.trim() ? Number(creditLimit) : 0;
    if (!Number.isFinite(limit) || limit < 0) {
      await showError("Credit limit", "Enter a credit limit of 0 or more.");
      return;
    }
    const notes = [
      contactType === "individual" ? "Type: Individual" : "Type: Business",
      alternate.trim() ? `Alt: ${alternate.trim()}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    setSaving(true);
    try {
      const created = await createShopCustomer({
        name: cleanName,
        phone: cleanMobile,
        email: email.trim() || null,
        address: location.trim() || null,
        physical_location: location.trim() || null,
        notes,
        credit_limit: limit,
      });
      onCreated(created);
      await toastSuccess("Customer saved");
    } catch (err) {
      await showError("Could not save customer", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const field = (
    key: string,
    label: string,
    input: React.ReactNode,
    hint?: string,
  ) => (
    <div className="auth-split__field">
      <label htmlFor={`${baseId}-${key}`}>{label}</label>
      <div className="trans-chap-input">{input}</div>
      {hint ? <p className="trans-chap-form__hint">{hint}</p> : null}
    </div>
  );

  return (
    <MotionModal
      open={open}
      onClose={close}
      ariaLabel="Add a new customer"
      panelClassName="trans-chap-purchase-modal"
      closeOnEscape={!saving}
      closeOnBackdrop={!saving}
    >
      <header className="inventory-modal__head">
        <h2>Add a new customer</h2>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          disabled={saving}
          onClick={close}
        >
          <i className="fa-solid fa-xmark" aria-hidden />
        </button>
      </header>
      <form
        className="inventory-modal__body trans-chap-purchase-modal__body"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="trans-chap-form__chips" role="radiogroup" aria-label="Customer type">
          {(
            [
              { id: "individual", label: "Individual" },
              { id: "business", label: "Business" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              className={`trans-chap-form__chip${contactType === option.id ? " is-active" : ""}`}
              aria-pressed={contactType === option.id}
              disabled={saving}
              onClick={() => setContactType(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="trans-chap-purchase-modal__grid">
          {field(
            "name",
            contactType === "business" ? "Business name *" : "Name *",
            <input
              id={`${baseId}-name`}
              type="text"
              required
              autoFocus
              autoComplete="name"
              className="auth-split__input"
              placeholder={contactType === "business" ? "Business name" : "Full name"}
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
            />,
          )}
          {field(
            "mobile",
            "Mobile *",
            <input
              id={`${baseId}-mobile`}
              type="tel"
              inputMode="tel"
              required
              autoComplete="tel"
              className="auth-split__input"
              placeholder="07… or 2547…"
              value={mobile}
              disabled={saving}
              onChange={(e) => setMobile(e.target.value)}
            />,
          )}
          {field(
            "email",
            "Email",
            <input
              id={`${baseId}-email`}
              type="email"
              autoComplete="email"
              className="auth-split__input"
              placeholder="Email (for receipts)"
              value={email}
              disabled={saving}
              onChange={(e) => setEmail(e.target.value)}
            />,
          )}
          {field(
            "alt",
            "Alternate contact number",
            <input
              id={`${baseId}-alt`}
              type="tel"
              inputMode="tel"
              className="auth-split__input"
              placeholder="Alternate number"
              value={alternate}
              disabled={saving}
              onChange={(e) => setAlternate(e.target.value)}
            />,
          )}
          {field(
            "location",
            "Location / address",
            <input
              id={`${baseId}-location`}
              type="text"
              autoComplete="street-address"
              className="auth-split__input"
              placeholder="e.g. Kahawa West, near stage"
              value={location}
              disabled={saving}
              onChange={(e) => setLocation(e.target.value)}
            />,
          )}
          {field(
            "credit",
            "Credit limit (Ksh)",
            <input
              id={`${baseId}-credit`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="auth-split__input"
              placeholder="0"
              value={creditLimit}
              disabled={saving}
              onChange={(e) => setCreditLimit(e.target.value)}
            />,
            "Leave at 0 if they always pay now. Set a limit to allow credit sales.",
          )}
        </div>

        <div className="inventory-modal__actions trans-chap-purchase-modal__actions">
          <button
            type="button"
            className="trans-chap-form__secondary"
            disabled={saving}
            onClick={close}
          >
            Close
          </button>
          {/* Inline colours: the modal portals outside .trans-chap-app, where the theme vars are unset. */}
          <button
            type="submit"
            disabled={saving}
            style={{
              minHeight: 46,
              padding: "0.65rem 1rem",
              border: "none",
              borderRadius: 12,
              background: "linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-hover) 100%)",
              color: "var(--app-primary-text)",
              fontSize: "0.9rem",
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
              boxShadow: "0 4px 14px color-mix(in srgb, var(--app-primary) 30%, transparent)",
            }}
          >
            <i className={`fa-solid ${saving ? "fa-spinner fa-spin" : "fa-user-plus"}`} aria-hidden />
            {saving ? "Saving…" : "Save & select"}
          </button>
        </div>
      </form>
    </MotionModal>
  );
}
