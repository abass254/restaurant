"use client";

import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { TransChapBarcodeScannerSheet } from "@/components/trans-chap/TransChapBarcodeScannerSheet";
import { TransChapSupplierField } from "@/components/trans-chap/TransChapSupplierField";
import { showError, showInternalError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { findInventoryByBarcode } from "@/lib/barcode";
import { apiRoutes } from "@/lib/config";
import { isRestaurantStore } from "@/lib/onboarding";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  inventoryProductName,
  isHotelMenuItem,
  receiveStock,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { InventoryItem, InventoryResponse, InventoryRole } from "@/lib/types";

const ALL_ROLE_OPTIONS: { id: InventoryRole; label: string; hint: string }[] = [
  {
    id: "both",
    label: "Buy & sell",
    hint: "Bought from a supplier and sold to customers",
  },
  {
    id: "raw_material",
    label: "Raw material",
    hint: "Bought for use — not sold as-is",
  },
];

type BasketLine = {
  key: string;
  barcode: string;
  productName: string;
  role: InventoryRole;
  quantity: number;
  unitCost: number;
  inventoryItemId: string | null;
};

function newLineKey(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function TransChapBulkPurchaseForm() {
  const router = useRouter();
  const user = useOptionalAuthUser();
  const restaurant = isRestaurantStore(user?.active_account ?? user?.account);
  const roleOptions = restaurant
    ? ALL_ROLE_OPTIONS
    : ALL_ROLE_OPTIONS.filter((option) => option.id !== "raw_material");
  const formId = useId();
  const [product, setProduct] = useState("");
  const [barcode, setBarcode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [role, setRole] = useState<InventoryRole>("both");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("name")?.trim();
    const code = params.get("barcode")?.trim();
    if (name) setProduct(name);
    if (code) setBarcode(code);
  }, []);

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
      });
    return () => {
      alive = false;
    };
  }, []);

  const matchByBarcode = barcode.trim()
    ? findInventoryByBarcode(inventory, barcode)
    : undefined;
  const matchByName = findInventoryByName(inventory, product);
  const matched = matchByBarcode ?? matchByName;
  const matchedHotel = matched ? isHotelMenuItem(matched) : false;

  const basketTotal = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    [basket],
  );

  function clearDraft() {
    setProduct("");
    setBarcode("");
    setQuantity("1");
    setUnitCost("");
  }

  function handleBarcodeScan(code: string) {
    const scanned = code.trim();
    if (!scanned) return;
    setScannerOpen(false);
    const match = findInventoryByBarcode(inventory, scanned);
    if (match && isHotelMenuItem(match)) {
      void showError(
        "Hotel menu",
        "That barcode matches a hotel menu dish — use Hotel menu instead.",
      );
      return;
    }
    setBarcode(scanned);
    if (match) {
      setProduct(inventoryProductName(match));
      if (match.buying_price != null) {
        setUnitCost(String(match.buying_price));
      }
      if (match.inventory_role === "raw_material" || match.inventory_role === "both") {
        setRole(match.inventory_role);
      }
    }
  }

  async function addLine() {
    const name = product.trim();
    const code = barcode.trim();
    const qty = Number(quantity);
    const cost = Number(unitCost);

    if (!name) {
      await showError("Product name", "Enter the product name.");
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      await showError("Quantity", "Enter how many units you bought.");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      await showError("Buying price", "Enter the unit buying price.");
      return;
    }
    if (matchedHotel) {
      await showError(
        "Hotel menu",
        "Menu dishes can’t be purchased as stock. Add them from Hotel menu.",
      );
      return;
    }

    const lineMatch =
      (code ? findInventoryByBarcode(inventory, code) : undefined) ??
      findInventoryByName(inventory, name);

    setBasket((prev) => [
      ...prev,
      {
        key: newLineKey(),
        barcode: code,
        productName: lineMatch ? inventoryProductName(lineMatch) : name,
        role: lineMatch
          ? lineMatch.inventory_role === "raw_material" ||
            lineMatch.inventory_role === "both"
            ? lineMatch.inventory_role
            : role
          : role,
        quantity: qty,
        unitCost: cost,
        inventoryItemId: lineMatch && !isHotelMenuItem(lineMatch) ? lineMatch.id : null,
      },
    ]);
    clearDraft();
  }

  function removeLine(key: string) {
    setBasket((prev) => prev.filter((line) => line.key !== key));
  }

  async function saveAll(event: FormEvent) {
    event.preventDefault();
    if (basket.length === 0) {
      await showError("Nothing to save", "Add at least one product first.");
      return;
    }

    setSaving(true);
    try {
      let nextInventory = inventory;
      const note = supplier.trim() || null;

      for (const line of basket) {
        let item =
          (line.inventoryItemId
            ? nextInventory.find((row) => row.id === line.inventoryItemId)
            : undefined) ??
          (line.barcode
            ? findInventoryByBarcode(nextInventory, line.barcode)
            : undefined) ??
          findInventoryByName(nextInventory, line.productName) ??
          null;

        if (item && isHotelMenuItem(item)) {
          await showError(
            "Hotel menu",
            `${line.productName} is a menu dish and can’t be purchased as stock.`,
          );
          return;
        }

        if (!item) {
          item = await addLiteInventoryProduct(line.productName, "", {
            buying_price: line.unitCost,
            stock_quantity: 0,
            inventory_role: line.role,
            sku: line.barcode || null,
          });
        }

        item = await receiveStock({
          item,
          quantity: line.quantity,
          reason: "receive",
          unitCost: line.unitCost,
          note,
        });
        nextInventory = [item, ...nextInventory.filter((row) => row.id !== item.id)];
      }

      setInventory(nextInventory);
      setBasket([]);
      await toastSuccess(
        basket.length === 1
          ? "Purchase saved"
          : `${basket.length} purchases saved`,
      );
      router.push("/trans-chap/purchases");
    } catch {
      await showInternalError();
    } finally {
      setSaving(false);
    }
  }

  const roleHint = roleOptions.find((option) => option.id === role)?.hint;

  return (
    <>
      <form
        className="auth-split__form trans-chap-form trans-chap-form--bulk"
        onSubmit={(event) => void saveAll(event)}
      >
        <p className="trans-chap-form__lead">
          Scan or type each product, add it to the list, then save everything at
          once. New items are created; existing stock is topped up.
        </p>

        <TransChapSupplierField
          id={`${formId}-supplier`}
          value={supplier}
          disabled={saving}
          placeholder="Optional — applies to this whole purchase"
          onChange={setSupplier}
        />

        <div className="trans-chap-bulk-entry">
          <div className="trans-chap-bulk-entry__row">
            <div className="auth-split__field trans-chap-bulk-entry__barcode">
              <span className="trans-chap-form__label" id={`${formId}-barcode-label`}>
                Barcode
              </span>
              <div className="trans-chap-barcode-row">
                <div className="trans-chap-input">
                  <input
                    id={`${formId}-barcode`}
                    type="text"
                    readOnly
                    aria-labelledby={`${formId}-barcode-label`}
                    placeholder="Scan to fill"
                    className="auth-split__input"
                    value={barcode}
                  />
                </div>
                <button
                  type="button"
                  className="trans-chap-product__scan"
                  aria-label={barcode ? "Scan again" : "Scan barcode"}
                  title={barcode ? "Scan again" : "Scan barcode"}
                  disabled={saving}
                  onClick={() => setScannerOpen(true)}
                >
                  <i className="fa-solid fa-barcode" aria-hidden />
                </button>
              </div>
            </div>

            <div className="auth-split__field trans-chap-bulk-entry__name">
              <label htmlFor={`${formId}-product`}>Product name</label>
              <div className="trans-chap-input">
                <input
                  id={`${formId}-product`}
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. Cooking oil 5L"
                  className="auth-split__input"
                  value={product}
                  disabled={saving}
                  onChange={(event) => setProduct(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addLine();
                    }
                  }}
                />
              </div>
            </div>

            {roleOptions.length > 1 ? (
              <div className="auth-split__field trans-chap-bulk-entry__role">
                <label htmlFor={`${formId}-role`}>Buy as</label>
                <div className="trans-chap-input trans-chap-bulk-entry__select-wrap">
                  <select
                    id={`${formId}-role`}
                    className="auth-split__input trans-chap-bulk-entry__select"
                    value={role}
                    disabled={saving}
                    onChange={(event) =>
                      setRole(event.target.value as InventoryRole)
                    }
                  >
                    {roleOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            <div className="auth-split__field trans-chap-bulk-entry__qty">
              <label htmlFor={`${formId}-qty`}>Quantity</label>
              <div className="trans-chap-input">
                <input
                  id={`${formId}-qty`}
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  className="auth-split__input"
                  value={quantity}
                  disabled={saving}
                  onChange={(event) => setQuantity(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addLine();
                    }
                  }}
                />
              </div>
            </div>

            <div className="auth-split__field trans-chap-bulk-entry__cost">
              <label htmlFor={`${formId}-cost`}>Buying price</label>
              <div className="trans-chap-input">
                <input
                  id={`${formId}-cost`}
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  className="auth-split__input"
                  value={unitCost}
                  disabled={saving}
                  onChange={(event) => setUnitCost(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addLine();
                    }
                  }}
                />
              </div>
            </div>

            <div className="trans-chap-bulk-entry__add">
              <button
                type="button"
                className="auth-split__btn"
                disabled={saving}
                onClick={() => void addLine()}
              >
                Add
              </button>
            </div>
          </div>

          {matched && !matchedHotel ? (
            <p className="trans-chap-form__hint">
              Already in stock — this line will top up{" "}
              <strong>{inventoryProductName(matched)}</strong>.
            </p>
          ) : null}
          {matchedHotel ? (
            <p className="trans-chap-form__hint">
              {restaurant
                ? "That matches a hotel menu dish — use Hotel menu instead."
                : "That product can’t be bought here."}
            </p>
          ) : null}
          {!matched && !matchedHotel && roleOptions.length > 1 ? (
            <p className="trans-chap-form__hint">{roleHint}</p>
          ) : null}
        </div>

        <div className="trans-chap-bulk-basket">
          <h3 className="trans-chap-form__block-title">
            {basket.length ? `${basket.length} to save` : "Purchase list"}
          </h3>
          {basket.length === 0 ? (
            <p className="trans-chap-form__hint">
              Nothing added yet. Scan or type a product, then tap Add.
            </p>
          ) : (
            <ul className="trans-chap-bulk-basket__list">
              {basket.map((line) => (
                <li key={line.key} className="trans-chap-bulk-basket__item">
                  <div className="trans-chap-bulk-basket__copy">
                    <strong>{line.productName}</strong>
                    <span>
                      {line.barcode ? `${line.barcode} · ` : ""}
                      Qty {line.quantity} · {formatKsh(line.unitCost)} each
                      {line.inventoryItemId ? " · restock" : " · new"}
                    </span>
                  </div>
                  <em>{formatKsh(line.quantity * line.unitCost)}</em>
                  <button
                    type="button"
                    className="trans-chap-bulk-basket__remove"
                    aria-label={`Remove ${line.productName}`}
                    disabled={saving}
                    onClick={() => removeLine(line.key)}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {basket.length > 0 ? (
            <p className="trans-chap-form__total">
              Total <strong>{formatKsh(basketTotal)}</strong>
            </p>
          ) : null}
        </div>

        <div className="trans-chap-form__actions">
          <button
            type="submit"
            className="auth-split__btn"
            disabled={saving || basket.length === 0}
          >
            {saving
              ? "Saving purchases…"
              : basket.length <= 1
                ? "Save purchase"
                : `Save ${basket.length} purchases`}
          </button>
        </div>
      </form>

      <TransChapBarcodeScannerSheet
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleBarcodeScan}
        title="Scan product barcode"
      />
    </>
  );
}
