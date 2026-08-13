import type { OrderPayCard } from "@/lib/chat-messages";

type ChatOrderPayCardProps = {
  pay: OrderPayCard;
};

export function ChatOrderPayCard({ pay }: ChatOrderPayCardProps) {
  const totalLabel = `${pay.currency} ${pay.total.toLocaleString("en-KE")}`;

  return (
    <div className="chat-order-pay">
      <div className="chat-order-pay__head">
        <span className="chat-order-pay__label">Order payment</span>
        <strong className="chat-order-pay__ref">{pay.order_number}</strong>
      </div>
      <p className="chat-order-pay__total">{totalLabel}</p>
      <a
        href={pay.payment_url}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-order-pay__link"
      >
        Pay now
      </a>
    </div>
  );
}
