"use client";

import { Skeleton } from "@/components/app/Skeleton";

const THREAD_PLACEHOLDERS: Array<{ direction: "in" | "out"; lines: number; width: string }> = [
  { direction: "in", lines: 2, width: "68%" },
  { direction: "out", lines: 1, width: "52%" },
  { direction: "in", lines: 3, width: "74%" },
  { direction: "out", lines: 2, width: "58%" },
  { direction: "in", lines: 1, width: "44%" },
];

export function ChatThreadSkeleton() {
  return (
    <div className="chat-thread-skeleton" aria-busy="true" aria-label="Loading messages">
      <div className="chat-thread-skeleton__day">
        <Skeleton variant="rect" width={88} height={22} className="chat-thread-skeleton__day-pill" />
      </div>
      {THREAD_PLACEHOLDERS.map((item, index) => (
        <div
          key={index}
          className={`chat-bubble-row chat-bubble-row--${item.direction} chat-thread-skeleton__row`}
        >
          <div
            className={`chat-bubble-skeleton chat-bubble-skeleton--${item.direction}`}
            style={{ width: item.width }}
          >
            {Array.from({ length: item.lines }).map((_, lineIndex) => (
              <Skeleton
                key={lineIndex}
                variant="text"
                short={lineIndex === item.lines - 1}
                className="chat-bubble-skeleton__line"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
