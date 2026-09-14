/** Pack / crate sell units on a single inventory item (stock stays in base units). */

import type { InventoryItem } from "@/lib/types";

export type SellUnit = {
  name: string;
  factor: number;
  selling_price?: number | null;
  buying_price?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeUnitName(name: string | null | undefined): string {
  return (name || "").trim().toLowerCase();
}

export function baseUnitName(item: InventoryItem): string {
  const unit = item.product?.unit?.trim();
  return unit || "Piece";
}

export function packUnits(item: InventoryItem | null | undefined): SellUnit[] {
  const attrs = asRecord(item?.attributes);
  const raw = attrs?.sell_units;
  if (!Array.isArray(raw)) return [];
  const packs: SellUnit[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const name = String(row.name || "").trim();
    if (!name) continue;
    const key = normalizeUnitName(name);
    if (seen.has(key)) continue;
    const factor = Number(row.factor);
    if (!Number.isFinite(factor) || factor < 2 || factor > 1_000_000) continue;
    seen.add(key);
    const pack: SellUnit = { name, factor: Math.floor(factor) };
    for (const priceKey of ["selling_price", "buying_price"] as const) {
      const rawPrice = row[priceKey];
      if (rawPrice == null || rawPrice === "") continue;
      const price = Number(rawPrice);
      if (Number.isFinite(price) && price >= 0) {
        pack[priceKey] = Math.round(price * 100) / 100;
      }
    }
    packs.push(pack);
  }
  return packs;
}

export function hasPackUnits(item: InventoryItem | null | undefined): boolean {
  return packUnits(item).length > 0;
}

export function allSellUnits(item: InventoryItem): SellUnit[] {
  const base: SellUnit = {
    name: baseUnitName(item),
    factor: 1,
    selling_price: item.selling_price,
    buying_price: item.buying_price,
  };
  const baseKey = normalizeUnitName(base.name);
  const baseSell = base.selling_price;
  const baseBuy = base.buying_price;
  return [
    base,
    ...packUnits(item)
      .filter((pack) => normalizeUnitName(pack.name) !== baseKey)
      .map((pack) => {
        const next = { ...pack };
        if (
          next.selling_price == null &&
          baseSell != null &&
          Number.isFinite(baseSell)
        ) {
          next.selling_price = Math.round(baseSell * pack.factor * 100) / 100;
        }
        if (
          next.buying_price == null &&
          baseBuy != null &&
          Number.isFinite(baseBuy)
        ) {
          next.buying_price = Math.round(baseBuy * pack.factor * 100) / 100;
        }
        return next;
      }),
  ];
}

export function resolveSellUnit(
  item: InventoryItem,
  sellUnitName?: string | null,
): SellUnit {
  const units = allSellUnits(item);
  if (!sellUnitName?.trim()) return units[0];
  const wanted = normalizeUnitName(sellUnitName);
  return units.find((unit) => normalizeUnitName(unit.name) === wanted) ?? units[0];
}

export function sellUnitPrice(unit: SellUnit): number | null {
  if (unit.selling_price == null || !Number.isFinite(unit.selling_price)) return null;
  return unit.selling_price;
}

export function sellUnitCost(unit: SellUnit): number | null {
  if (unit.buying_price == null || !Number.isFinite(unit.buying_price)) return null;
  return unit.buying_price;
}

export function unitHasSellPrice(unit: SellUnit): boolean {
  const price = sellUnitPrice(unit);
  return price != null && price > 0;
}

export function canSellInUnit(item: InventoryItem, unit: SellUnit): boolean {
  if (!unitHasSellPrice(unit)) return false;
  if (item.stock_quantity == null) return true;
  return item.stock_quantity >= unit.factor;
}

export function toSellUnitsPayload(packs: SellUnit[]): SellUnit[] {
  return packs
    .map((pack) => {
      const name = pack.name.trim();
      const factor = Math.floor(Number(pack.factor));
      const out: SellUnit = { name, factor };
      if (
        pack.selling_price != null &&
        Number.isFinite(pack.selling_price) &&
        pack.selling_price >= 0
      ) {
        out.selling_price = pack.selling_price;
      }
      if (
        pack.buying_price != null &&
        Number.isFinite(pack.buying_price) &&
        pack.buying_price >= 0
      ) {
        out.buying_price = pack.buying_price;
      }
      return out;
    })
    .filter(
      (pack) =>
        pack.name.length > 0 &&
        Number.isFinite(pack.factor) &&
        pack.factor >= 2 &&
        pack.factor <= 1_000_000,
    );
}

export function mergeSellUnitsIntoAttributes(
  attributes: Record<string, unknown> | null | undefined,
  packs: SellUnit[],
): Record<string, unknown> | null {
  const next = { ...(attributes || {}) };
  const clean = toSellUnitsPayload(packs);
  if (clean.length) {
    next.sell_units = clean;
  } else {
    delete next.sell_units;
  }
  return Object.keys(next).length ? next : null;
}
