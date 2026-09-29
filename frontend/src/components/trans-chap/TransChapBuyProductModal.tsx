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
  isBundle?: boolean;
  bundleQuantity?: string;
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
  isBundle: false,
  bundleQuantity: "",
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
      isBundle: draft.isBundle,
      bundleQuantity: draft.bundleQuantity?.trim(),
    });
  }

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabelledBy={`${baseId}-title`}
      panelClassName="trans-chap-purchase-modal"
    >
      <header className="inventory-modal__head">
        <div className="trans-chap-purchase-modal__heading">
          <h2 id={`${baseId}-title`}>Add a new product</h2>
          <p>Add the product details you need for this purchase.</p>
        </div>
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
            <label htmlFor={`${baseId}-name`}>Product name</label>
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
            <small className="trans-chap-purchase-modal__field-hint">
              This name will identify the item on the purchase.
            </small>
          </div>

          <div className="auth-split__field">
            <label htmlFor={`${baseId}-sku`}>SKU or barcode <span>(optional)</span></label>
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
            <small className="trans-chap-purchase-modal__field-hint">
              Add one if you want to find this product by scanning it.
            </small>
          </div>

          <div className="auth-split__field">
            <label htmlFor={`${baseId}-weight`}>Product size <span>(optional)</span></label>
            <div className="trans-chap-input">
              <input
                id={`${baseId}-weight`}
                type="text"
                className="auth-split__input"
                placeholder="e.g. 400 g or 1 L"
                value={draft.weight}
                onChange={(event) => patch({ weight: event.target.value })}
              />
            </div>
            <small className="trans-chap-purchase-modal__field-hint">
              Helps distinguish sizes of the same product.
            </small>
          </div>

          <div className="auth-split__field">
            <label htmlFor={`${baseId}-alert`}>Low-stock alert <span>(optional)</span></label>
            <div className="trans-chap-input">
              <input
                id={`${baseId}-alert`}
                type="text"
                inputMode="numeric"
                className="auth-split__input"
                placeholder="e.g. 5"
                value={draft.alertQuantity}
                onChange={(event) =>
                  patch({ alertQuantity: event.target.value })
                }
              />
            </div>
            <small className="trans-chap-purchase-modal__field-hint">
              Get a reminder when stock reaches this quantity.
            </small>
          </div>

          <div className="trans-chap-purchase-modal__bundle trans-chap-purchase-modal__span">
            <label className="trans-chap-purchase-modal__bundle-toggle">
              <input
                type="checkbox"
                className="trans-chap-purchase-modal__bundle-check"
                checked={draft.isBundle}
                onChange={(e) => patch({ isBundle: e.target.checked })}
              />
              <span>
                <strong>Bought as a bundle or pack</strong>
                <small>For example, buying a crate of 30 instead of one piece.</small>
              </span>
            </label>
          </div>

          {draft.isBundle ? (
            <div className="auth-split__field trans-chap-purchase-modal__span">
              <label htmlFor={`${baseId}-bundle`}>Single units in one bundle</label>
              <div className="trans-chap-input">
                <input
                  id={`${baseId}-bundle`}
                  type="number"
                  min="2"
                  step="1"
                  required
                  inputMode="numeric"
                  className="auth-split__input"
                  placeholder="e.g. 24"
                  value={draft.bundleQuantity || ""}
                  onChange={(event) =>
                    patch({ bundleQuantity: event.target.value })
                  }
                />
              </div>
              <small className="trans-chap-purchase-modal__field-hint">
                For example, enter 30 if each crate contains 30 pieces.
              </small>
            </div>
          ) : null}

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
            <i className="fa-solid fa-plus" aria-hidden="true" />
            Add to purchase
          </button>
        </div>
      </form>
    </MotionModal>
  );
}
