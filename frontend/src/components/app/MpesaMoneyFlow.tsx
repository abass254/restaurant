type MpesaMoneyFlowProps = {
  /** Slightly different copy for merchant vs admin surfaces. */
  audience?: "merchant" | "admin";
  className?: string;
};

const STEPS = {
  merchant: [
    {
      key: "client",
      icon: "fa-user",
      title: "Client",
      detail: "Pays via STK push on their phone",
    },
    {
      key: "hub",
      icon: "fa-building-columns",
      title: "DukAI",
      detail: "Money lands on the hub Paybill first",
    },
    {
      key: "merchant",
      icon: "fa-store",
      title: "Your store",
      detail: "DukAI pays out to your Till, Paybill, or Pochi",
    },
  ],
  admin: [
    {
      key: "client",
      icon: "fa-user",
      title: "Client",
      detail: "STK push into the hub Paybill",
    },
    {
      key: "hub",
      icon: "fa-building-columns",
      title: "DukAI",
      detail: "Collection confirmed on the platform shortcode",
    },
    {
      key: "merchant",
      icon: "fa-store",
      title: "Merchant",
      detail: "B2B payout to their Till, Paybill, or Pochi",
    },
  ],
} as const;

const FORMULA = {
  merchant: ["Client", "DukAI", "Your store"] as const,
  admin: ["Client", "DukAI", "Merchant"] as const,
};

export function MpesaMoneyFlow({ audience = "merchant", className }: MpesaMoneyFlowProps) {
  const steps = STEPS[audience];
  const formula = FORMULA[audience];
  const rootClass = ["mpesa-money-flow", className].filter(Boolean).join(" ");

  return (
    <div className={rootClass} role="group" aria-label="Money flow: Client to DukAI to Merchant">
      <p className="mpesa-money-flow__formula">
        {formula.map((label, index) => (
          <span key={label} className="mpesa-money-flow__formula-part">
            {index > 0 ? (
              <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            ) : null}
            <strong>{label}</strong>
          </span>
        ))}
      </p>
      <p className="mpesa-money-flow__eyebrow">How money moves</p>
      <ol className="mpesa-money-flow__track">
        {steps.map((step) => (
          <li
            key={step.key}
            className={`mpesa-money-flow__step mpesa-money-flow__step--${step.key}`}
          >
            <span className="mpesa-money-flow__badge" aria-hidden="true">
              <i className={`fa-solid ${step.icon}`} />
            </span>
            <div className="mpesa-money-flow__copy">
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
