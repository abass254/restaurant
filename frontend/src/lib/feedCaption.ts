export type ComposeLinkedProduct = {
  inventoryItemId: string;
  productName: string;
  productCode: string | null;
  sellingPrice: number | null;
  imageUrl: string | null;
};

export function formatComposeProductPrice(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return `KES ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatComposeProductLine(product: ComposeLinkedProduct, index: number): string {
  const parts = [`${index + 1}. ${product.productName}`];
  if (product.productCode) {
    parts[0] = `${parts[0]} (${product.productCode})`;
  }
  const price = formatComposeProductPrice(product.sellingPrice);
  if (price) {
    parts.push(`   ${price}`);
  }
  return parts.join("\n");
}

export function buildComposeCaption(
  body: string,
  products: ComposeLinkedProduct[],
): string {
  const trimmed = body.trimEnd();
  if (!products.length) return trimmed;

  const lines = products.map((product, index) => formatComposeProductLine(product, index));
  const block = `Shop:\n${lines.join("\n")}`;
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

export function composeCaptionLength(body: string, products: ComposeLinkedProduct[]): number {
  return buildComposeCaption(body, products).length;
}
