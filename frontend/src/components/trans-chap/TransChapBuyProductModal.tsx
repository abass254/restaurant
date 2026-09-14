"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { MotionModal } from "@/components/app/MotionModal";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { showError } from "@/lib/alerts";
import { isRestaurantStore } from "@/lib/onboarding";
import type { InventoryRole } from "@/lib/types";

export type BuyProductDraft = {
  name: string;
  sku: string;
  role: InventoryRole;
  alertQuantity: string;
  weight: string;
};

const ALL_ROLE_OPTIONS: { id: InventoryRole; label: string; hint: string }[] = [
  { id: "both", label: "Buy & sell", hint: "Bought from a supplier and sold to customers" },
  { id: "raw_material", label: "Raw material", hint: "Bought for use — not sold as-is" },
];

const EMPTY: BuyProductDraft = {
  name: "",
  sku: "",
  role: "both",
  alertQuantity: "",
  weight: "",
};

type Props = {
  open: boolean;
  initialName?: string;
  onClose: () => void;
  onSave: (draft: BuyProductDraft) => void;
};

export function TransChapBuyProductModal({
  open,
  initialName = "",
  onClose,
  onSave,
}: Props) {
  const user = useOptionalAuthUser();
  const restaurant = isRestaurantStore(user?.active_account ?? user?.account);
  const roleOptions = restaurant
    ? ALL_ROLE_OPTIONS
    : ALL_ROLE_OPTIONS.filter((option) => option.id !== "raw_material");
  const baseId = useId();
  const [draft, setDraft] = useState<BuyProductDraft>(EMPTY);

  useEffect(() => {
    if (!open) return;
    setDraft({
      ...EMPTY,
      name: initialName.trim(),
    });
  }, [open, initialName]);

  function patch(next: Partial<BuyProductDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      await showError("Product name", "Enter a product name.");
      return;
    }
    onSave({
      ...draft,
      name,
      sku: draft.sku.trim(),
      alertQuantity: draft.alertQuantity.trim(),
      weight: draft.weight.trim(),
    });
  }

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Add a new product"
      panelClassName="trans-chap-purchase-modal"
    >
      <header className="inventory-modal__head">
        <h2>Add a new product</h2>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          onClick={onClose}
        >
          <i className="fa-solid fa-xmark" aria-hidden />
        </button>
      </header>

      <form
        className="inventory-modal__body trans-chap-purchase-modal__body"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="trans-chap-purchase-modal__grid">
          <div className="auth-split__field">
            <label htmlFor={`${baseId}-name`}>Product Name</label>
            <div className="trans-chap-input">
              <input
                id={`${baseId}-name`}
                type="text"
                required
                autoFocus
                className="auth-split__input"
                placeholder="Product Name"
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </div>
          </div>

          <div className="auth-split__field">
            <label htmlFor={`${baseId}-sku`}>SKU / Barcode</label>
            <div className="trans-chap-input">
              <input
                id={`${baseId}-sku`}
                type="text"
                className="auth-split__input"
                placeholder="SKU or barcode"
                value={draft.sku}
                onChange={(event) => patch({ sku: event.target.value })}
              />
            </div>
          </div>

          <div className="auth-split__field">
            <label htmlFor={`${baseId}-weight`}>Weight</label>
            <div className="trans-chap-input">
              <input
                id={`${baseId}-weight`}
                type="text"
                className="auth-split__input"
                placeholder="Weight"
                value={draft.weight}
                onChange={(event) => patch({ weight: event.target.value })}
              />
            </div>
          </div>

          <div className="auth-split__field">
            <label htmlFor={`${baseId}-alert`}>Alert quantity</label>
            <div className="trans-chap-input">
              <input
                id={`${baseId}-alert`}
                type="text"
                inputMode="numeric"
                className="auth-split__input"
                placeholder="Alert quantity"
                value={draft.alertQuantity}
                onChange={(event) =>
                  patch({ alertQuantity: event.target.value })
                }
              />
            </div>
          </div>

          {roleOptions.length > 1 ? (
            <div className="auth-split__field trans-chap-purchase-modal__span">
              <span className="trans-chap-form__label" id={`${baseId}-role`}>
                Buy as
              </span>
              <div
                className="trans-chap-form__chips"
                role="group"
                aria-labelledby={`${baseId}-role`}
              >
                {roleOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`trans-chap-form__chip${
                      draft.role === option.id ? " is-active" : ""
                    }`}
                    aria-pressed={draft.role === option.id}
                    onClick={() => patch({ role: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="trans-chap-form__hint">
                {roleOptions.find((option) => option.id === draft.role)?.hint}
              </p>
            </div>
          ) : null}
        </div>

        <div className="inventory-modal__actions trans-chap-purchase-modal__actions">
          <button
            type="button"
            className="trans-chap-form__secondary"
            onClick={onClose}
          >
            Close
          </button>
          <button type="submit" className="auth-split__btn">
            Add to purchase
          </button>
        </div>
      </form>
    </MotionModal>
  );
}
