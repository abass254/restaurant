"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  PAYOUT_DESTINATION_META,
  isMerchantPayoutType,
} from "@/lib/mpesa-payout";
import type {
  MerchantMpesaConfig,
  MerchantMpesaConfigResponse,
} from "@/lib/types";
import { MerchantPayoutForm } from "./MerchantPayoutForm";
import { MotionModal } from "./MotionModal";
import { Skeleton } from "./Skeleton";

export function PaymentTermsSection() {
  const [config, setConfig] = useState<MerchantMpesaConfig | null>(null);
  const [suggestedPhone, setSuggestedPhone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((data) => {
        setConfig(data.config);
        setSuggestedPhone(data.suggested_phone ?? null);
      })
      .catch(() => setConfig(null))
      .finally(() => setLoaded(true));
  }, []);

  const payoutType =
    config && isMerchantPayoutType(config.shortcode_type)
      ? config.shortcode_type
      : null;
  const methodLabel = payoutType
    ? PAYOUT_DESTINATION_META[payoutType].label
    : "Not set";

  return (
    <>
      <article className="settings-card basics-info-card basics-info-card--payments">
        <header className="settings-card__head">
          <div className="settings-card__title">
            <i
              className="fa-solid fa-money-bill-transfer settings-card__icon"
              aria-hidden="true"
            />
            <h2>Payment terms</h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setEditing(true)}
            disabled={!loaded}
          >
            <i className="fa-solid fa-pen" aria-hidden="true" />{" "}
            {config ? "Edit" : "Set up"}
          </button>
        </header>
        <div className="settings-card__body">
          {!loaded ? (
            <>
              <Skeleton variant="text" height={12} width="80%" />
              <Skeleton variant="text" height={12} width="55%" short />
            </>
          ) : (
            <>
              <dl className="settings-grid settings-grid--compact basics-info-grid">
                <div className="settings-grid__cell">
                  <dt>Method</dt>
                  <dd>{methodLabel}</dd>
                </div>
                <div className="settings-grid__cell">
                  <dt>Status</dt>
                  <dd>
                    {config ? (
                      <span className="basics-info-pill basics-info-pill--ok">
                        Configured
                      </span>
                    ) : (
                      <span className="basics-info-pill basics-info-pill--warn">
                        Not set
                      </span>
                    )}
                  </dd>
                </div>
                <div className="settings-grid__cell">
                  <dt>Destination</dt>
                  <dd>{config?.shortcode || "—"}</dd>
                </div>
                {payoutType === "paybill" ? (
                  <div className="settings-grid__cell">
                    <dt>Account number</dt>
                    <dd>{config?.account_number || "—"}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          )}
        </div>
      </article>

      <MotionModal
        open={editing}
        onClose={() => setEditing(false)}
        ariaLabelledBy="basics-payments-title"
        panelClassName="basics-payments-modal"
      >
        <header className="inventory-modal__head">
          <h2 id="basics-payments-title">Edit payment terms</h2>
        </header>
        <div className="inventory-modal__body">
          <p className="settings-muted" style={{ marginTop: 0 }}>
            Enter only the details for your payout method. We look them up on
            M-PESA so you can confirm the registered name before saving.
          </p>
          {editing ? (
            <MerchantPayoutForm
              key={config?.id ?? "new"}
              initial={config}
              suggestedPhone={suggestedPhone}
              onCancel={() => setEditing(false)}
              onSaved={(nextConfig, nextPhone) => {
                setConfig(nextConfig);
                setSuggestedPhone(nextPhone);
                setEditing(false);
              }}
            />
          ) : null}
        </div>
      </MotionModal>
    </>
  );
}
