"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TransChapBarcodeScannerSheet } from "@/components/trans-chap/TransChapBarcodeScannerSheet";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { findInventoryByBarcode } from "@/lib/barcode";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  inventoryProductName,
  isHotelMenuItem,
  receiveStock,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { InventoryItem, InventoryResponse, InventoryRole } from "@/lib/types";

const ROLE_OPTIONS: { id: InventoryRole; label: string; hint: string }[] = [
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

export function TransChapUnavailablePurchaseForm() {
  const router = useRouter();
  const [product, setProduct] = useState("");
  const [barcode, setBarcode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [role, setRole] = useState<InventoryRole>("both");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
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

  const existingByName = findInventoryByName(inventory, product);
  const existingByBarcode = barcode.trim()
    ? findInventoryByBarcode(inventory, barcode)
    : undefined;
  const existing = existingByBarcode ?? existingByName;
  const existingHotel = existing ? isHotelMenuItem(existing) : false;
  const qty = Number(quantity);
  const cost = Number(unitCost);
  const lineTotal =
    Number.isInteger(qty) && qty > 0 && Number.isFinite(cost) && cost >= 0
      ? qty * cost
      : 0;

  function handleBarcodeScan(code: string) {
    const scanned = code.trim();
    if (!scanned) return;
    setScannerOpen(false);
    const match = findInventoryByBarcode(inventory, scanned);
    if (match && !isHotelMenuItem(match)) {
      void showError(
        "Already in inventory",
        `"${inventoryProductName(match)}" already uses this barcode. Buy it from Select buy instead.`,
      );
      return;
    }
    if (match && isHotelMenuItem(match)) {
      void showError(
        "Hotel menu",
        "That barcode matches a hotel menu dish — use Hotel menu instead.",
      );
      return;
    }
    setBarcode(scanned);
  }

  async function savePurchase(andAnother: boolean) {
    const name = product.trim();
    const code = barcode.trim();
    if (!name) return;
    if (!Number.isInteger(qty) || qty <= 0) {
      await showError("Quantity", "Enter how many units you bought.");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      await showError("Buying price", "Enter the unit buying price.");
      return;
    }

    const matchByCode = code ? findInventoryByBarcode(inventory, code) : undefined;
    const matchByName = findInventoryByName(inventory, name);
    const match = matchByCode ?? matchByName;
    if (match) {
      if (isHotelMenuItem(match)) {
        await showError(
          "Hotel menu",
          "Menu dishes can’t be purchased as stock. Add them from Hotel menu.",
        );
        return;
      }
      await showError(
        "Already in inventory",
        `"${inventoryProductName(match)}" is already in your stock. Buy it from Select buy instead.`,
      );
      return;
    }

    setSaving(true);
    try {
      let item = await addLiteInventoryProduct(name, "", {
        buying_price: cost,
        stock_quantity: 0,
        inventory_role: role,
        product_code: code || null,
      });
      item = await receiveStock({
        item,
        quantity: qty,
        reason: "receive",
        unitCost: cost,
        note: supplier.trim() || null,
      });
      setInventory((prev) => [item, ...prev.filter((row) => row.id !== item.id)]);
      await toastSuccess("Purchase saved");
      if (andAnother) {
        setProduct("");
        setBarcode("");
        setQuantity("1");
        setUnitCost("");
        return;
      }
      router.push("/trans-chap/purchases");
    } catch (err) {
      await showError("Could not save purchase", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await savePurchase(false);
  }

  return (
    <>
      <form
        className="auth-split__form trans-chap-form"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <p className="trans-chap-form__lead">
          Use this when the product isn’t in your stock or the catalog yet. Scan a
          barcode if you have one, then fill in the rest.
        </p>

        <div className="trans-chap-form__fields">
          <div className="auth-split__field">
            <span className="trans-chap-form__label" id="unavailable-barcode-label">
              Barcode
            </span>
            <div className="trans-chap-barcode-row">
              <div className="trans-chap-input">
                <input
                  id="unavailable-barcode"
                  type="text"
                  readOnly
                  aria-labelledby="unavailable-barcode-label"
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
            {barcode ? (
              <button
                type="button"
                className="trans-chap-photo__clear"
                disabled={saving}
                onClick={() => setBarcode("")}
              >
                Clear barcode
              </button>
            ) : (
              <p className="trans-chap-form__hint">Optional. Tap the barcode button to scan.</p>
            )}
            {existingByBarcode && !existingHotel ? (
              <p className="trans-chap-form__hint">
                This barcode is already in inventory.{" "}
                <Link href="/trans-chap/purchases/new?mode=select">Open Select buy</Link>
              </p>
            ) : null}
          </div>

          <div className="auth-split__field">
            <label htmlFor="unavailable-product">Product name</label>
            <div className="trans-chap-input">
              <input
                id="unavailable-product"
                type="text"
                required
                autoComplete="off"
                autoFocus
                placeholder="e.g. Cooking oil 5L"
                className="auth-split__input"
                value={product}
                onChange={(event) => setProduct(event.target.value)}
              />
            </div>
            {existingByName && !existingByBarcode && !existingHotel ? (
              <p className="trans-chap-form__hint">
                Already in inventory.{" "}
                <Link href="/trans-chap/purchases/new?mode=select">Open Select buy</Link>
              </p>
            ) : null}
            {existingHotel ? (
              <p className="trans-chap-form__hint">
                That matches a hotel menu dish — use Hotel menu instead.
              </p>
            ) : null}
          </div>

          <div className="auth-split__field">
            <span className="trans-chap-form__label" id="unavailable-role-label">
              Buy as
            </span>
            <div
              className="trans-chap-form__chips"
              role="group"
              aria-labelledby="unavailable-role-label"
            >
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`trans-chap-form__chip${role === option.id ? " is-active" : ""}`}
                  aria-pressed={role === option.id}
                  onClick={() => setRole(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="trans-chap-form__hint">
              {ROLE_OPTIONS.find((option) => option.id === role)?.hint}
            </p>
          </div>

          <div className="trans-chap-form__row">
            <div className="auth-split__field">
              <label htmlFor="unavailable-qty">Quantity</label>
              <div className="trans-chap-input">
                <input
                  id="unavailable-qty"
                  type="text"
                  required
                  inputMode="numeric"
                  placeholder="0"
                  className="auth-split__input"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
            </div>
            <div className="auth-split__field">
              <label htmlFor="unavailable-cost">Buying price</label>
              <div className="trans-chap-input">
                <input
                  id="unavailable-cost"
                  type="text"
                  required
                  inputMode="decimal"
                  placeholder="0"
                  className="auth-split__input"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="auth-split__field">
            <label htmlFor="unavailable-supplier">Supplier</label>
            <div className="trans-chap-input">
              <input
                id="unavailable-supplier"
                type="text"
                autoComplete="organization"
                placeholder="Optional"
                className="auth-split__input"
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
              />
            </div>
          </div>

          {lineTotal > 0 ? (
            <p className="trans-chap-form__total">
              Total <strong>{formatKsh(lineTotal)}</strong>
            </p>
          ) : null}
        </div>

        <div className="trans-chap-form__actions trans-chap-form__actions--stack">
          <button
            type="submit"
            className="auth-split__btn"
            disabled={saving || Boolean(existing)}
          >
            {saving ? "Saving purchase…" : "Save purchase"}
          </button>
          <button
            type="button"
            className="trans-chap-form__secondary"
            disabled={saving || Boolean(existing)}
            onClick={() => void savePurchase(true)}
          >
            Save & buy another
          </button>
          <p className="trans-chap-form__hint">
            Buying something you already stock?{" "}
            <Link href="/trans-chap/purchases/new?mode=select">Select buy</Link>
          </p>
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
