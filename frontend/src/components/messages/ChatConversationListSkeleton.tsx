"use client";

import { Skeleton } from "@/components/app/Skeleton";

type ChatConversationListSkeletonProps = {
  count?: number;
  compact?: boolean;
};

export function ChatConversationListSkeleton({
  count = 6,
  compact = false,
}: ChatConversationListSkeletonProps) {
  return (
    <ul
      className={`chat-conversation-list chat-conversation-list--skeleton${
        compact ? " chat-conversation-list--skeleton-compact" : ""
      }`}
      aria-busy="true"
      aria-label="Loading conversations"
    >
      {Array.from({ length: count }).map((_, index) => (
        <li key={index}>
          <div
            className={`chat-conversation-skeleton${
              compact ? " chat-conversation-skeleton--compact" : ""
            }`}
          >
            <Skeleton
              variant="circle"
              width={compact ? 36 : 44}
              height={compact ? 36 : 44}
              className="chat-conversation-skeleton__avatar"
            />
            <span className="chat-conversation-skeleton__body">
              <span className="chat-conversation-skeleton__row">
                <Skeleton variant="text" width="42%" height={12} />
                <Skeleton variant="text" width={48} height={10} />
              </span>
              <Skeleton variant="text" width="78%" height={11} short />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
