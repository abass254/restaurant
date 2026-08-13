import type { InstagramMessage } from "@/lib/types";

export type CatalogProductCard = {
  index: number;
  name: string;
  price: number;
  image_url: string | null;
  category: string | null;
  brand: string | null;
  unit: string | null;
};

export type CatalogMessage = {
  title: string;
  items: CatalogProductCard[];
  shop_link: string | null;
  footer: string | null;
  overflow_count: number;
};

export type OrderTrackCard = {
  order_number: string;
  status_label: string;
  tracking_url: string;
};

export type OrderPayCard = {
  order_number: string;
  total: number;
  currency: string;
  payment_url: string;
};

export type DisplayMessage =
  | { kind: "text"; message: InstagramMessage; body: string }
  | { kind: "product_card"; message: InstagramMessage; product: CatalogProductCard }
  | { kind: "product_catalog"; message: InstagramMessage; catalog: CatalogMessage }
  | { kind: "order_track"; message: InstagramMessage; track: OrderTrackCard }
  | { kind: "order_pay"; message: InstagramMessage; pay: OrderPayCard };

const PRODUCT_CARD_PREFIX = "[product_card]";
const PRODUCT_CATALOG_PREFIX = "[product_catalog]";
const ORDER_TRACK_CARD_PREFIX = "[order_track]";
const ORDER_PAY_CARD_PREFIX = "[order_pay]";
const IMAGE_PREFIX = /^\[image\]\s+(.+)$/i;
const CATALOG_INTRO = /^here is our catalogue:?\s*$/i;
const LEGACY_PRODUCT_LINE =
  /^\s*(\d+)\.\s+(.+?)(?:,\s*which is\s*|\s*[—–-]\s*)KES\s*([\d,]+)\.?\s*$/i;

