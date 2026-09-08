"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TransChapPurchaseCatalog,
  type PurchaseCatalogLine,
} from "@/components/trans-chap/TransChapPurchaseCatalog";
import { extractErrorMessage, confirmAction, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { findInventoryByBarcode } from "@/lib/barcode";
import { apiRoutes } from "@/lib/config";
import {
  addInventoryFromCatalogProduct,
  addLiteInventoryProduct,
  fetchPurchasableCatalogProducts,
  findInventoryByName,
  inventoryProductName,
  inventoryRole,
  isHotelMenuItem,
  receiveStock,
  updateInventoryItem,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type {
  CatalogProduct,
  InventoryItem,
  InventoryResponse,
  InventoryRole,
} from "@/lib/types";

type Stage = "catalog" | "details";

type BasketLine = PurchaseCatalogLine & {
  unitCostInput: string;
};

const ROLE_OPTIONS: { id: InventoryRole; label: string; hint: string }[] = [
  { id: "both", label: "Buy & sell", hint: "Bought from a supplier and sold to customers" },
  { id: "raw_material", label: "Raw material", hint: "Bought for use — not sold as-is" },
];

function basketKey(
  name: string,
  itemId: string | null,
  catalogProductId: string | null = null,
): string {
  if (itemId) return itemId;
  if (catalogProductId) return `catalog:${catalogProductId}`;
  return name.trim().toLowerCase();
}

function lineFromItem(item: InventoryItem, qty = 1): BasketLine {
  const name = inventoryProductName(item);
  const unitCost = item.buying_price != null && item.buying_price >= 0 ? item.buying_price : 0;
  const role = inventoryRole(item);
  return {
    key: basketKey(name, item.id),
    productName: name,
    inventoryItemId: item.id,
    catalogProductId: null,
    quantity: qty,
    unitCost,
    unitCostInput: unitCost > 0 ? String(unitCost) : "",
    role: role === "for_sale" ? "both" : role,
  };
}

function lineFromCatalog(product: CatalogProduct, role: InventoryRole): BasketLine {
  const name = product.name.trim() || "Product";
  return {
    key: basketKey(name, null, product.id),
    productName: name,
    inventoryItemId: null,
    catalogProductId: product.id,
    quantity: 1,
    unitCost: 0,
    unitCostInput: "",
    role,
  };
}

function mergeBasketLine(lines: BasketLine[], next: BasketLine): BasketLine[] {
  const existing = lines.find((line) => line.key === next.key);
  if (existing) {
    return lines.map((line) =>
      line.key === next.key
        ? { ...line, quantity: line.quantity + next.quantity }
        : line,
    );
  }
  return [...lines, next];
}

export function TransChapPurchaseForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("catalog");
  const [selectMode, setSelectMode] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [lastScannedKey, setLastScannedKey] = useState<string | null>(null);
  const [supplier, setSupplier] = useState("");
  const [saving, setSaving] = useState(false);
  const inventoryRef = useRef<InventoryItem[]>([]);

  const purchaseTotal = useMemo(
    () =>
      basket.reduce((sum, line) => {
        const cost = Number(line.unitCostInput);
        const unit = Number.isFinite(cost) && cost >= 0 ? cost : line.unitCost;
        return sum + line.quantity * unit;
      }, 0),
    [basket],
  );

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSelectMode(params.get("mode") === "select" || params.get("mode") === "single");
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
      })
      .finally(() => {
        if (alive) setInventoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchPurchasableCatalogProducts()
      .then((rows) => {
        if (!alive) return;
        setCatalog(rows);
      })
      .catch(() => {
        if (!alive) return;
        setCatalog([]);
      })
      .finally(() => {
        if (alive) setCatalogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const addItem = useCallback((item: InventoryItem) => {
    if (isHotelMenuItem(item)) {
      void showError(
        "Hotel menu",
        "Menu dishes can’t be purchased as stock. Add them from Hotel menu.",
      );
      return;
    }
    if (!item.is_active) return;
    const line = lineFromItem(item);
    setBasket((prev) => mergeBasketLine(prev, line));
    setLastScannedKey(line.key);
  }, []);

  const addCatalogProduct = useCallback((product: CatalogProduct) => {
    const existing = inventoryRef.current.find(
      (item) =>
        item.product_id === product.id &&
        item.is_active &&
        !isHotelMenuItem(item),
    );
    if (existing) {
      addItem(existing);
      void toastSuccess(inventoryProductName(existing));
      return;
    }
    const line = lineFromCatalog(product, "both");
    setBasket((prev) => mergeBasketLine(prev, line));
    setLastScannedKey(line.key);
    void toastSuccess(`Added ${product.name.trim() || "product"}`);
  }, [addItem]);

  const handleScan = useCallback(
    (code: string) => {
      const scanned = code.trim();
      if (!scanned) return;
      const item = findInventoryByBarcode(inventoryRef.current, scanned) ?? null;
      if (!item) {
        void (async () => {
          const ok = await confirmAction(
            "Unknown barcode",
            `Buy “${scanned}” as a new product?`,
            "Buy new item",
          );
          if (!ok) return;
          router.push(
            `/trans-chap/purchases/unavailable?barcode=${encodeURIComponent(scanned)}`,
          );
        })();
        return;
      }
      if (isHotelMenuItem(item)) {
        void showError(
          "Hotel menu",
          "Menu dishes can’t be purchased as stock. Add them from Hotel menu.",
        );
        return;
      }
      addItem(item);
      void toastSuccess(inventoryProductName(item));
    },
    [addItem, router],
  );

  function updateLine(key: string, patch: Partial<BasketLine>) {
    setBasket((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!basket.length) return;

    for (const line of basket) {
      const cost = Number(line.unitCostInput);
      if (!Number.isFinite(cost) || cost < 0) {
        await showError("Unit cost", `Enter a unit cost for ${line.productName}.`);
        return;
      }
    }

    setSaving(true);
    try {
      let nextInventory = inventory;
      const note = supplier.trim() || null;
      for (const line of basket) {
        const cost = Number(line.unitCostInput);
        let item =
          (line.inventoryItemId
            ? nextInventory.find((entry) => entry.id === line.inventoryItemId)
            : undefined) ??
          (line.catalogProductId
            ? nextInventory.find((entry) => entry.product_id === line.catalogProductId)
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

        if (!item && line.catalogProductId) {
          item = await addInventoryFromCatalogProduct(line.catalogProductId, {
            buying_price: cost,
            stock_quantity: 0,
            inventory_role: line.role,
          });
        } else if (!item) {
          item = await addLiteInventoryProduct(line.productName, "", {
            buying_price: cost,
            stock_quantity: 0,
            inventory_role: line.role,
          });
        } else if (inventoryRole(item) !== line.role) {
          item = await updateInventoryItem(item.id, {
            inventory_role: line.role,
          });
        }

        item = await receiveStock({
          item,
          quantity: line.quantity,
          reason: "receive",
          unitCost: cost,
          note,
        });
        nextInventory = [item, ...nextInventory.filter((entry) => entry.id !== item.id)];
      }
      setInventory(nextInventory);
      await toastSuccess(
        basket.length === 1
          ? "Purchase saved"
          : `${basket.length} purchases saved`,
      );
      router.push("/trans-chap/purchases");
    } catch (err) {
      await showError("Could not save purchase", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={
        stage === "catalog"
          ? "trans-chap-form trans-chap-form--scan"
          : "auth-split__form trans-chap-form"
      }
      onSubmit={(event) => {
        if (stage === "catalog") {
          event.preventDefault();
          return;
        }
        void handleSubmit(event);
      }}
    >
      {stage === "catalog" ? (
        <TransChapPurchaseCatalog
          scan={!selectMode}
          active={!selectMode}
          basket={basket}
          inventory={inventory}
          catalog={catalog}
          inventoryLoading={inventoryLoading}
          catalogLoading={catalogLoading}
          lastScannedKey={lastScannedKey}
          onScan={handleScan}
          onAdd={addItem}
          onAddCatalog={addCatalogProduct}
          onQty={(key, quantity) => {
            if (quantity <= 0) {
              setBasket((prev) => prev.filter((line) => line.key !== key));
              return;
            }
            setBasket((prev) =>
              prev.map((line) => (line.key === key ? { ...line, quantity } : line)),
            );
          }}
          onContinue={() => setStage("details")}
        />
      ) : (
        <>
          <p className="trans-chap-form__lead">
            Enter buying prices for this delivery. Quantity was set in the basket
            and will be added when you save. Set selling prices later in Inventory.
          </p>
          <div className="trans-chap-form__fields">
            <button
              type="button"
              className="trans-chap-sale-scan__back"
              onClick={() => setStage("catalog")}
            >
              <i className="fa-solid fa-chevron-left" aria-hidden />
              {basket.length} item{basket.length === 1 ? "" : "s"}
              {purchaseTotal > 0 ? ` · ${formatKsh(purchaseTotal)}` : ""}
            </button>

            <div className="auth-split__field">
              <label htmlFor="purchase-supplier">Supplier</label>
              <div className="trans-chap-input">
                <input
                  id="purchase-supplier"
                  type="text"
                  autoComplete="organization"
                  placeholder="Optional"
                  className="auth-split__input"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                />
              </div>
            </div>

            {basket.map((line) => {
              const cost = Number(line.unitCostInput);
              const lineTotal =
                Number.isFinite(cost) && cost >= 0 ? cost * line.quantity : 0;
              return (
                <div key={line.key} className="trans-chap-form__block">
                  <p className="trans-chap-form__block-title">
                    {line.productName}
                    <span>
                      × {line.quantity}
                      {lineTotal > 0 ? ` · ${formatKsh(lineTotal)}` : ""}
                    </span>
                  </p>

                  <div className="auth-split__field">
                    <span
                      className="trans-chap-form__label"
                      id={`purchase-role-${line.key}`}
                    >
                      Buy as
                    </span>
                    <div
                      className="trans-chap-form__chips"
                      role="group"
                      aria-labelledby={`purchase-role-${line.key}`}
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`trans-chap-form__chip${
                            line.role === option.id ? " is-active" : ""
                          }`}
                          aria-pressed={line.role === option.id}
                          onClick={() => updateLine(line.key, { role: option.id })}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="trans-chap-form__hint">
                      {ROLE_OPTIONS.find((option) => option.id === line.role)?.hint}
                    </p>
                  </div>

                  <div className="auth-split__field">
                    <label htmlFor={`purchase-cost-${line.key}`}>Buying price (unit cost)</label>
                    <div className="trans-chap-input">
                      <input
                        id={`purchase-cost-${line.key}`}
                        type="text"
                        required
                        inputMode="decimal"
                        placeholder="0"
                        className="auth-split__input"
                        value={line.unitCostInput}
                        onChange={(event) =>
                          updateLine(line.key, {
                            unitCostInput: event.target.value,
                            unitCost: Number(event.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {purchaseTotal > 0 ? (
              <p className="trans-chap-form__total">
                Total <strong>{formatKsh(purchaseTotal)}</strong>
              </p>
            ) : null}
          </div>
          <div className="trans-chap-form__actions">
            <button type="submit" className="auth-split__btn" disabled={saving}>
              {saving ? "Saving purchase…" : "Save purchase"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
