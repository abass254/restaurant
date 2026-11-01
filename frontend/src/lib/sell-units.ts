/** Alternate units with conversions to the inventory item's base stock unit. */

import type { InventoryItem } from "@/lib/types";

export type SellUnit = {
  name: string;
  factor: number;
  reverse?: boolean;
  reference_unit?: string;
  conversion_amount?: number;
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

const KILOGRAM_UNITS = new Set([
  "kg",
  "kgs",
  "kg(s)",
  "kilogram",
  "kilograms",
  "kilogram(s)",
]);

const LITRE_UNITS = new Set([
  "l",
  "ls",
  "l(s)",
  "liter",
  "liters",
  "litre",
  "litres",
  "liter(s)",
  "litre(s)",
]);

export function allowsFractionalSelling(
  item: InventoryItem | null | undefined,
): boolean {
  const attrs = asRecord(item?.attributes);
  return attrs?.allow_fractional === true;
}

export function mergeFractionalIntoAttributes(
  attributes: Record<string, unknown> | null | undefined,
  allowFractional: boolean,
): Record<string, unknown> | null {
  const next = { ...(attributes || {}) };
  if (allowFractional) {
    next.allow_fractional = true;
  } else {
    delete next.allow_fractional;
  }
  return Object.keys(next).length ? next : null;
}

export function fractionalBaseUnitLabel(
  item: InventoryItem | null | undefined,
): string {
  const rawUnit = item?.product?.unit?.trim() || "";
  const normalized = rawUnit.toLowerCase().replace(/\.$/, "");
  if (KILOGRAM_UNITS.has(normalized)) return "KG";
  if (LITRE_UNITS.has(normalized)) return "L";
  const servingUnit = item?.product?.recipe_serving_unit?.trim();
  if (servingUnit) return servingUnit;
  if (rawUnit) return rawUnit;
  return "Unit";
}

export function fractionalSellUnits(
  item: InventoryItem | null | undefined,
): { name: string; label: string; factor: number }[] {
  if (!allowsFractionalSelling(item)) {
    return [];
  }
  const baseUnit = fractionalBaseUnitLabel(item);
  return [
    { name: `1/4 ${baseUnit}`, label: "1/4", factor: 0.25 },
    { name: `1/2 ${baseUnit}`, label: "1/2", factor: 0.5 },
    { name: `3/4 ${baseUnit}`, label: "3/4", factor: 0.75 },
    { name: baseUnit, label: "Full", factor: 1 },
  ];
}

export function packUnits(item: InventoryItem | null | undefined): SellUnit[] {
  const attrs = asRecord(item?.attributes);
  const raw = attrs?.sell_units;
  const packs: SellUnit[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const row = asRecord(entry);
      if (!row) continue;
      const name = String(row.name || "").trim();
      if (!name) continue;
      const key = normalizeUnitName(name);
      if (seen.has(key)) continue;
      const factor = Number(row.factor);
      if (!Number.isFinite(factor) || factor <= 0 || factor > 1_000_000) continue;
      seen.add(key);
      const pack: SellUnit = { name, factor: Math.round(factor * 10_000) / 10_000 };
      if (row.reverse === true) pack.reverse = true;
      const referenceUnit = String(row.reference_unit || "").trim();
      if (referenceUnit) pack.reference_unit = referenceUnit;
      const conversionAmount = Number(row.conversion_amount);
      if (Number.isFinite(conversionAmount) && conversionAmount > 0) {
        pack.conversion_amount = Math.round(conversionAmount * 1_000_000) / 1_000_000;
      }
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
  }

  // If no explicit packs are configured, automatically detect if UOM or name is a group
  if (packs.length === 0 && item?.product) {
    const uom = item.product.unit?.trim();
    const name = item.product.name?.trim();
    const detected = detectPackFactor(uom, name);
    if (detected && detected >= 2) {
      const packName = isGroupUnit(uom) ? (uom || "Bulk") : "Bulk";
      packs.push({
        name: packName,
        factor: detected,
      });
    }
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

/**
 * Defined UoMs on an inventory item for recipes/modifiers:
 * puts configured Unit conversions (e.g. "stick" where 1 Kg = 22 stick) first,
 * followed by the base stock unit (e.g. "Kg") and any enabled fractional units.
 */
export function itemDefinedUnits(item: InventoryItem | null | undefined): string[] {
  if (!item) return [];
  const packs = packUnits(item).map((p) => p.name.trim()).filter(Boolean);
  const base = baseUnitName(item).trim();
  const fractional = fractionalSellUnits(item).map((f) => f.name.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const unit of [...packs, ...(base ? [base] : []), ...fractional]) {
    const key = normalizeUnitName(unit);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(unit);
    }
  }
  return out;
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

function formatQtyNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Stock split into the largest pack + loose base units, e.g. "3 Tray + 2 Piece". */
export function groupedQtyBreakdown(item: InventoryItem): string | null {
  const qty = item.stock_quantity;
  if (qty == null || !Number.isFinite(qty) || qty <= 0) return null;
  const packs = packUnits(item).filter((pack) => pack.factor > 1);
  if (!packs.length) return null;
  const largest = packs.reduce((best, pack) =>
    pack.factor > best.factor ? pack : best,
  );
  const bulk = Math.floor(qty / largest.factor);
  if (bulk < 1) return null;
  const loose = Math.round((qty - bulk * largest.factor) * 1000) / 1000;
  const base = baseUnitName(item);
  const parts = [`${bulk} ${largest.name}`];
  if (loose > 0) parts.push(`${formatQtyNumber(loose)} ${base}`);
  return parts.join(" + ");
}

/** "3 Tray + 2 Piece (92 Piece)" when the item has packs, else the plain quantity. */
export function formatGroupedQty(item: InventoryItem): string {
  const qty = item.stock_quantity;
  if (qty == null) return "—";
  const grouped = groupedQtyBreakdown(item);
  if (!grouped) return formatQtyNumber(qty);
  return `${grouped} (${formatQtyNumber(qty)} ${baseUnitName(item)})`;
}

export function toSellUnitsPayload(packs: SellUnit[]): SellUnit[] {
  return packs
    .map((pack) => {
      const name = pack.name.trim();
      const factor = Math.round(Number(pack.factor) * 10_000) / 10_000;
      const out: SellUnit = { name, factor };
      if (pack.reverse === true) out.reverse = true;
      if (pack.reference_unit?.trim()) out.reference_unit = pack.reference_unit.trim();
      if (pack.conversion_amount != null && Number.isFinite(pack.conversion_amount) && pack.conversion_amount > 0) {
        out.conversion_amount = Math.round(pack.conversion_amount * 1_000_000) / 1_000_000;
      }
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
        pack.factor > 0 &&
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

export const GROUP_UNIT_ALIASES = new Set([
  "ctn",
  "ctns",
  "carton",
  "cartons",
  "box",
  "boxes",
  "bx",
  "crate",
  "crates",
  "tray",
  "trays",
  "bale",
  "bales",
  "bal",
  "bag",
  "bags",
  "jar",
  "jars",
  "out",
  "pkt",
  "pkts",
  "pack",
  "packs",
  "outer",
  "outers",
  "bundle",
  "bundles",
  "case",
  "cases",
]);

export const DOZEN_UNIT_ALIASES = new Set(["dozen", "dozens", "doz", "dz", "dzn"]);

export function isGroupUnit(unit?: string | null): boolean {
  if (!unit) return false;
  const clean = unit.trim().toLowerCase();
  const stripped = clean.replace(/[^a-z]/g, "");
  if (DOZEN_UNIT_ALIASES.has(stripped)) return true;
  if (GROUP_UNIT_ALIASES.has(stripped)) return true;
  if (
    /(?:pack|bundle|box|carton|case|crate|bale|tray|bag|outer|ctn|bal|dozen|dzn)\b/i.test(
      clean,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Detect pack size / pieces per bulk from a UOM or product name:
 * e.g. "Dozen" -> 12, "Carton of 24" -> 24, "Coke 24x500ml" -> 24, "Eggs 30s" -> 30.
 */
export function detectPackFactor(
  unitOrName?: string | null,
  fallbackName?: string | null,
): number | null {
  const candidates = [unitOrName, fallbackName].filter(Boolean) as string[];

  for (const text of candidates) {
    const raw = text.trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const stripped = lower.replace(/[^a-z]/g, "");

    // 1. Dozen
    if (DOZEN_UNIT_ALIASES.has(stripped)) {
      return 12;
    }

    // 2. Explicit pack/group size: e.g. "Carton of 24", "Crate of 30", "Pack 12", "Tray of 30"
    const groupMatch = lower.match(
      /(?:pack|bundle|box|carton|case|crate|bale|tray|bag|outer|ctn|bal)\s+(?:of\s+|x\s*|per\s+)?(\d+)/i,
    );
    if (groupMatch) {
      const factor = parseInt(groupMatch[1], 10);
      if (factor >= 2 && factor <= 1_000_000) return factor;
    }

    // 3. Piece count suffix: "30 pcs", "12 pieces", "24 pkts", "30 eggs", "24 cans", "12 bottles"
    const pcsMatch = lower.match(
      /\b(\d+)\s*(?:pcs|packets?|pieces?|pkts?|sachets?|bottles?|cans?|eggs?|rolls?|bars?|tabs?|nos?)\b/i,
    );
    if (pcsMatch) {
      const factor = parseInt(pcsMatch[1], 10);
      if (factor >= 2 && factor <= 1_000_000) return factor;
    }

    // 4. Volume / weight multiplier: "24x500ml", "12*1L", "24 x 1.5L"
    const measureMatch = lower.match(
      /\b(\d+)\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:ml|cl|ltrs?|litres?|liters?|l|kgs?|g|gms?|mg)\b/i,
    );
    if (measureMatch) {
      const factor = parseInt(measureMatch[1], 10);
      if (factor >= 2 && factor <= 1_000_000) return factor;
    }

    // 5. Dimension / count product: "10x4", "6x4", "1x24"
    const productMatch = lower.match(/\b(\d+)\s*[x×*]\s*(\d+)\b/);
    if (productMatch) {
      const factor = parseInt(productMatch[1], 10) * parseInt(productMatch[2], 10);
      if (factor >= 2 && factor <= 1_000_000) return factor;
    }

    // 6. Multiplier prefix: "x24", "x 12"
    const xMatch = lower.match(/(?:^|\s)[x×*]\s*(\d+)\b/);
    if (xMatch) {
      const factor = parseInt(xMatch[1], 10);
      if (factor >= 2 && factor <= 1_000_000) return factor;
    }

    // 7. S-suffix: "24s", "30's", "40s"
    const sMatch = lower.match(/\b(\d+)(?:['’]s|s)\b/i);
    if (sMatch) {
      const factor = parseInt(sMatch[1], 10);
      if (factor >= 2 && factor <= 1_000_000) return factor;
    }

    // 8. Parenthesized number: "(24)", "(12)"
    const parenMatch = lower.match(/\((\d+)\)/);
    if (parenMatch) {
      const factor = parseInt(parenMatch[1], 10);
      if (factor >= 2 && factor <= 1_000_000) return factor;
    }

    // 9. Standard default count for known fixed group units if no explicit count found
    if (stripped === "tray" || stripped === "trays") return 30;
  }

  return null;
}

/**
 * Try to detect pack size from product names like "Unga (pack of 24)" or "Water (12pcs)".
 */
export function detectPackSize(name: string): number | null {
  return detectPackFactor(name);
}