function formatCategoryLabel(category: string | null | undefined): string | null {
  const cleaned = String(category || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return cleaned || null;
}

function normalizeCatalogItem(raw: {
  index?: number;
  name?: string;
  price?: number;
  image_url?: string | null;
  category?: string | null;
  brand?: string | null;
  unit?: string | null;
}): CatalogProductCard | null {
  if (!raw.name) return null;
  return {
    index: Number(raw.index) || 0,
    name: String(raw.name),
    price: Number(raw.price) || 0,
    image_url: raw.image_url ? String(raw.image_url) : null,
    category: formatCategoryLabel(raw.category),
    brand: raw.brand ? String(raw.brand).trim() : null,
    unit: raw.unit ? String(raw.unit).trim() : null,
  };
}

export function parseProductCardBody(body: string): CatalogProductCard | null {
  if (!body.startsWith(PRODUCT_CARD_PREFIX)) return null;
  try {
    return normalizeCatalogItem(
      JSON.parse(body.slice(PRODUCT_CARD_PREFIX.length)) as {
        index?: number;
        name?: string;
        price?: number;
        image_url?: string | null;
      },
    );
  } catch {
    return null;
  }
}

export function parseProductCatalogBody(body: string): CatalogMessage | null {
  if (!body.startsWith(PRODUCT_CATALOG_PREFIX)) return null;
  try {
    const raw = JSON.parse(body.slice(PRODUCT_CATALOG_PREFIX.length)) as {
      title?: string;
      items?: Array<{
        index?: number;
        name?: string;
        price?: number;
        image_url?: string | null;
        category?: string | null;
        brand?: string | null;
        unit?: string | null;
      }>;
      shop_link?: string | null;
      footer?: string | null;
      overflow_count?: number;
    };
    const items = (raw.items ?? [])
      .map((item) => normalizeCatalogItem(item))
      .filter((item): item is CatalogProductCard => item !== null);
    if (items.length === 0) return null;
    return {
      title: String(raw.title || "Our catalogue"),
      items,
      shop_link: raw.shop_link ? String(raw.shop_link) : null,
      footer: raw.footer ? String(raw.footer) : null,
      overflow_count: Number(raw.overflow_count) || 0,
    };
  } catch {
    return null;
  }
}

function parseLegacyProductLine(body: string): CatalogProductCard | null {
  const match = LEGACY_PRODUCT_LINE.exec(body.trim());
  if (!match) return null;
  return {
    index: Number(match[1]),
    name: match[2].trim(),
    price: Number(match[3].replace(/,/g, "")),
    image_url: null,
    category: null,
    brand: null,
    unit: null,
  };
}

function collectLegacyCatalogItems(
  messages: InstagramMessage[],
  startIndex: number,
): { items: CatalogProductCard[]; consumed: number } {
  const items: CatalogProductCard[] = [];
  let cursor = startIndex;

  while (cursor < messages.length) {
    const body = (messages[cursor].body ?? "").trim();
    const product = parseProductCardBody(body);
    if (product) {
      items.push(product);
      cursor += 1;
      continue;
    }

    const imageMatch = IMAGE_PREFIX.exec(body);
    const next = messages[cursor + 1];
    const legacyProduct = next ? parseLegacyProductLine((next.body ?? "").trim()) : null;
    if (imageMatch && legacyProduct && next) {
      items.push({ ...legacyProduct, image_url: imageMatch[1].trim() });
      cursor += 2;
      continue;
    }

    const lineOnly = parseLegacyProductLine(body);
    if (lineOnly) {
      items.push(lineOnly);
      cursor += 1;
      continue;
    }

    break;
  }

  return { items, consumed: cursor - startIndex };
}

export function parseOrderTrackBody(body: string): OrderTrackCard | null {
  if (!body.startsWith(ORDER_TRACK_CARD_PREFIX)) return null;
  try {
    const raw = JSON.parse(body.slice(ORDER_TRACK_CARD_PREFIX.length)) as {
      order_number?: string;
      status_label?: string;
      tracking_url?: string;
    };
    const order_number = String(raw.order_number || "").trim();
    const tracking_url = String(raw.tracking_url || "").trim();
    if (!order_number || !tracking_url) return null;
    return {
      order_number,
      status_label: String(raw.status_label || "Order update"),
      tracking_url,
    };
  } catch {
    return null;
  }
}

export function parseOrderPayBody(body: string): OrderPayCard | null {
  if (!body.startsWith(ORDER_PAY_CARD_PREFIX)) return null;
  try {
    const raw = JSON.parse(body.slice(ORDER_PAY_CARD_PREFIX.length)) as {
      order_number?: string;
      total?: number;
      currency?: string;
      payment_url?: string;
    };
    const order_number = String(raw.order_number || "").trim();
    const payment_url = String(raw.payment_url || "").trim();
    if (!order_number || !payment_url) return null;
    return {
      order_number,
      total: Number(raw.total) || 0,
      currency: String(raw.currency || "KES"),
      payment_url,
    };
  } catch {
    return null;
  }
}

export function toDisplayMessages(messages: InstagramMessage[]): DisplayMessage[] {
  const result: DisplayMessage[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    const body = (message.body ?? "").trim();

    const catalog = parseProductCatalogBody(body);
    if (catalog) {
      result.push({ kind: "product_catalog", message, catalog });
      index += 1;
      continue;
    }

    const track = parseOrderTrackBody(body);
    if (track) {
      result.push({ kind: "order_track", message, track });
      index += 1;
      continue;
    }

    const pay = parseOrderPayBody(body);
    if (pay) {
      result.push({ kind: "order_pay", message, pay });
      index += 1;
      continue;
    }

    if (CATALOG_INTRO.test(body)) {
      const collected = collectLegacyCatalogItems(messages, index + 1);
      if (collected.items.length > 0) {
        result.push({
          kind: "product_catalog",
          message,
          catalog: {
            title: "Our catalogue",
            items: collected.items,
            shop_link: null,
            footer: null,
            overflow_count: 0,
          },
        });
        index += 1 + collected.consumed;
        continue;
      }
    }

    const product = parseProductCardBody(body);
    if (product) {
      const collected = collectLegacyCatalogItems(messages, index);
      if (collected.items.length > 1) {
        result.push({
          kind: "product_catalog",
          message,
          catalog: {
            title: "Our catalogue",
            items: collected.items,
            shop_link: null,
            footer: null,
            overflow_count: 0,
          },
        });
        index += collected.consumed;
        continue;
      }
      result.push({ kind: "product_card", message, product });
      index += 1;
      continue;
    }

    const imageMatch = IMAGE_PREFIX.exec(body);
    const next = messages[index + 1];
    const nextBody = (next?.body ?? "").trim();
    const legacyProduct = next ? parseLegacyProductLine(nextBody) : null;

    if (imageMatch && legacyProduct && next) {
      const collected = collectLegacyCatalogItems(messages, index);
      if (collected.items.length > 1) {
        result.push({
          kind: "product_catalog",
          message,
          catalog: {
            title: "Our catalogue",
            items: collected.items,
            shop_link: null,
            footer: null,
            overflow_count: 0,
          },
        });
        index += collected.consumed;
        continue;
      }
      result.push({
        kind: "product_card",
        message: next,
        product: { ...legacyProduct, image_url: imageMatch[1].trim() },
      });
      index += 2;
      continue;
    }

    result.push({ kind: "text", message, body: message.body ?? "" });
    index += 1;
  }

  return result;
}

export function formatProductPrice(price: number): string {
  return `KES ${price.toLocaleString("en-KE")}`;
}

/** Outbound agent copy emitted when the LLM provider is down or misconfigured. */
export function isAgentSystemFallbackMessage(body: string): boolean {
  const text = (body || "").trim();
  if (!text) {
    return false;
  }
  return (
    /having trouble connecting/i.test(text) ||
    /hit its api quota/i.test(text) ||
    /ai sales agent is not configured/i.test(text)
  );
}
