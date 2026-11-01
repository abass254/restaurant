type FlowTone = "idle" | "current" | "success" | "failed";
type FlowLink = "idle" | "done" | "progress" | "failed";

export type MpesaFlowStep = {
  key: string;
  icon: string;
  label: string;
  tone: FlowTone;
  tooltip: string;
  /** Connector from this step toward the next (omitted on the last step). */
  link?: FlowLink;
  actionable?: boolean;
};

type MpesaFlowStatusProps = {
  steps: MpesaFlowStep[];
  className?: string;
  /** Horizontal row of icons (default) or vertical stack. */
  layout?: "row" | "column";
  ariaLabel?: string;
  onStepAction?: (step: MpesaFlowStep) => void;
};

function toneClass(tone: FlowTone): string {
  return `mpesa-flow-status__badge mpesa-flow-status__badge--${tone}`;
}

export function MpesaFlowStatus({
  steps,
  className,
  layout = "row",
  ariaLabel = "Payment flow status",
  onStepAction,
}: MpesaFlowStatusProps) {
  const rootClass = [
    "mpesa-flow-status",
    layout === "column" ? "mpesa-flow-status--column" : "mpesa-flow-status--row",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ol className={rootClass} aria-label={ariaLabel}>
      {steps.map((step) => {
        const stepClass = [
          "mpesa-flow-status__step",
          `mpesa-flow-status__step--${step.key}`,
        ].join(" ");
        const link = step.link;

        return (
          <li key={step.key} className={stepClass}>
            {step.actionable && onStepAction ? (
              <button
                type="button"
                className={`${toneClass(step.tone)} mpesa-flow-status__badge--action`}
                aria-label={`${step.label}: ${step.tooltip}. Tap to check or send the prompt again.`}
                onClick={() => onStepAction(step)}
              >
                <i className={`fa-solid ${step.icon}`} aria-hidden="true" />
                <span className="mpesa-flow-status__tip" role="tooltip">
                  <strong>{step.label}</strong>
                  <span>{step.tooltip}</span>
                </span>
              </button>
            ) : (
              <span
                className={toneClass(step.tone)}
                tabIndex={0}
                aria-label={`${step.label}: ${step.tooltip}`}
              >
                <i className={`fa-solid ${step.icon}`} aria-hidden="true" />
                <span className="mpesa-flow-status__tip" role="tooltip">
                  <strong>{step.label}</strong>
                  <span>{step.tooltip}</span>
                </span>
              </span>
            )}
            {link ? (
              <span
                className={`mpesa-flow-status__link mpesa-flow-status__link--${link}`}
                aria-hidden="true"
              >
                {link === "progress" ? (
                  <span className="mpesa-flow-status__transit-dot" />
                ) : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

type CollectionLike = {
  status: string;
  result_desc?: string | null;
  mpesa_receipt_number?: string | null;
  has_received_money?: boolean;
  payout_status?: string | null;
  payout_result_desc?: string | null;
  payout_receipt_number?: string | null;
  payout_shortcode?: string | null;
  payout_shortcode_type?: string | null;
  can_send_to_merchant?: boolean;
  is_admin_payout?: boolean;
  merchant_name?: string | null;
};

function formatDest(type: string | null | undefined, code: string | null | undefined): string {
  if (!code) return "merchant settlement destination";
  const kind = (type || "").toLowerCase();
  const label =
    kind === "pochi" || kind === "pochi_la_biashara"
      ? "Pochi"
      : kind === "phone" || kind === "b2c" || kind === "msisdn"
        ? "Phone"
        : kind === "till" || kind === "buygoods" || kind === "buy_goods"
          ? "Till"
          : kind === "paybill"
            ? "Paybill"
            : "Destination";
  return `${label} ${code}`;
}

/** Build Client → TransChap → Merchant step states for a collection/payout row.
 *  - success: money has reached that stage (brand color)
 *  - current: money is sitting at that stage (brand color + pulse)
 *  - idle: money has not reached that stage yet (gray)
 *  - failed: that stage failed
 *  - link progress: money is in transit on the connector between stages
 */
export function buildMpesaFlowSteps(txn: CollectionLike): MpesaFlowStep[] {
  const isAdminPayout = Boolean(txn.is_admin_payout);
  const received =
    txn.has_received_money ??
    (txn.status === "success" && Boolean((txn.mpesa_receipt_number || "").trim()));
  const payout = (txn.payout_status || "").toLowerCase();
  const payoutDone = payout === "success";
  const payoutInFlight = payout === "queued" || payout === "pending";
  const payoutFailed = payout === "failed" || payout === "skipped";
  const dest = formatDest(txn.payout_shortcode_type, txn.payout_shortcode);

  let clientTone: FlowTone = "idle";
  let clientTip = "STK not started.";
  let clientLink: FlowLink = "idle";
  if (isAdminPayout) {
    clientTone = "idle";
    clientTip = "No client STK — this is a hub → merchant payout.";
    clientLink = "idle";
  } else if (txn.status === "pending") {
    clientTone = "current";
    clientTip = txn.result_desc || "Waiting for the client to complete the M-PESA prompt.";
    clientLink = "progress";
  } else if (txn.status === "success") {
    clientTone = "success";
    clientTip = txn.result_desc || "Client completed the M-PESA payment.";
    clientLink = "done";
  } else if (txn.status === "failed" || txn.status === "cancelled") {
    clientTone = "failed";
    clientTip = txn.result_desc || `Client payment ${txn.status}.`;
    clientLink = "failed";
  }

  let hubTone: FlowTone = "idle";
  let hubTip = "Waiting for funds on the TransChap hub Paybill.";
  let hubLink: FlowLink = "idle";
  if (isAdminPayout) {
    if (payoutDone) {
      hubTone = "success";
      hubTip = "Funds left the TransChap hub Paybill.";
      hubLink = "done";
    } else if (payoutInFlight) {
      hubTone = "success";
      hubTip = "Payout in progress from the TransChap hub.";
      hubLink = "progress";
    } else if (payoutFailed) {
      hubTone = "current";
      hubTip = "Funds remain on the TransChap hub after a payout issue.";
      hubLink = "failed";
    } else {
      hubTone = "current";
      hubTip = "Funds leave the TransChap hub Paybill.";
      hubLink = "idle";
    }
  } else if (txn.status === "pending") {
    hubTone = "idle";
    hubTip = "Hub collection pending client payment.";
    hubLink = "idle";
  } else if (txn.status === "failed" || txn.status === "cancelled") {
    hubTone = "idle";
    hubTip = "Funds did not land on TransChap.";
    hubLink = "idle";
  } else if (received) {
    if (payoutDone) {
      hubTone = "success";
      hubTip = txn.mpesa_receipt_number
        ? `Received at TransChap · receipt ${txn.mpesa_receipt_number}`
        : "Payment received on the TransChap hub.";
      hubLink = "done";
    } else if (payoutInFlight) {
      hubTone = "success";
      hubTip = txn.mpesa_receipt_number
        ? `Sending from TransChap · receipt ${txn.mpesa_receipt_number}`
        : "Sending from TransChap to merchant…";
      hubLink = "progress";
    } else if (payoutFailed) {
      hubTone = "current";
      hubTip = txn.mpesa_receipt_number
        ? `At TransChap · receipt ${txn.mpesa_receipt_number}`
        : "Payment at TransChap after a payout issue.";
      hubLink = "failed";
    } else {
      hubTone = "current";
      hubTip = txn.mpesa_receipt_number
        ? `At TransChap · receipt ${txn.mpesa_receipt_number}`
        : "Payment at TransChap — awaiting merchant payout.";
      hubLink = "idle";
    }
  } else if (txn.status === "success") {
    hubTone = "current";
    hubTip = "Collection marked success — awaiting hub confirmation.";
    hubLink = "idle";
  }

  let merchantTone: FlowTone = "idle";
  let merchantTip = "Waiting for TransChap → merchant payout.";
  if (!received && !isAdminPayout) {
    merchantTone = "idle";
    merchantTip = "Payout unlocks after money is at TransChap.";
  } else if (payoutDone) {
    merchantTone = "success";
    merchantTip = txn.payout_receipt_number
      ? `Paid to ${dest} · ${txn.payout_receipt_number}`
      : txn.payout_result_desc || `Paid out to ${dest}.`;
  } else if (payoutInFlight) {
    // Keep merchant gray — money is still in transit, not received.
    merchantTone = "idle";
    merchantTip = txn.payout_result_desc || `Payout to ${dest} in progress.`;
  } else if (payoutFailed) {
    merchantTone = "failed";
    merchantTip = txn.payout_result_desc || `Payout ${payout} for ${dest}.`;
  } else {
    merchantTone = "idle";
    merchantTip =
      txn.payout_result_desc ||
      (txn.merchant_name
        ? `Awaiting send to ${txn.merchant_name} (${dest}).`
        : `Awaiting send to ${dest}.`);
  }

  return [
    {
      key: "client",
      icon: "fa-user",
      label: "Client",
      tone: clientTone,
      tooltip: clientTip,
      link: clientLink,
      actionable: clientTone === "current" || clientTone === "failed",
    },
    {
      key: "hub",
      icon: "fa-building-columns",
      label: "TransChap",
      tone: hubTone,
      tooltip: hubTip,
      link: hubLink,
    },
    {
      key: "merchant",
      icon: "fa-store",
      label: "Merchant",
      tone: merchantTone,
      tooltip: merchantTip,
    },
  ];
}

type RiderFlowOrder = {
  status: string;
  assigned_rider_id?: string | null;
  assigned_rider_name?: string | null;
  rider_trip_phase?: string | null;
  delivery_disputed_at?: string | null;
  delivery_address?: string | null;
};

/** Build Shop → Rider → Customer step states for a delivery row. */
export function buildRiderFlowSteps(order: RiderFlowOrder): MpesaFlowStep[] {
  const status = order.status;
  const phase = (order.rider_trip_phase || "").trim();
  const rider = (order.assigned_rider_name || "").trim() || "Rider";
  const dropoff = (order.delivery_address || "").trim() || "the drop-off";
  const failed = status === "cancelled" || status === "refunded";
  const disputed = Boolean(order.delivery_disputed_at);
  const delivered = status === "delivered" || status === "picked_up" || phase === "completed";
  const atCustomer =
    status === "awaiting_delivery_confirmation" || phase === "at_client";
  const toCustomer =
    status === "out_for_delivery" || phase === "en_route_to_client";
  const atShop = phase === "at_store" || phase === "picking_up";
  const toShop = phase === "en_route_to_store" || Boolean(order.assigned_rider_id && !toCustomer && !atCustomer && !delivered && !atShop);

  let shopTone: FlowTone = "current";
  let shopTip = "Looking for a rider to come to the shop.";
  let shopLink: FlowLink = "progress";
  let riderTone: FlowTone = "idle";
  let riderTip = "Waiting for pickup.";
  let riderLink: FlowLink = "idle";
  let customerTone: FlowTone = "idle";
  let customerTip = `Drop-off: ${dropoff}.`;

  if (delivered) {
    shopTone = "success";
    shopTip = "Picked up from the shop.";
    shopLink = "done";
    riderTone = "success";
    riderTip = `${rider} completed the trip.`;
    riderLink = "done";
    customerTone = disputed ? "failed" : "success";
    customerTip = disputed ? "Delivery was disputed." : "Delivered.";
  } else if (atCustomer) {
    shopTone = "success";
    shopTip = "Picked up from the shop.";
    shopLink = "done";
    riderTone = "success";
    riderTip = `${rider} arrived at drop-off.`;
    riderLink = "progress";
    customerTone = disputed ? "failed" : "current";
    customerTip = disputed
      ? "Delivery was disputed."
      : "Waiting for delivery confirmation.";
  } else if (toCustomer) {
    shopTone = "success";
    shopTip = "Picked up from the shop.";
    shopLink = "done";
    riderTone = "current";
    riderTip = `${rider} is heading to ${dropoff}.`;
    riderLink = "progress";
    customerTone = "idle";
    customerTip = `Drop-off: ${dropoff}.`;
  } else if (atShop) {
    shopTone = "current";
    shopTip = `${rider} is at the shop.`;
    shopLink = "progress";
    riderTone = "idle";
    riderTip = "Next: head to the customer.";
  } else if (toShop) {
    shopTone = "current";
    shopTip = `${rider} is on the way to the shop.`;
    shopLink = "progress";
    riderTone = "idle";
    riderTip = "Waiting for pickup.";
  }

  if (failed) {
    const failTip =
      status === "refunded" ? "This delivery was refunded." : "This delivery was cancelled.";
    if (delivered || atCustomer || toCustomer) {
      riderTone = riderTone === "idle" ? "failed" : riderTone;
      customerTone = "failed";
      customerTip = failTip;
      riderLink = "failed";
    } else {
      shopTone = "failed";
      shopTip = failTip;
      shopLink = "failed";
      riderTone = "idle";
      riderLink = "idle";
    }
  }

  return [
    {
      key: "shop",
      icon: "fa-store",
      label: "Shop",
      tone: shopTone,
      tooltip: shopTip,
      link: shopLink,
    },
    {
      key: "rider",
      icon: "fa-motorcycle",
      label: "Rider",
      tone: riderTone,
      tooltip: riderTip,
      link: riderLink,
    },
    {
      key: "customer",
      icon: "fa-flag-checkered",
      label: "Customer",
      tone: customerTone,
      tooltip: customerTip,
    },
  ];
}
