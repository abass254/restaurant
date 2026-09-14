"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MotionModal } from "@/components/app/MotionModal";
import {
  createShopSupplier,
  fetchShopSuppliers,
} from "@/lib/trans-chap-suppliers";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import type { ShopSupplier } from "@/lib/types";

type Props = {
  id?: string;
  value: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onAddressChange?: (address: string) => void;
};

export function TransChapSupplierField({
  id,
  value,
  disabled = false,
  required = false,
  placeholder = "Please select or type a name",
  onChange,
  onAddressChange,
}: Props) {
  const autoId = useId();
  const fieldId = id ?? `supplier-${autoId}`;
  const listId = `${fieldId}-list`;
  const [suppliers, setSuppliers] = useState<ShopSupplier[]>([]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactType, setContactType] = useState<"individual" | "business">(
    "business",
  );
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [alternate, setAlternate] = useState("");
  const [landline, setLandline] = useState("");
  const [email, setEmail] = useState("");
  const [contactId, setContactId] = useState("");
  const onAddressChangeRef = useRef(onAddressChange);
  const lastAddressRef = useRef<string | null>(null);
  onAddressChangeRef.current = onAddressChange;

  useEffect(() => {
    let alive = true;
    void fetchShopSuppliers()
      .then((rows) => {
        if (!alive) return;
        setSuppliers(rows);
      })
      .catch(() => {
        if (!alive) return;
        setSuppliers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const match = suppliers.find(
      (row) => row.name.trim().toLowerCase() === value.trim().toLowerCase(),
    );
    const next = match?.notes?.trim() || "";
    if (lastAddressRef.current === next) return;
    lastAddressRef.current = next;
    onAddressChangeRef.current?.(next);
  }, [value, suppliers]);

  function resetCreateForm() {
    setContactType("business");
    setName("");
    setMobile("");
    setAlternate("");
    setLandline("");
    setEmail("");
    setContactId("");
  }

  function closeCreate() {
    resetCreateForm();
    setCreating(false);
  }

  async function handleCreate(event?: { preventDefault(): void }) {
    event?.preventDefault();
    const cleanName = name.trim();
    const cleanMobile = mobile.trim();
    if (!cleanName) {
      await showError("Supplier name", "Enter the supplier or contact name.");
      return;
    }
    if (!cleanMobile) {
      await showError("Mobile", "Mobile number is required.");
      return;
    }
    const extra = [
      contactType === "individual" ? "Type: Individual" : "Type: Business",
      contactId.trim() ? `Contact ID: ${contactId.trim()}` : null,
      alternate.trim() ? `Alt: ${alternate.trim()}` : null,
      landline.trim() ? `Landline: ${landline.trim()}` : null,
      email.trim() ? `Email: ${email.trim()}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    setSaving(true);
    try {
      const created = await createShopSupplier({
        name: cleanName,
        phone: cleanMobile,
        notes: extra || null,
      });
      setSuppliers((prev) =>
        [...prev.filter((row) => row.id !== created.id), created].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      onChange(created.name);
      const address = created.notes?.trim() || "";
      lastAddressRef.current = address;
      onAddressChangeRef.current?.(address);
      closeCreate();
      await toastSuccess("Supplier saved");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-split__field">
      <label htmlFor={fieldId}>
        Supplier{required ? <span aria-hidden> *</span> : null}
      </label>
      <div className="trans-chap-supplier-pick">
        <div className="trans-chap-input">
          <input
            id={fieldId}
            type="text"
            list={listId}
            autoComplete="organization"
            placeholder={placeholder}
            className="auth-split__input"
            value={value}
            required={required}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="trans-chap-supplier-pick__add"
          aria-label="Add new supplier"
          aria-haspopup="dialog"
          aria-expanded={creating}
          disabled={disabled}
          onClick={() => {
            resetCreateForm();
            setCreating(true);
          }}
        >
          <i className="fa-solid fa-plus" aria-hidden />
        </button>
      </div>
      <datalist id={listId}>
        {suppliers.map((row) => (
          <option key={row.id} value={row.name} />
        ))}
      </datalist>

      <MotionModal
        open={creating}
        onClose={closeCreate}
        ariaLabel="Add a new contact"
        panelClassName="trans-chap-purchase-modal"
        closeOnEscape={!saving}
        closeOnBackdrop={!saving}
      >
        <header className="inventory-modal__head">
          <h2>Add a new contact</h2>
          <button
            type="button"
            className="fb-icon-btn"
            aria-label="Close"
            disabled={saving}
            onClick={closeCreate}
          >
            <i className="fa-solid fa-xmark" aria-hidden />
          </button>
        </header>
        <form
          className="inventory-modal__body trans-chap-purchase-modal__body"
          onSubmit={(event) => {
            void handleCreate(event);
          }}
        >
          <div
            className="trans-chap-form__chips"
            role="radiogroup"
            aria-label="Contact type"
          >
            {(
              [
                { id: "individual", label: "Individual" },
                { id: "business", label: "Business" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                className={`trans-chap-form__chip${
                  contactType === option.id ? " is-active" : ""
                }`}
                aria-pressed={contactType === option.id}
                disabled={saving}
                onClick={() => setContactType(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="trans-chap-purchase-modal__grid">
            <div className="auth-split__field">
              <label htmlFor={`${fieldId}-contact-id`}>Contact ID</label>
              <div className="trans-chap-input">
                <input
                  id={`${fieldId}-contact-id`}
                  type="text"
                  className="auth-split__input"
                  placeholder="Leave empty to autogenerate"
                  value={contactId}
                  disabled={saving}
                  onChange={(event) => setContactId(event.target.value)}
                />
              </div>
            </div>

            <div className="auth-split__field">
              <label htmlFor={`${fieldId}-name`}>
                {contactType === "business" ? "Business name" : "Name"}
              </label>
              <div className="trans-chap-input">
                <input
                  id={`${fieldId}-name`}
                  type="text"
                  required
                  className="auth-split__input"
                  placeholder={
                    contactType === "business" ? "Business name" : "Full name"
                  }
                  value={name}
                  disabled={saving}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>

            <div className="auth-split__field">
              <label htmlFor={`${fieldId}-mobile`}>Mobile</label>
              <div className="trans-chap-input">
                <input
                  id={`${fieldId}-mobile`}
                  type="tel"
                  required
                  className="auth-split__input"
                  placeholder="Mobile"
                  value={mobile}
                  disabled={saving}
                  onChange={(event) => setMobile(event.target.value)}
                />
              </div>
            </div>

            <div className="auth-split__field">
              <label htmlFor={`${fieldId}-email`}>Email</label>
              <div className="trans-chap-input">
                <input
                  id={`${fieldId}-email`}
                  type="email"
                  className="auth-split__input"
                  placeholder="Email"
                  value={email}
                  disabled={saving}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>

            <div className="auth-split__field">
              <label htmlFor={`${fieldId}-alt`}>Alternate contact number</label>
              <div className="trans-chap-input">
                <input
                  id={`${fieldId}-alt`}
                  type="tel"
                  className="auth-split__input"
                  placeholder="Alternate contact number"
                  value={alternate}
                  disabled={saving}
                  onChange={(event) => setAlternate(event.target.value)}
                />
              </div>
            </div>

            <div className="auth-split__field">
              <label htmlFor={`${fieldId}-landline`}>Landline</label>
              <div className="trans-chap-input">
                <input
                  id={`${fieldId}-landline`}
                  type="tel"
                  className="auth-split__input"
                  placeholder="Landline"
                  value={landline}
                  disabled={saving}
                  onChange={(event) => setLandline(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="inventory-modal__actions trans-chap-purchase-modal__actions">
            <button
              type="button"
              className="trans-chap-form__secondary"
              disabled={saving}
              onClick={closeCreate}
            >
              Close
            </button>
            <button type="submit" className="auth-split__btn" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </MotionModal>
    </div>
  );
}
