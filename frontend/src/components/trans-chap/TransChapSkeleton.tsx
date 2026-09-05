"use client";

import { Skeleton } from "@/components/app/Skeleton";

export function TransChapTodaySkeleton() {
  return (
    <section className="trans-chap-dash__today" aria-busy="true" aria-label="Loading today’s totals">
      <h3>Today</h3>
      <div className="trans-chap-dash__kpis">
        {["Sales", "Purchases", "Profit"].map((label) => (
          <article key={label}>
            <span>{label}</span>
            <Skeleton variant="text" width="82%" height={28} />
          </article>
        ))}
      </div>
      <div className="trans-chap-dash__pay trans-chap-dash__pay--skeleton">
        <Skeleton variant="text" width="40%" height={14} />
        <Skeleton variant="text" width="55%" height={14} />
      </div>
    </section>
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
