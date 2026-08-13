import { formatProductPrice, type CatalogMessage } from "@/lib/chat-messages";
import { ChatProductCard } from "@/components/messages/ChatProductCard";

type ChatCatalogProps = {
  catalog: CatalogMessage;
};

export function ChatCatalog({ catalog }: ChatCatalogProps) {
  const prices = catalog.items.map((item) => item.price).filter((price) => price > 0);
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null;

  return (
    <div className="chat-catalog">
      <p className="chat-catalog__title">{catalog.title}</p>
      <div className="chat-catalog__list">
        {catalog.items.map((item) => (
          <ChatProductCard key={`${item.index}-${item.name}`} product={item} compact />
        ))}
      </div>
      {catalog.overflow_count > 0 ? (
        <p className="chat-catalog__overflow">
          + {catalog.overflow_count} more item{catalog.overflow_count === 1 ? "" : "s"} in our shop
        </p>
      ) : null}
      {catalog.shop_link ? (
        <a
          className="chat-catalog__link"
          href={catalog.shop_link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Browse &amp; order
        </a>
      ) : null}
      {catalog.footer ? <p className="chat-catalog__footer">{catalog.footer}</p> : null}
      <p className="chat-catalog__count">
        {catalog.items.length} item{catalog.items.length === 1 ? "" : "s"}
        {fromPrice !== null ? ` · from ${formatProductPrice(fromPrice)}` : ""}
      </p>
    </div>
  );
}
