"use client";

import { Skeleton } from "@/components/app/Skeleton";

export function TransChapTodaySkeleton() {
  return (
    <div className="trans-chap-dash__analytics" aria-busy="true" aria-label="Loading today’s totals">
      <article className="trans-chap-dash__spotlight">
        <div className="trans-chap-dash__spotlight-copy">
          <span>Net profit today</span>
          <Skeleton variant="text" width="62%" height={36} />
          <Skeleton variant="text" width="78%" height={14} />
        </div>
      </article>
      <div className="trans-chap-dash__stat-grid">
        {["Sales", "Purchases"].map((label) => (
          <article key={label} className="trans-chap-dash__stat">
            <span>{label}</span>
            <Skeleton variant="text" width="70%" height={28} />
            <Skeleton variant="text" width="48%" height={12} />
          </article>
        ))}
      </div>
      <section className="trans-chap-dash__panel">
        <header className="trans-chap-dash__panel-head">
          <h3>How customers paid</h3>
        </header>
        <div className="trans-chap-dash__mix trans-chap-dash__pay--skeleton">
          <Skeleton variant="text" width="100%" height={18} />
          <Skeleton variant="text" width="100%" height={18} />
          <Skeleton variant="text" width="100%" height={18} />
        </div>
      </section>
    </div>
  );
}

export function TransChapListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="trans-chap-panel trans-chap-panel--skeleton"
        >
          <div className="trans-chap-panel__head">
            <span className="trans-chap-panel__copy">
              <Skeleton variant="text" width={`${58 - index * 6}%`} height={16} />
              <Skeleton variant="text" width={`${36 - index * 3}%`} height={12} />
            </span>
            <Skeleton variant="rect" width={72} height={22} />
          </div>
        </div>
      ))}
    </>
  );
}
