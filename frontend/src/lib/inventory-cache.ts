import type { InventoryItem } from "./types";

const INVENTORY_CACHE_SESSION_KEY = "trans-chap:inventory:cache:v1";

// In-memory module cache that persists across route transitions in the Next.js SPA
let inMemoryInventory: InventoryItem[] | null = null;
let hasLoadedOnce = false;

/**
 * Retrieves the cached inventory items from memory or sessionStorage.
 * Returns null if no inventory data has been loaded yet.
 */
export function getCachedInventory(): InventoryItem[] | null {
  if (inMemoryInventory && inMemoryInventory.length > 0) {
    return inMemoryInventory;
  }
  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(INVENTORY_CACHE_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          inMemoryInventory = parsed;
          hasLoadedOnce = true;
          return parsed;
        }
      }
    } catch {
      /* ignore quota or parse errors */
    }
  }
  return inMemoryInventory;
}

/**
 * Updates the shared inventory cache in memory and sessionStorage.
 */
export function setCachedInventory(items: InventoryItem[]): void {
  inMemoryInventory = items;
  hasLoadedOnce = true;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(INVENTORY_CACHE_SESSION_KEY, JSON.stringify(items));
    } catch {
      /* ignore sessionStorage quota errors in private mode */
    }
  }
}

/**
 * Optimistically updates a single item in the cache without invalidating the whole set.
 */
export function updateCachedInventoryItem(updated: InventoryItem): void {
  if (!inMemoryInventory) return;
  inMemoryInventory = inMemoryInventory.map((item) =>
    item.id === updated.id ? updated : item,
  );
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(
        INVENTORY_CACHE_SESSION_KEY,
        JSON.stringify(inMemoryInventory),
      );
    } catch {
      /* ignore quota errors */
    }
  }
}

/**
 * Checks whether initial inventory data has been loaded at least once in this session.
 */
export function hasInitialInventoryLoaded(): boolean {
  if (hasLoadedOnce) return true;
  const cached = getCachedInventory();
  return Boolean(cached && cached.length > 0);
}

/**
 * Manually mark inventory as having been loaded.
 */
export function markInventoryLoaded(): void {
  hasLoadedOnce = true;
}
