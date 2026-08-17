type FlowTone = "idle" | "current" | "success" | "failed";
type FlowLink = "idle" | "done" | "progress" | "failed";

export type MpesaFlowStep = {
  key: "client" | "hub" | "merchant";
  icon: string;
  label: string;
  tone: FlowTone;
  tooltip: string;
  /** Connector from this step toward the next (omitted on the last step). */
  link?: FlowLink;
};

type MpesaFlowStatusProps = {
  steps: MpesaFlowStep[];
  className?: string;
  /** Horizontal row of icons (default) or vertical stack. */
  layout?: "row" | "column";
};

function toneClass(tone: FlowTone): string {
  return `mpesa-flow-status__badge mpesa-flow-status__badge--${tone}`;
}

export function MpesaFlowStatus({
  steps,
  className,
  layout = "row",
}: MpesaFlowStatusProps) {
  const rootClass = [
    "mpesa-flow-status",
    layout === "column" ? "mpesa-flow-status--column" : "mpesa-flow-status--row",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ol className={rootClass} aria-label="Payment flow status">
      {steps.map((step) => {
        const stepClass = [
          "mpesa-flow-status__step",
          `mpesa-flow-status__step--${step.key}`,
        ].join(" ");
        const link = step.link;

        return (
          <li key={step.key} className={stepClass}>
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

/** Build Client → DukAI → Merchant step states for a collection/payout row.
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
  let hubTip = "Waiting for funds on the DukAI hub Paybill.";
  let hubLink: FlowLink = "idle";
  if (isAdminPayout) {
    if (payoutDone) {
      hubTone = "success";
      hubTip = "Funds left the DukAI hub Paybill.";
      hubLink = "done";
    } else if (payoutInFlight) {
      hubTone = "success";
      hubTip = "Payout in progress from the DukAI hub.";
      hubLink = "progress";
    } else if (payoutFailed) {
      hubTone = "current";
      hubTip = "Funds remain on the DukAI hub after a payout issue.";
      hubLink = "failed";
    } else {
      hubTone = "current";
      hubTip = "Funds leave the DukAI hub Paybill.";
      hubLink = "idle";
    }
  } else if (txn.status === "pending") {
    hubTone = "idle";
    hubTip = "Hub collection pending client payment.";
    hubLink = "idle";
  } else if (txn.status === "failed" || txn.status === "cancelled") {
    hubTone = "idle";
    hubTip = "Funds did not land on DukAI.";
    hubLink = "idle";
  } else if (received) {
    if (payoutDone) {
      hubTone = "success";
      hubTip = txn.mpesa_receipt_number
        ? `Received at DukAI · receipt ${txn.mpesa_receipt_number}`
        : "Payment received on the DukAI hub.";
      hubLink = "done";
    } else if (payoutInFlight) {
      hubTone = "success";
      hubTip = txn.mpesa_receipt_number
        ? `Sending from DukAI · receipt ${txn.mpesa_receipt_number}`
        : "Sending from DukAI to merchant…";
      hubLink = "progress";
    } else if (payoutFailed) {
      hubTone = "current";
      hubTip = txn.mpesa_receipt_number
        ? `At DukAI · receipt ${txn.mpesa_receipt_number}`
        : "Payment at DukAI after a payout issue.";
      hubLink = "failed";
    } else {
      hubTone = "current";
      hubTip = txn.mpesa_receipt_number
        ? `At DukAI · receipt ${txn.mpesa_receipt_number}`
        : "Payment at DukAI — awaiting merchant payout.";
      hubLink = "idle";
    }
  } else if (txn.status === "success") {
    hubTone = "current";
    hubTip = "Collection marked success — awaiting hub confirmation.";
    hubLink = "idle";
  }

  let merchantTone: FlowTone = "idle";
  let merchantTip = "Waiting for DukAI → merchant payout.";
  if (!received && !isAdminPayout) {
    merchantTone = "idle";
    merchantTip = "Payout unlocks after money is at DukAI.";
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
    },
    {
      key: "hub",
      icon: "fa-building-columns",
      label: "DukAI",
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
