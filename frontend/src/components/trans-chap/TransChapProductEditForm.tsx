"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { TransChapPhotoField } from "@/components/trans-chap/TransChapPhotoField";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { apiFetch } from "@/lib/api";
import { showError, showInternalError, toastSuccess, internalErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { isRestaurantStore } from "@/lib/onboarding";
import {
  baseUnitName,
  mergeSellUnitsIntoAttributes,
  packUnits,
  type SellUnit,
} from "@/lib/sell-units";
import {
  inventoryCoverUrl,
  inventoryProductName,
  inventoryRole,
  isHotelMenuItem,
  isSaleableRole,
  updateInventoryItem,
  updateProductName,
  uploadInventoryPhoto,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type {
  CatalogProductMutationResponse,
  InventoryItem,
  InventoryItemDetailResponse,
  InventoryRole,
} from "@/lib/types";

const ALL_ROLE_OPTIONS: { id: InventoryRole; label: string; hint: string }[] = [
  {
    id: "both",
    label: "Buy & sell",
    hint: "Shows on Purchases and New sale",
  },
  {
    id: "for_sale",
    label: "Sell only",
    hint: "Shows on New sale only — hidden from Purchases (e.g. finished toppings)",
  },
  {
    id: "raw_material",
    label: "Raw material",
    hint: "Shows on Purchases only — not sold as-is",
  },
];

type PackDraft = {
  key: string;
  name: string;
  factor: string;
  sellingPrice: string;
};

function packDraftsFromItem(item: InventoryItem): PackDraft[] {
  return packUnits(item).map((pack, index) => ({
    key: `pack-${index}-${pack.name}`,
    name: pack.name,
    factor: String(pack.factor),
    sellingPrice:
      pack.selling_price == null ? "" : String(pack.selling_price),
  }));
}

function draftsToSellUnits(drafts: PackDraft[]): SellUnit[] {
  return drafts.map((draft) => {
    const unit: SellUnit = {
      name: draft.name.trim(),
      factor: Math.floor(Number(draft.factor)),
    };
    const price = draft.sellingPrice.trim() === "" ? null : Number(draft.sellingPrice);
    if (price != null && Number.isFinite(price) && price >= 0) {
      unit.selling_price = price;
    }
    return unit;
  });
}

export function TransChapProductEditForm() {
  const router = useRouter();
  const user = useOptionalAuthUser();
  const restaurant = isRestaurantStore(user?.active_account ?? user?.account);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [baseUnit, setBaseUnit] = useState("Piece");
  const [packs, setPacks] = useState<PackDraft[]>([]);
  const [role, setRole] = useState<InventoryRole>("for_sale");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id")?.trim() || "";
    if (!id) {
      setLoading(false);
      setError("Choose a product from Inventory to edit.");
      return;
    }
    let alive = true;
    setLoading(true);
    apiFetch<InventoryItemDetailResponse>(apiRoutes.inventoryItem(id))
      .then((res) => {
        if (!alive) return;
        const row = res.data;
        setItem(row);
        setName(inventoryProductName(row));
        setSellingPrice(row.selling_price == null ? "" : String(row.selling_price));
        setBaseUnit(baseUnitName(row));
        setPacks(packDraftsFromItem(row));
        setRole(inventoryRole(row));
        setError(null);
      })
      .catch(() => {
        if (!alive) return;
        setItem(null);
        setError(internalErrorMessage());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const hotel = item ? isHotelMenuItem(item) : false;
  const needsSellPrice = hotel || isSaleableRole(role);
  const roleOptions = useMemo(() => {
    return ALL_ROLE_OPTIONS.filter(
      (option) =>
        option.id !== "raw_material" || restaurant || role === "raw_material",
    );
  }, [restaurant, role]);

  function addPack() {
    setPacks((prev) => [
      ...prev,
      {
        key: `pack-${Date.now()}`,
        name: "",
        factor: "",
        sellingPrice: "",
      },
    ]);
  }

  function updatePack(key: string, patch: Partial<PackDraft>) {
    setPacks((prev) =>
      prev.map((pack) => (pack.key === key ? { ...pack, ...patch } : pack)),
    );
  }

  function removePack(key: string) {
    setPacks((prev) => prev.filter((pack) => pack.key !== key));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!item) return;
    const nextName = name.trim();
    if (!nextName) return;

    const sellRaw = sellingPrice.trim();
    const sell = sellRaw === "" ? null : Number(sellRaw);
    if (needsSellPrice) {
      if (sell == null || !Number.isFinite(sell) || sell <= 0) return;
    } else if (sellRaw !== "" && (sell == null || !Number.isFinite(sell) || sell < 0)) {
      return;
    }

    for (const pack of packs) {
      const packName = pack.name.trim();
      const factor = Number(pack.factor);
      if (!packName && pack.factor.trim() === "" && pack.sellingPrice.trim() === "") {
        continue;
      }
      if (!packName) {
        await showError("Pack name", "Enter a name like Crate or Dozen.");
        return;
      }
      if (!Number.isFinite(factor) || factor < 2) {
        await showError("Pack size", "Enter how many stock units are in the pack (2 or more).");
        return;
      }
      if (pack.sellingPrice.trim() !== "") {
        const packPrice = Number(pack.sellingPrice);
        if (!Number.isFinite(packPrice) || packPrice < 0) {
          await showError("Pack price", "Enter a valid pack selling price.");
          return;
        }
      }
    }

    setSaving(true);
    try {
      if (nextName !== inventoryProductName(item)) {
        const product = await updateProductName(item.product_id, nextName);
        setItem((prev) =>
          prev
            ? { ...prev, product: prev.product ? { ...prev.product, ...product } : product }
            : prev,
        );
      }
      const nextBaseUnit = baseUnit.trim() || "Piece";
      if (!hotel && nextBaseUnit !== (item.product?.unit || "Piece")) {
        const product = await apiFetch<CatalogProductMutationResponse>(
          apiRoutes.product(item.product_id),
          {
            method: "PATCH",
            body: JSON.stringify({ unit: nextBaseUnit }),
          },
        );
        setItem((prev) =>
          prev
            ? {
                ...prev,
                product: prev.product
                  ? { ...prev.product, ...product.data }
                  : product.data,
              }
            : prev,
        );
      }

      const payload: {
        selling_price?: number | null;
        inventory_role?: InventoryRole;
        attributes?: Record<string, unknown> | null;
      } = {
        selling_price: needsSellPrice ? sell : sell,
      };
      if (!hotel) {
        payload.inventory_role = role;
        payload.attributes = mergeSellUnitsIntoAttributes(
          item.attributes,
          draftsToSellUnits(packs),
        );
      }
      let updated = await updateInventoryItem(item.id, payload);
      if (photoFile) {
        try {
          updated = await uploadInventoryPhoto(item.id, photoFile);
        } catch {
          await showInternalError();
          router.push("/trans-chap/stocks");
          return;
        }
      }
      setItem(updated);
      await toastSuccess("Product updated");
      router.push("/trans-chap/stocks");
    } catch {
      await showInternalError();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="trans-chap-form__lead">Loading product…</p>;
  }

  if (error || !item) {
    return (
      <TransChapStatus
        tone="error"
        actionHref="/trans-chap/stocks"
        actionLabel="Back to Inventory"
      >
        {error || "Product not found."}
      </TransChapStatus>
    );
  }

  const qtyLabel =
    item.stock_quantity == null ? "Not tracked" : String(item.stock_quantity);
  const buyLabel =
    item.buying_price == null ? "Set on Purchases" : formatKsh(item.buying_price);

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="trans-chap-form__lead">
        {hotel
          ? "Change the dish name, photo, or selling price."
          : "Set the selling price here. Quantity updates from purchases and sales; buying price is set when you buy."}
      </p>
      <div className="trans-chap-form__fields">
        <div className="auth-split__field">
          <label htmlFor="edit-product-name">Product name</label>
          <div className="trans-chap-input">
            <input
              id="edit-product-name"
              type="text"
              required
              autoComplete="off"
              className="auth-split__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>
        <TransChapPhotoField
          existingUrl={inventoryCoverUrl(item)}
          file={photoFile}
          onFileChange={setPhotoFile}
          disabled={saving}
        />
        {hotel ? null : (
          <div className="auth-split__field">
            <span className="trans-chap-form__label" id="edit-product-role-label">
              Buy / sell type
            </span>
            <div
              className="trans-chap-form__chips"
              role="group"
              aria-labelledby="edit-product-role-label"
            >
              {roleOptions.map((option) => (
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
              {roleOptions.find((option) => option.id === role)?.hint}
            </p>
          </div>
        )}
        {hotel ? null : (
          <div className="trans-chap-form__row">
            <div className="auth-split__field">
              <span className="trans-chap-form__label">Quantity on hand</span>
              <p className="trans-chap-form__readonly">{qtyLabel}</p>
              <p className="trans-chap-form__hint">
                Counted in {baseUnit.trim() || "Piece"}s. Updates when you buy or sell.
              </p>
            </div>
            <div className="auth-split__field">
              <span className="trans-chap-form__label">Buying price</span>
              <p className="trans-chap-form__readonly">{buyLabel}</p>
              <p className="trans-chap-form__hint">Set from Purchases.</p>
            </div>
          </div>
        )}
        {hotel ? null : (
          <div className="auth-split__field">
            <label htmlFor="edit-product-base-unit">Stock unit</label>
            <div className="trans-chap-input">
              <input
                id="edit-product-base-unit"
                type="text"
                autoComplete="off"
                placeholder="Piece"
                className="auth-split__input"
                value={baseUnit}
                onChange={(event) => setBaseUnit(event.target.value)}
              />
            </div>
            <p className="trans-chap-form__hint">
              Stock is always kept in this unit (e.g. Piece, Egg, Bottle).
            </p>
          </div>
        )}
        {needsSellPrice ? (
          <div className="auth-split__field">
            <label htmlFor="edit-product-sell">
              Selling price{hotel ? "" : ` / ${baseUnit.trim() || "Piece"}`}
            </label>
            <div className="trans-chap-input">
              <input
                id="edit-product-sell"
                type="text"
                required
                inputMode="decimal"
                placeholder="0"
                className="auth-split__input"
                value={sellingPrice}
                onChange={(event) => setSellingPrice(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <p className="trans-chap-form__hint">
            Raw materials don’t need a selling price and won’t show in New sale.
          </p>
        )}
        {hotel ? null : (
          <div className="auth-split__field">
            <span className="trans-chap-form__label">Also sell as packs</span>
            <p className="trans-chap-form__hint">
              e.g. a crate of 30 eggs. Stock still drops by pieces when you sell a pack.
            </p>
            <div className="trans-chap-pack-list">
              {packs.map((pack) => (
                <div key={pack.key} className="trans-chap-pack-row">
                  <div className="trans-chap-input">
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Crate"
                      aria-label="Pack name"
                      className="auth-split__input"
                      value={pack.name}
                      onChange={(event) =>
                        updatePack(pack.key, { name: event.target.value })
                      }
                    />
                  </div>
                  <div className="trans-chap-input">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="30"
                      aria-label="Units per pack"
                      className="auth-split__input"
                      value={pack.factor}
                      onChange={(event) =>
                        updatePack(pack.key, { factor: event.target.value })
                      }
                    />
                  </div>
                  <div className="trans-chap-input">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Pack price"
                      aria-label="Pack selling price"
                      className="auth-split__input"
                      value={pack.sellingPrice}
                      onChange={(event) =>
                        updatePack(pack.key, { sellingPrice: event.target.value })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="trans-chap-pack-row__remove"
                    aria-label="Remove pack"
                    onClick={() => removePack(pack.key)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="trans-chap-form__chip"
              onClick={addPack}
              disabled={saving}
            >
              + Add pack
            </button>
          </div>
        )}
      </div>
      <div className="trans-chap-form__actions">
        <button type="submit" className="auth-split__btn" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
