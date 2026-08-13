import type { OrderTrackCard } from "@/lib/chat-messages";

type ChatOrderTrackCardProps = {
  track: OrderTrackCard;
};

export function ChatOrderTrackCard({ track }: ChatOrderTrackCardProps) {
  return (
    <div className="chat-order-track">
      <div className="chat-order-track__head">
        <span className="chat-order-track__label">Order tracking</span>
        <strong className="chat-order-track__ref">{track.order_number}</strong>
      </div>
      <p className="chat-order-track__status">{track.status_label}</p>
      <a
        href={track.tracking_url}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-order-track__link"
      >
        Track order
      </a>
    </div>
  );
}
