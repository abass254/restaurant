"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { Skeleton } from "@/components/app/Skeleton";
import { formatNairobiDate } from "@/lib/nairobi-time";
import type { AdminWebhookEvent } from "@/lib/types";

export default function AdminWebhookDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [event, setEvent] = useState<AdminWebhookEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return undefined;
    let cancelled = false;
    setLoading(true);

    apiFetch<AdminWebhookEvent>(apiRoutes.adminWebhookEvent(eventId))
      .then((data) => {
        if (cancelled) return;
        setEvent(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load webhook event.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const payloadJson =
    event?.payload !== undefined ? JSON.stringify(event.payload, null, 2) : "";

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <Link href="/admin/webhooks" className="admin-back-link">
            ← Back to webhook log
          </Link>
          <h1 className="admin-page__title">Webhook event</h1>
          <p className="admin-page__lead">
            Full payload and metadata for one inbound webhook request.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="admin-section">
          <Skeleton height={240} />
        </div>
      ) : null}

      {error ? <p className="admin-error">{error}</p> : null}

      {!loading && event ? (
        <>
          <div className="admin-section">
            <h2 className="admin-section__title">Summary</h2>
            <dl className="admin-dl">
              <div>
                <dt>Received</dt>
                <dd>{formatNairobiDate(event.received_at) || event.received_at}</dd>
              </div>
              <div>
                <dt>HTTP status</dt>
                <dd>{event.http_status}</dd>
              </div>
              <div>
                <dt>Signature</dt>
                <dd>
                  {event.signature_valid
                    ? `valid (${event.signature_secret || "unknown"})`
                    : "invalid / missing"}
                </dd>
              </div>
              <div>
                <dt>Object</dt>
                <dd>{event.object || "—"}</dd>
              </div>
              <div>
                <dt>Event type</dt>
                <dd>{event.event_type || "—"}</dd>
              </div>
              <div>
                <dt>Preview</dt>
                <dd>{event.preview || "—"}</dd>
              </div>
              <div>
                <dt>Sender ID</dt>
                <dd>
                  <code>{event.sender_id || "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Recipient ID</dt>
                <dd>
                  <code>{event.recipient_id || "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Processing result</dt>
                <dd>{event.processing_result || "—"}</dd>
              </div>
              <div>
                <dt>Event ID</dt>
                <dd>
                  <code>{event.id}</code>
                </dd>
              </div>
            </dl>
          </div>

          <div className="admin-section">
            <h2 className="admin-section__title">Raw payload</h2>
            <pre className="admin-code-block">{payloadJson || "{}"}</pre>
          </div>
        </>
      ) : null}
    </section>
  );
}
