"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { Skeleton } from "@/components/app/Skeleton";
import type { TigoCall, TigoConfig, TigoConfigResponse, TigoTestResponse } from "@/lib/types";

type OperationId = "token" | "system_status" | "validate_account" | "payment_auth" | "disburse";

type FieldId = "msisdn" | "amount" | "reference" | "firstName" | "lastName" | "email";

type Operation = {
  id: OperationId;
  title: string;
  blurb: string;
  route: string;
  fields: FieldId[];
  /** Moves real money, so ask before firing. */
  destructive?: boolean;
  /** Needs the XML partner gateway rather than Tigo Secure. */
  partnerGateway?: boolean;
};

const OPERATIONS: Operation[] = [
  {
    id: "token",
    title: "Generate access token",
    blurb:
      "POST /v1/oauth/generate/accesstoken. Start here: every other Tigo Secure call needs a fresh token, and Tigo invalidates it once a transaction finishes.",
    route: apiRoutes.adminTigoTestToken,
    fields: [],
  },
  {
    id: "system_status",
    title: "System status",
    blurb:
      "GET /v1/tigo/systemstatus. Heartbeat for the Tigo Secure service — confirms the gateway is reachable and our token is accepted.",
    route: apiRoutes.adminTigoTestSystemStatus,
    fields: [],
  },
  {
    id: "validate_account",
    title: "Validate MFS account",
    blurb:
      "POST /v1/tigo/mfs/validateMFSAccount. Checks whether a number holds a wallet. This is the closest Tigo equivalent of Safaricom's Hakikisha, so it is what we would use to verify a merchant payout destination.",
    route: apiRoutes.adminTigoTestValidateAccount,
    fields: ["msisdn", "firstName", "lastName"],
  },
  {
    id: "payment_auth",
    title: "Authorize payment",
    blurb:
      "POST /v1/tigo/payment-auth/authorize. Returns a redirect URL for the customer's browser rather than pushing a prompt to their handset, so it suits the public pay link and not the POS counter.",
    route: apiRoutes.adminTigoTestPaymentAuth,
    fields: ["msisdn", "amount", "reference", "firstName", "lastName", "email"],
  },
  {
    id: "disburse",
    title: "Disburse to wallet",
    blurb:
      "A2W MFI CashIn, XML over the partner gateway. Pays out from our wallet to a subscriber, authenticated with our own MSISDN and PIN rather than a token.",
    route: apiRoutes.adminTigoTestDisburse,
    fields: ["msisdn", "amount", "reference"],
    destructive: true,
    partnerGateway: true,
  },
];

const FIELD_LABELS: Record<FieldId, string> = {
  msisdn: "Customer number",
  amount: "Amount",
  reference: "Reference",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
};

const FIELD_PLACEHOLDERS: Record<FieldId, string> = {
  msisdn: "255712345678",
  amount: "1000",
  reference: "optional, auto-generated when blank",
  firstName: "optional",
  lastName: "optional",
  email: "optional",
};

type FormState = Record<FieldId, string>;

const EMPTY_FORM: FormState = {
  msisdn: "",
  amount: "",
  reference: "",
  firstName: "",
  lastName: "",
  email: "",
};

function buildBody(op: Operation, form: FormState): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (op.fields.includes("msisdn")) body.msisdn = form.msisdn.trim();
  if (op.fields.includes("amount")) body.amount = Number(form.amount);
  if (op.fields.includes("reference") && form.reference.trim()) {
    body.reference = form.reference.trim();
  }
  if (op.fields.includes("firstName") && form.firstName.trim()) {
    body.first_name = form.firstName.trim();
  }
  if (op.fields.includes("lastName") && form.lastName.trim()) {
    body.last_name = form.lastName.trim();
  }
  if (op.fields.includes("email") && form.email.trim()) {
    body.email = form.email.trim();
  }
  return body;
}

