"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import { fetchKitchenIssues, type KitchenIssue } from "@/lib/restaurant-supplies";

export function RestaurantKitchenRequests() {
  const [requests, setRequests] = useState<KitchenIssue[]>([]);

  useEffect(() => {
    let alive = true;
    fetchKitchenIssues("requested")
      .then((rows) => {
        if (alive) setRequests(rows);
      })
      .catch(() => {
        /* the inventory list still works without this */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!requests.length) return null;

  return (
    <section className="rs-card tc-kitchen-requests" aria-label="Kitchen requests">
      <div className="rs-row rs-row--between">
        <p className="rs-card__title">
          <i className="fa-solid fa-fire-burner" aria-hidden /> Kitchen requests
        </p>
        <span className="rs-badge rs-badge--warn">{requests.length} waiting</span>
      </div>
      <p className="rs-card__meta">
        Open a request, hand over the supplies, enter what you actually gave, then tap Issue.
      </p>
      <ul className="tc-kitchen-requests__list">
        {requests.map((request) => (
          <li key={request.id}>
            <Link href={`/trans-chap/purchases/issue?id=${encodeURIComponent(request.id)}&from=store`}>
              <span>
                <strong>
                  {request.line_count} {request.line_count === 1 ? "supply" : "supplies"}
                </strong>
                <span className="rs-card__meta">
                  Requested {formatNairobiStamp24(request.created_at)}
                  {request.notes ? ` · ${request.notes}` : ""}
                </span>
              </span>
              <span className="tc-kitchen-requests__cta">
                Review &amp; issue <i className="fa-solid fa-chevron-right" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
