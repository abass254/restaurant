"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  confirmTypedAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type {
  OperationsResetActionResponse,
  OperationsResetStatusResponse,
} from "@/lib/types";

export function TransChapOperationsResetSettings() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<OperationsResetStatusResponse | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [confirmDeleteInput, setConfirmDeleteInput] = useState("");

  async function loadStatus() {
    try {
      const data = await apiFetch<OperationsResetStatusResponse>(
        apiRoutes.settingsOperationsReset,
      );
      setStatus(data);
    } catch (error) {
      void showError("Could not load reset status", extractErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<OperationsResetStatusResponse>(apiRoutes.settingsOperationsReset)
      .then((data) => {
        if (!cancelled) {
          setStatus(data);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          void showError("Could not load reset status", extractErrorMessage(error));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReset() {
    if (resetting) return;

    let typed = confirmDeleteInput.trim();
    if (typed !== "DELETE") {
      const typedConfirmed = await confirmTypedAction(
        "Type DELETE to confirm",
        'All sales, orders, expenses, purchases, inventory counts, and restaurant menu items & recipes will be erased to zero. An automatic 30-day backup is kept.<br/><br/>To confirm, type <strong style="color: #dc2626;">DELETE</strong> in capital letters below:',
        "DELETE",
        "Reset all operations data & menu to zero",
      );
      if (!typedConfirmed) return;
      typed = "DELETE";
      setConfirmDeleteInput("DELETE");
    } else {
      const confirmed = await confirmAction(
        "Reset all operations data & menu to zero?",
        "All sales, orders, expenses, purchases, and inventory counts will be set to zero, and all restaurant menu items, combos, and recipes will be erased. Non-menu products and catalog items will remain intact. A secure backup will be kept for 30 days so you can reclaim your data anytime.",
        "Reset to Zero",
      );
      if (!confirmed) return;
    }

    setResetting(true);
    try {
      const result = await apiFetch<OperationsResetActionResponse>(
        apiRoutes.settingsOperationsReset,
        {
          method: "POST",
          body: JSON.stringify({ confirm: true, confirm_text: "DELETE" }),
        },
      );
      await toastSuccess(
        `Operations data reset to zero. You have ${result.days_remaining ?? 30} days to reclaim it.`,
      );
      setConfirmDeleteInput("");
      await loadStatus();
    } catch (error) {
      void showError("Reset failed", extractErrorMessage(error));
    } finally {
      setResetting(false);
    }
  }

  async function handleReclaim() {
    if (reclaiming) return;

    const confirmed = await confirmAction(
      "Reclaim previous operations data & menu?",
      "This will restore all your archived sales, orders, expenses, stock movements, inventory quantities, and restaurant menu items & recipes back to your active account.",
      "Reclaim Data",
    );
    if (!confirmed) return;

    setReclaiming(true);
    try {
      await apiFetch<OperationsResetActionResponse>(
        apiRoutes.settingsOperationsResetReclaim,
        {
          method: "POST",
        },
      );
      await toastSuccess("Operations data successfully restored!");
      await loadStatus();
    } catch (error) {
      void showError("Reclaim failed", extractErrorMessage(error));
    } finally {
      setReclaiming(false);
    }
  }

  if (loading) {
    return (
      <div className="ios-settings__group">
        <div className="ios-settings__card ios-settings__card--pad ios-settings__card--center">
          <p className="ios-settings__footer">Loading operations data status…</p>
        </div>
      </div>
    );
  }

  const archive = status?.active_archive;
  const counts = status?.current_counts;

  return (
    <div className="ios-settings-detail">
      {archive ? (
        <section className="ios-settings__group" aria-label="Active backup">
          <h3 className="ios-settings__caption" style={{ color: "#d97706" }}>
            <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: 6 }} aria-hidden />
            Data Reset Active (30-Day Reclaim Window)
          </h3>
          <div
            className="ios-settings__card ios-settings__card--pad"
            style={{
              borderColor: "rgba(217, 119, 6, 0.35)",
              background: "color-mix(in srgb, #d97706 6%, var(--app-surface, #fff))",
            }}
          >
            <div style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start", marginBottom: "0.75rem" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "#d97706",
                  color: "#fff",
                  fontSize: "1.2rem",
                  flexShrink: 0,
                }}
                aria-hidden
              >
                <i className="fa-solid fa-shield-halved" />
              </span>
              <div>
                <strong style={{ display: "block", fontSize: "1.05rem", marginBottom: 2 }}>
                  {archive.days_remaining > 0
                    ? `${archive.days_remaining} day${archive.days_remaining === 1 ? "" : "s"} left to reclaim data`
                    : `${archive.hours_remaining} hour${archive.hours_remaining === 1 ? "" : "s"} left to reclaim data`}
                </strong>
                <p style={{ margin: 0, fontSize: "0.88rem", opacity: 0.85, lineHeight: 1.4 }}>
                  Your account data was reset to zero. Your previous operations records are safely preserved until{" "}
                  <strong>{archive.expires_at ? new Date(archive.expires_at).toLocaleDateString() : "30 days"}</strong>.
                  After 30 days without reclaiming, this backup will be permanently deleted.
                </p>
              </div>
            </div>

            {archive.summary && Object.keys(archive.summary).length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                  gap: "0.5rem",
                  margin: "0.75rem 0",
                  padding: "0.6rem",
                  background: "var(--app-surface-subtle, rgba(0,0,0,0.03))",
                  borderRadius: 8,
                }}
              >
                {archive.summary.orders != null ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{archive.summary.orders}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Orders</div>
                  </div>
                ) : null}
                {archive.summary.expenses != null ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{archive.summary.expenses}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Expenses</div>
                  </div>
                ) : null}
                {archive.summary.purchases != null ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{archive.summary.purchases}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Purchases</div>
                  </div>
                ) : null}
                {archive.summary.stock_movements != null ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{archive.summary.stock_movements}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Movements</div>
                  </div>
                ) : null}
                {archive.summary.deliveries != null && archive.summary.deliveries > 0 ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{archive.summary.deliveries}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Deliveries</div>
                  </div>
                ) : null}
                {archive.summary.bookings != null && archive.summary.bookings > 0 ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{archive.summary.bookings}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Bookings</div>
                  </div>
                ) : null}
                {archive.summary.menu_items_erased != null && archive.summary.menu_items_erased > 0 ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{archive.summary.menu_items_erased}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Menu Items</div>
                  </div>
                ) : null}
                {archive.summary.recipes_erased != null && archive.summary.recipes_erased > 0 ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{archive.summary.recipes_erased}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Recipes</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              className="auth-split__submit"
              style={{
                marginTop: "0.5rem",
                background: "#00a651",
                borderColor: "#00a651",
                color: "#fff",
                fontWeight: 600,
              }}
              disabled={reclaiming}
              onClick={() => void handleReclaim()}
            >
              <i className="fa-solid fa-arrow-rotate-left" style={{ marginRight: 6 }} aria-hidden />
              {reclaiming ? "Reclaiming…" : "Reclaim Data (Restore Previous Records & Menu)"}
            </button>
          </div>
          <p className="ios-settings__footer">
            Reclaiming will restore all archived transactions, expenses, movements, stock counts, and restaurant menu items back to your account.
          </p>
        </section>
      ) : null}

      <section className="ios-settings__group" aria-label="What is reset">
        <h3 className="ios-settings__caption">What gets reset to zero</h3>
        <div className="ios-settings__card ios-settings__card--pad">
          <ul style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.6, fontSize: "0.9rem" }}>
            <li>
              <strong>Restaurant Menu & Recipes:</strong> All dishes, combos, meal recipes, serving units, and modifier groups are erased to zero.
            </li>
            <li>
              <strong>Sales & Orders:</strong> All customer orders, order items, returns, and delivery logs.
            </li>
            <li>
              <strong>Stock & Inventory:</strong> In-stock quantities reset to 0; stock movement logs and stock takes cleared.
            </li>
            <li>
              <strong>Expenses & Purchases:</strong> Recorded shop expenses, purchase orders, and supplier payments.
            </li>
            <li>
              <strong>Kitchen & Sessions:</strong> Kitchen shift sessions, kitchen issue logs, and prepared portions.
            </li>
            <li>
              <strong>Balances & Opening:</strong> Customer & supplier outstanding balances reset to zero; opening cash & stock cleared.
            </li>
          </ul>
        </div>
      </section>

      <section className="ios-settings__group" aria-label="What remains untouched">
        <h3 className="ios-settings__caption">What remains safe (not deleted)</h3>
        <div className="ios-settings__card ios-settings__card--pad">
          <ul style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.6, fontSize: "0.9rem" }}>
            <li>
              <strong>Retail Products & Supplies:</strong> General inventory items, supplies, barcodes, categories, and non-menu products remain in your catalog (stock set to 0).
            </li>
            <li>
              <strong>Account & Team:</strong> Shop profile, business name, owner and staff logins, and permissions.
            </li>
            <li>
              <strong>Payment & Till:</strong> M-PESA Till setup, configurations, and API credentials.
            </li>
            <li>
              <strong>Channels:</strong> Instagram, WhatsApp, and messaging integrations.
            </li>
          </ul>
        </div>
        <p className="ios-settings__footer">
          Your retail product catalog and staff access stay ready so you can immediately begin fresh operations or build a new menu.
        </p>
      </section>

      {counts ? (
        <section className="ios-settings__group" aria-label="Current operational data">
          <h3 className="ios-settings__caption">Current account data to be reset</h3>
          <div className="ios-settings__card">
            {counts.menu_items != null && counts.menu_items > 0 ? (
              <div className="ios-settings__row ios-settings__row--static">
                <span className="ios-settings__label">Menu Dishes & Combos (will be erased)</span>
                <span className="ios-settings__value" style={{ color: "#dc2626", fontWeight: 600 }}>{counts.menu_items}</span>
              </div>
            ) : null}
            {counts.recipes != null && counts.recipes > 0 ? (
              <div className="ios-settings__row ios-settings__row--static">
                <span className="ios-settings__label">Recipe Ingredient Lines (will be erased)</span>
                <span className="ios-settings__value" style={{ color: "#dc2626", fontWeight: 600 }}>{counts.recipes}</span>
              </div>
            ) : null}
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__label">Active Orders</span>
              <span className="ios-settings__value">{counts.orders}</span>
            </div>
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__label">Recorded Expenses</span>
              <span className="ios-settings__value">{counts.expenses}</span>
            </div>
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__label">Purchases</span>
              <span className="ios-settings__value">{counts.purchases}</span>
            </div>
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__label">Stock Movement Logs</span>
              <span className="ios-settings__value">{counts.stock_movements}</span>
            </div>
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__label">Catalog Items (Stock will be set to 0)</span>
              <span className="ios-settings__value">{counts.inventory_items}</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="ios-settings__group" aria-label="Reset action">
        <div className="ios-settings__card ios-settings__card--pad">
          <div style={{ marginBottom: "0.75rem" }}>
            <strong style={{ display: "block", color: "#dc2626", fontSize: "1rem", marginBottom: 3 }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }} aria-hidden />
              Reset All Data to Zero
            </strong>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.8, lineHeight: 1.4 }}>
              Zeroes out all sales, expenses, and inventory counts, and erases restaurant menu dishes & recipes. An automatic snapshot backup is stored for 30 days,
              giving you a 30-day window to reclaim your data at any time.
            </p>
          </div>

          <div style={{ margin: "0.85rem 0" }}>
            <label
              htmlFor="confirm-delete-text"
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                marginBottom: "0.35rem",
              }}
            >
              Type <span style={{ color: "#dc2626", fontWeight: 800, letterSpacing: "0.05em" }}>DELETE</span> (case-sensitive) to enable data reset:
            </label>
            <input
              id="confirm-delete-text"
              type="text"
              value={confirmDeleteInput}
              onChange={(e) => setConfirmDeleteInput(e.target.value)}
              placeholder="Type DELETE"
              autoComplete="off"
              spellCheck={false}
              style={{
                width: "100%",
                padding: "0.75rem 0.9rem",
                borderRadius: 12,
                border:
                  confirmDeleteInput === "DELETE"
                    ? "2px solid #dc2626"
                    : "1px solid var(--app-border, #d1d5db)",
                background: "var(--app-bg, #fff)",
                color: "var(--app-text, inherit)",
                fontSize: "0.95rem",
                fontWeight: confirmDeleteInput === "DELETE" ? 700 : 400,
                letterSpacing: "0.05em",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          <button
            type="button"
            className="auth-split__submit"
            style={{
              background: confirmDeleteInput === "DELETE" ? "#dc2626" : "rgba(220, 38, 38, 0.45)",
              borderColor: confirmDeleteInput === "DELETE" ? "#dc2626" : "rgba(220, 38, 38, 0.2)",
              color: "#fff",
              fontWeight: 600,
              cursor: confirmDeleteInput === "DELETE" ? "pointer" : "not-allowed",
            }}
            disabled={resetting}
            onClick={() => void handleReset()}
          >
            <i className="fa-solid fa-rotate-left" style={{ marginRight: 6 }} aria-hidden />
            {resetting
              ? "Resetting to zero…"
              : confirmDeleteInput === "DELETE"
              ? "Reset all operations data to zero"
              : "Type DELETE to reset data"}
          </button>
        </div>
        <p className="ios-settings__footer">
          Owner authorization required. Only the shop owner can perform or reclaim a data reset.
        </p>
      </section>
    </div>
  );
}
