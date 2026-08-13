import { formatProductPrice, type CatalogProductCard } from "@/lib/chat-messages";

type ChatProductCardProps = {
  product: CatalogProductCard;
  compact?: boolean;
};

function nameInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function formatMeta(product: CatalogProductCard): string | null {
  if (product.category && product.brand) {
    return `${product.category} • ${product.brand}`;
  }
  return product.category || product.brand || null;
}

export function ChatProductCard({ product, compact = false }: ChatProductCardProps) {
  const imageUrl = product.image_url?.trim() || null;
  const meta = formatMeta(product);
  const unit = product.unit || "pack";

  return (
    <div className={`chat-product-card${compact ? " chat-product-card--compact" : ""}`}>
      <div className="chat-product-card__media">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" />
        ) : (
          <span className="chat-product-card__placeholder" aria-hidden="true">
            {nameInitial(product.name)}
          </span>
        )}
      </div>
      <div className="chat-product-card__body">
        <strong className="chat-product-card__name">
          {product.index > 0 ? `${product.index}. ` : ""}
          {product.name}
        </strong>
        {meta ? <span className="chat-product-card__meta">{meta}</span> : null}
        {product.price > 0 ? (
          <span className="chat-product-card__price">
            <span className="chat-product-card__amount">{formatProductPrice(product.price)}</span>
            <span className="chat-product-card__unit">/{unit}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