function pretty(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function CallCard({ call }: { call: TigoCall }) {
  return (
    <article className={`admin-tigo-call${call.ok ? " is-ok" : " is-error"}`}>
      <header className="admin-tigo-call__head">
        <span className="admin-tigo-call__verb">{call.method}</span>
        <code className="admin-tigo-call__url">{call.url}</code>
        <span className="admin-tigo-call__meta">
          {call.status_code ?? "no response"} · {call.duration_ms} ms
        </span>
      </header>
      {call.error ? <p className="admin-tigo-call__error">{call.error}</p> : null}
      <div className="admin-tigo-call__bodies">
        <div>
          <p className="admin-field-label">Request</p>
          <pre className="admin-code-block">{pretty(call.request_body)}</pre>
        </div>
        <div>
          <p className="admin-field-label">Response</p>
          <pre className="admin-code-block">{pretty(call.response_body)}</pre>
        </div>
      </div>
    </article>
  );
}

export default function AdminTigoPage() {
  const [config, setConfig] = useState<TigoConfig | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<Record<OperationId, FormState>>({
    token: { ...EMPTY_FORM },
    system_status: { ...EMPTY_FORM },
    validate_account: { ...EMPTY_FORM },
    payment_auth: { ...EMPTY_FORM },
    disburse: { ...EMPTY_FORM },
  });
  const [runningId, setRunningId] = useState<OperationId | null>(null);
  const [calls, setCalls] = useState<TigoCall[]>([]);
  const [lastOperation, setLastOperation] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<TigoConfigResponse>(apiRoutes.adminTigoConfig);
      setConfig(res.config);
      setConfigMessage(res.message ?? null);
    } catch (err) {
      await showError(
        "Could not load Tigo config",
        err instanceof ApiError ? err.message : extractErrorMessage(err),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  function setField(op: OperationId, field: FieldId, value: string) {
    setForms((prev) => ({ ...prev, [op]: { ...prev[op], [field]: value } }));
  }

  async function run(op: Operation) {
    if (op.destructive) {
      const ok = await confirmAction(
        "Send real money?",
        "This disburses from the DukAI Tigo wallet to the number below. It cannot be reversed.",
        "Disburse",
      );
      if (!ok) return;
    }

    setRunningId(op.id);
    try {
      const res = await apiFetch<TigoTestResponse>(op.route, {
        method: "POST",
        body: JSON.stringify(buildBody(op, forms[op.id])),
      });
      setCalls(res.calls);
      setLastOperation(op.title);
      if (res.ok) {
        await toastSuccess(res.message);
      } else {
        await showError(`${op.title} failed`, res.message);
      }
    } catch (err) {
      setCalls([]);
      setLastOperation(op.title);
      await showError(
        `Could not run ${op.title.toLowerCase()}`,
        err instanceof ApiError ? err.message : extractErrorMessage(err),
      );
    } finally {
      setRunningId(null);
    }
  }

  const secureReady = config?.secure_configured ?? false;
  const partnerReady = config?.partner_configured ?? false;

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">Tigo Pesa</h1>
          <p className="admin-page__lead">
            Direct API console for Tigo Pesa / Mixx by Yas in Tanzania. Every call runs against the
            live gateway with the credentials in <code>.env</code> and shows the exact request and
            response. Merchant surfaces cannot reach Tigo yet — it stays behind the rollout gate
            until this loop is proven.
          </p>
        </div>
        <div className="admin-page__header-meta">
          <span className="admin-chip">{config?.environment ?? "…"}</span>
          <span className="admin-chip">{config?.currency ?? "TZS"}</span>
          <span className="admin-chip">
            {secureReady ? "Secure ready" : "Secure not configured"}
          </span>
          <span className="admin-chip">
            {partnerReady ? "Partner ready" : "Partner not configured"}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => void loadConfig()}
          >
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
            Refresh
          </button>
          <Link href="/admin/mpesa" className="admin-btn admin-btn--ghost">
            M-PESA console
          </Link>
        </div>
      </header>

      {configMessage ? <p className="admin-tigo-notice">{configMessage}</p> : null}

      <section className="admin-section">
        <div className="admin-section__head">
          <h2 className="admin-section__title">Gateway configuration</h2>
        </div>
        {loading ? (
          <Skeleton variant="text" height={96} />
        ) : config ? (
          <div className="admin-kv">
            <div>
              <p className="admin-field-label">Tigo Secure base URL</p>
              <code>{config.base_url || "—"}</code>
            </div>
            <div>
              <p className="admin-field-label">Partner gateway</p>
              <code>{config.partner_base_url || "not set"}</code>
            </div>
            <div>
              <p className="admin-field-label">Client ID</p>
              <code>{config.client_id_masked || "not set"}</code>
            </div>
            <div>
              <p className="admin-field-label">Client secret</p>
              <code>{config.client_secret_masked || "not set"}</code>
            </div>
            <div>
              <p className="admin-field-label">Wallet MSISDN</p>
              <code>{config.account_msisdn || "not set"}</code>
            </div>
            <div>
              <p className="admin-field-label">Wallet PIN</p>
              <code>{config.account_pin_masked || "not set"}</code>
            </div>
            <div>
              <p className="admin-field-label">Biller code</p>
              <code>{config.biller_code || "not set"}</code>
            </div>
            <div>
              <p className="admin-field-label">Callback URL</p>
              <code>{config.callback_url}</code>
            </div>
            <div>
              <p className="admin-field-label">Redirect URL</p>
              <code>{config.redirect_url}</code>
            </div>
            <div>
              <p className="admin-field-label">Merchant rollout</p>
              <code>
                {config.rollout_enabled
                  ? `${config.allowlisted_accounts} account(s) allowlisted`
                  : "gated off"}
              </code>
            </div>
          </div>
        ) : (
          <p className="admin-table__empty">Config unavailable.</p>
        )}
        <p className="admin-page__footnote">
          Credentials live in <code>.env</code> and are not editable here. Tigo has no public
          developer portal — request access through Mixx corporate onboarding.
        </p>
      </section>

      <section className="admin-section">
        <div className="admin-section__head">
          <h2 className="admin-section__title">API tests</h2>
        </div>
        <div className="admin-tigo-ops">
          {OPERATIONS.map((op) => {
            const disabled =
              runningId !== null ||
              (op.partnerGateway ? !partnerReady : !secureReady);
            return (
              <article key={op.id} className="admin-tigo-op">
                <h3 className="admin-tigo-op__title">
                  {op.title}
                  {op.destructive ? (
                    <span className="admin-tigo-op__flag">moves money</span>
                  ) : null}
                </h3>
                <p className="admin-tigo-op__blurb">{op.blurb}</p>
                {op.fields.length ? (
                  <div className="admin-tigo-op__fields">
                    {op.fields.map((fieldId) => (
                      <label key={fieldId} className="admin-tigo-op__field">
                        <span className="admin-field-label">{FIELD_LABELS[fieldId]}</span>
                        <input
                          className="admin-input"
                          type={fieldId === "amount" ? "number" : "text"}
                          inputMode={fieldId === "amount" ? "numeric" : undefined}
                          placeholder={FIELD_PLACEHOLDERS[fieldId]}
                          value={forms[op.id][fieldId]}
                          onChange={(event) => setField(op.id, fieldId, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`admin-btn ${op.destructive ? "admin-btn--danger" : "admin-btn--primary"}`}
                  onClick={() => void run(op)}
                  disabled={disabled}
                >
                  {runningId === op.id ? "Running…" : "Run"}
                </button>
                {op.partnerGateway && !partnerReady ? (
                  <p className="admin-tigo-op__hint">
                    Needs <code>TIGO_PARTNER_BASE_URL</code>, <code>TIGO_ACCOUNT_MSISDN</code> and{" "}
                    <code>TIGO_ACCOUNT_PIN</code>.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section__head">
          <h2 className="admin-section__title">
            {lastOperation ? `Result: ${lastOperation}` : "Result"}
          </h2>
        </div>
        {calls.length ? (
          <div className="admin-tigo-results">
            {calls.map((call, index) => (
              <CallCard key={`${call.operation}-${index}`} call={call} />
            ))}
          </div>
        ) : (
          <p className="admin-table__empty">
            Run a test above and the full request and response will appear here.
          </p>
        )}
      </section>
    </section>
  );
}
