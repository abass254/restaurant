"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { TransChapCameraSettings } from "@/components/trans-chap/TransChapCameraSettings";
import { TransChapInstallPanel } from "@/components/trans-chap/TransChapInstallPanel";
import { TransChapMenuSectionsSettings } from "@/components/trans-chap/TransChapMenuSectionsSettings";
import { TransChapMpesaSettings } from "@/components/trans-chap/TransChapMpesaSettings";
import { TransChapTeamSettings } from "@/components/trans-chap/TransChapTeamSettings";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  showInternalError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes, instagramAuthPath, resolveSameOriginUrl } from "@/lib/config";
import { isShopOwner } from "@/lib/merchant-permissions";
import { isRestaurantStore } from "@/lib/onboarding";
import { formatMoney } from "@/lib/orders";
import { disableKitchenIssuing } from "@/lib/restaurant-supplies";
import {
  isCameraScanningEnabled,
  queryCameraPermission,
} from "@/lib/trans-chap-camera";
import type {
  MerchantMpesaConfigResponse,
  SettingsOperationsResponse,
  SettingsResponse,
} from "@/lib/types";

const SIGN_IN_PATH = "/trans-chap/sign-in";

type SettingsPane =
  | "list"
  | "mpesa"
  | "opening-amount"
  | "opening-investment"
  | "opening-stock"
  | "download"
  | "camera"
  | "menu-sections"
  | "team";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "T";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export default function TransChapSettingsPage() {
  const user = useAuthUser();
  const [pane, setPane] = useState<SettingsPane>("list");
  const [loggingOut, setLoggingOut] = useState(false);
  const [mpesaReady, setMpesaReady] = useState<boolean | null>(null);
  const [openingAmount, setOpeningAmount] = useState<string | null>(null);
  const [canSetOpeningAmount, setCanSetOpeningAmount] = useState(false);
  const [openingAmountInput, setOpeningAmountInput] = useState("");
  const [openingAmountSaving, setOpeningAmountSaving] = useState(false);
  const [openingAmountError, setOpeningAmountError] = useState<string | null>(null);

  const [openingStock, setOpeningStock] = useState<string | null>(null);
  const [canSetOpeningStock, setCanSetOpeningStock] = useState(false);
  const [openingStockInput, setOpeningStockInput] = useState("");
  const [openingStockSaving, setOpeningStockSaving] = useState(false);
  const [openingStockError, setOpeningStockError] = useState<string | null>(null);

  const [openingInvestment, setOpeningInvestment] = useState<string | null>(null);
  const [canSetOpeningInvestment, setCanSetOpeningInvestment] = useState(false);
  const [openingInvestmentInput, setOpeningInvestmentInput] = useState("");
  const [openingInvestmentSaving, setOpeningInvestmentSaving] = useState(false);
  const [openingInvestmentError, setOpeningInvestmentError] = useState<string | null>(null);

  const [cameraReady, setCameraReady] = useState<boolean | null>(null);
  const [hasInstagram, setHasInstagram] = useState(Boolean(user.instagram_account));
  const [canManageInstagram, setCanManageInstagram] = useState(isShopOwner(user));
  const [canManageTeam, setCanManageTeam] = useState(isShopOwner(user));
  const owner = canManageTeam;
  const [autoRepliesEnabled, setAutoRepliesEnabled] = useState(
    Boolean(user.instagram_account?.auto_replies_enabled),
  );
  const [autoRepliesSaving, setAutoRepliesSaving] = useState(false);
  const [adjustSellingPrice, setAdjustSellingPrice] = useState(true);
  const [allowQuantityAdjustment, setAllowQuantityAdjustment] = useState(true);
  const [allowPriceAdjustment, setAllowPriceAdjustment] = useState(false);
  const [forceMpesaPrompt, setForceMpesaPrompt] = useState(true);
  const [blockLowIngredients, setBlockLowIngredients] = useState(false);
  const [kitchenIssuing, setKitchenIssuing] = useState(false);
  const [operationsSaving, setOperationsSaving] = useState(false);
  const [settingsQuery, setSettingsQuery] = useState("");

  const restaurant = isRestaurantStore(user.active_account ?? user.account);
  const router = useRouter();
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "Trans Chap";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("pane");
    if (next === "camera") {
      setPane("camera");
    } else if (next === "menu-sections" && restaurant) {
      setPane("menu-sections");
    } else if (next === "team" && owner) {
      setPane("team");
    }
  }, [owner, restaurant]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((data) => {
        if (!cancelled) setMpesaReady(Boolean(data.config));
      })
      .catch(() => {
        if (!cancelled) setMpesaReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pane]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const enabled = isCameraScanningEnabled();
      const permission = await queryCameraPermission();
      if (cancelled) return;
      setCameraReady(enabled && permission === "granted");
    })();
    return () => {
      cancelled = true;
    };
  }, [pane]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") !== "1") return;
    void toastSuccess("Instagram connected");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<SettingsResponse>(apiRoutes.settings)
      .then((data) => {
        if (cancelled) return;
        setCanManageInstagram(data.can_manage_instagram);
        setOpeningAmount(data.opening_amount);
        setCanSetOpeningAmount(data.can_set_opening_amount);
        setOpeningStock(data.opening_stock);
        setCanSetOpeningStock(data.can_set_opening_stock);
        setOpeningInvestment(data.opening_investment);
        setCanSetOpeningInvestment(data.can_set_opening_investment);
        if (data.can_set_opening_stock && !openingStockInput) {
          setOpeningStockInput(data.opening_stock || data.suggested_opening_stock || "0.00");
        }
        if (data.can_set_opening_amount && !openingAmountInput) {
          setOpeningAmountInput(data.opening_amount || "");
        }
        if (data.can_set_opening_investment && !openingInvestmentInput) {
          setOpeningInvestmentInput(data.opening_investment || "");
        }
        setAllowQuantityAdjustment(data.allow_item_quantity_adjustment ?? true);
        setAllowPriceAdjustment(data.allow_price_adjustment ?? false);
        setAdjustSellingPrice(data.adjust_selling_price_on_purchase ?? true);
        setForceMpesaPrompt(data.force_mpesa_prompt ?? true);
        setBlockLowIngredients(data.block_sale_on_low_ingredients ?? false);
        setKitchenIssuing(data.kitchen_issuing_enabled ?? false);
        const ig = data.user.instagram_account;
        setHasInstagram(Boolean(ig));
        if (typeof ig?.auto_replies_enabled === "boolean") {
          setAutoRepliesEnabled(ig.auto_replies_enabled);
        }
      })
      .catch(() => {
        /* keep defaults from auth user */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(apiRoutes.staff)
      .then(() => {
        if (!cancelled) setCanManageTeam(true);
      })
      .catch(() => {
        if (!cancelled) setCanManageTeam(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateOperations(
    updates: Partial<SettingsOperationsResponse>,
    successMessage: string,
  ) {
    if (!owner || operationsSaving) return;
    setOperationsSaving(true);
    try {
      const data = await apiFetch<SettingsOperationsResponse>(
        apiRoutes.settingsOperations,
        {
          method: "PATCH",
          body: JSON.stringify(updates),
        },
      );
      setAllowQuantityAdjustment(data.allow_item_quantity_adjustment);
      setAllowPriceAdjustment(data.allow_price_adjustment);
      setAdjustSellingPrice(data.adjust_selling_price_on_purchase);
      setBlockLowIngredients(data.block_sale_on_low_ingredients ?? false);
      setKitchenIssuing(data.kitchen_issuing_enabled ?? false);
      await toastSuccess(successMessage);
    } catch {
      await showInternalError();
    } finally {
      setOperationsSaving(false);
    }
  }

  async function handleQuantityAdjustmentToggle(enabled: boolean) {
    if (!enabled) {
      const confirmed = await confirmAction(
        "Turn off quantity adjustment?",
        "Inventory quantities will become read-only. Purchases can still increase stock.",
        "Turn off",
      );
      if (!confirmed) return;
    }
    await updateOperations(
      { allow_item_quantity_adjustment: enabled },
      enabled ? "Quantity adjustment enabled" : "Quantity adjustment disabled",
    );
  }

  async function handleAdjustSellingPriceToggle(enabled: boolean) {
    await updateOperations(
      { adjust_selling_price_on_purchase: enabled },
      enabled
        ? "Selling price shown on purchases"
        : "Selling price hidden on purchases",
    );
  }

  async function handleAllowPriceAdjustmentToggle(enabled: boolean) {
    await updateOperations(
      { allow_price_adjustment: enabled },
      enabled
        ? "Sale price update allowed at POS"
        : "Sale price update disabled at POS",
    );
  }

  async function handleBlockLowIngredientsToggle(enabled: boolean) {
    await updateOperations(
      { block_sale_on_low_ingredients: enabled },
      enabled ? "Sales blocked when ingredients run out" : "Sales allowed when ingredients run low",
    );
  }

  async function handleKitchenIssuingToggle(enabled: boolean) {
    if (enabled) {
      router.push("/trans-chap/purchases?tab=kitchen");
      return;
    }
    const confirmed = await confirmAction(
      "Turn off store and kitchen?",
      "Everything left in the kitchen moves back to the store and pending kitchen requests are cancelled.",
      "Turn off",
    );
    if (!confirmed || operationsSaving) return;
    setOperationsSaving(true);
    try {
      await disableKitchenIssuing();
      setKitchenIssuing(false);
      await toastSuccess("Store and kitchen turned off");
    } catch (err) {
      await showError("Could not turn off", extractErrorMessage(err));
    } finally {
      setOperationsSaving(false);
    }
  }

  function groupMatches(...keywords: string[]) {
    const needle = settingsQuery.trim().toLowerCase();
    return !needle || keywords.some((keyword) => keyword.includes(needle));
  }

  async function handleAutoRepliesToggle(enabled: boolean) {
    if (autoRepliesSaving || !canManageInstagram) return;
    setAutoRepliesSaving(true);
    try {
      const data = await apiFetch<{ auto_replies_enabled: boolean }>(
        apiRoutes.autoRepliesSettings,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      );
      setAutoRepliesEnabled(data.auto_replies_enabled);
      await toastSuccess(enabled ? "AI auto-reply enabled" : "AI auto-reply disabled");
    } catch {
      await showInternalError();
    } finally {
      setAutoRepliesSaving(false);
    }
  }
  async function handleForceMpesaToggle(enabled: boolean) {
    if (!enabled) {
      const confirmed = await confirmAction(
        "Turn off M-PESA prompts?",
        "When making a sale with M-PESA, cashiers will enter the code manually instead of pushing a prompt to the customer's phone.",
        "Turn off",
      );
      if (!confirmed) return;
    }
    await updateOperations(
      { force_mpesa_prompt: enabled },
      enabled ? "M-PESA prompts enabled" : "M-PESA prompts disabled",
    );
    // Optimistically update
    setForceMpesaPrompt(enabled);
  }

  async function saveOpeningAmount() {
    if (openingAmountSaving || !canSetOpeningAmount) return;
    const value = openingAmountInput.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 99_999_999.99) {
      setOpeningAmountError("Enter a valid amount with no more than 2 decimal places.");
      return;
    }

    setOpeningAmountSaving(true);
    setOpeningAmountError(null);
    try {
      const data = await apiFetch<{
        opening_amount: string;
        can_set_opening_amount: boolean;
      }>(apiRoutes.settingsOpeningAmount, {
        method: "PUT",
        body: JSON.stringify({ opening_amount: value }),
      });
      setOpeningAmount(data.opening_amount);
      setCanSetOpeningAmount(data.can_set_opening_amount);
      setPane("list");
      await toastSuccess("Opening amount saved");
    } catch {
      await showInternalError();
    } finally {
      setOpeningAmountSaving(false);
    }
  }

  async function saveOpeningInvestment() {
    if (openingInvestmentSaving || !canSetOpeningInvestment) return;
    const value = openingInvestmentInput.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 99_999_999.99) {
      setOpeningInvestmentError("Enter a valid amount with no more than 2 decimal places.");
      return;
    }

    setOpeningInvestmentSaving(true);
    setOpeningInvestmentError(null);
    try {
      const data = await apiFetch<{
        opening_investment: string;
        can_set_opening_investment: boolean;
      }>(apiRoutes.settings + "/opening-investment", {
        method: "PUT",
        body: JSON.stringify({ opening_investment: value }),
      });
      setOpeningInvestment(data.opening_investment);
      setCanSetOpeningInvestment(data.can_set_opening_investment);
      setPane("list");
      await toastSuccess("Opening investment saved");
    } catch {
      await showInternalError();
    } finally {
      setOpeningInvestmentSaving(false);
    }
  }

  async function saveOpeningStock() {
    if (openingStockSaving || !canSetOpeningStock) return;
    const value = openingStockInput.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 99_999_999.99) {
      setOpeningStockError("Enter a valid amount with no more than 2 decimal places.");
      return;
    }

    setOpeningStockSaving(true);
    setOpeningStockError(null);

    try {
      const data = await apiFetch<{
        opening_stock: string;
        can_set_opening_stock: boolean;
      }>(apiRoutes.settingsOpeningStock, {
        method: "PUT",
        body: JSON.stringify({ opening_stock: value }),
      });
      setOpeningStock(data.opening_stock);
      setCanSetOpeningStock(data.can_set_opening_stock);
      setPane("list");
      await toastSuccess("Opening stock saved");
    } catch {
      await showInternalError();
    } finally {
      setOpeningStockSaving(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiFetch(apiRoutes.logout, { method: "POST" });
    } catch {
      /* still leave */
    }
    window.location.assign(SIGN_IN_PATH);
  }

  function backToList() {
    setPane("list");
    const url = new URL(window.location.href);
    url.searchParams.delete("pane");
    window.history.replaceState({}, "", url.pathname + url.search);
  }

  if (pane === "mpesa") {
    return (
      <div className="ios-settings">
        <button type="button" className="ios-settings__back" onClick={backToList}>
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">M-PESA</h2>
        <TransChapMpesaSettings />
      </div>
    );
  }

  if (pane === "opening-amount" && canSetOpeningAmount) {
    return (
      <div className="ios-settings">
        <button type="button" className="ios-settings__back" onClick={backToList}>
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">Opening Amount</h2>
        <section className="ios-settings__group" aria-label="Set opening amount">
          <div className="ios-settings__card ios-settings__card--pad">
            <label htmlFor="opening-amount" className="auth-split__label">
              Cash in your till/bank when starting Trans Chap
            </label>
            <input
              id="opening-amount"
              type="text"
              inputMode="decimal"
              className="auth-split__input"
              placeholder="0.00"
              autoFocus
              value={openingAmountInput}
              disabled={openingAmountSaving}
              aria-invalid={Boolean(openingAmountError)}
              onChange={(event) => {
                setOpeningAmountInput(event.target.value);
                setOpeningAmountError(null);
              }}
            />
            {openingAmountError ? (
              <p className="app-form-error" role="alert">{openingAmountError}</p>
            ) : null}
            <button
              type="button"
              className="auth-split__submit"
              disabled={openingAmountSaving}
              onClick={() => void saveOpeningAmount()}
            >
              {openingAmountSaving ? "Saving…" : "Save Opening Amount"}
            </button>
          </div>
          <p className="ios-settings__footer">
            This is starting cash, not sales income.
          </p>
        </section>
      </div>
    );
  }

  if (pane === "opening-investment" && canSetOpeningInvestment) {
    return (
      <div className="ios-settings">
        <button type="button" className="ios-settings__back" onClick={backToList}>
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">Opening Investment</h2>
        <section className="ios-settings__group" aria-label="Set opening investment">
          <div className="ios-settings__card ios-settings__card--pad">
            <label htmlFor="opening-investment" className="auth-split__label">
              Initial capital injected into the business
            </label>
            <input
              id="opening-investment"
              type="text"
              inputMode="decimal"
              className="auth-split__input"
              placeholder="0.00"
              autoFocus
              value={openingInvestmentInput}
              disabled={openingInvestmentSaving}
              aria-invalid={Boolean(openingInvestmentError)}
              onChange={(event) => {
                setOpeningInvestmentInput(event.target.value);
                setOpeningInvestmentError(null);
              }}
            />
            {openingInvestmentError ? (
              <p className="app-form-error" role="alert">{openingInvestmentError}</p>
            ) : null}
            <button
              type="button"
              className="auth-split__submit"
              disabled={openingInvestmentSaving}
              onClick={() => void saveOpeningInvestment()}
            >
              {openingInvestmentSaving ? "Saving…" : "Save Opening Investment"}
            </button>
          </div>
          <p className="ios-settings__footer">
            The very first amount of capital before making any purchases (Optional).
          </p>
        </section>
      </div>
    );
  }

  if (pane === "opening-stock") {
    return (
      <div className="ios-settings">
        <button type="button" className="ios-settings__back" onClick={backToList}>
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">Opening Stock</h2>
        <section className="ios-settings__group" aria-label="Set opening stock">
          <div className="ios-settings__card ios-settings__card--pad">
            <label htmlFor="opening-stock" className="auth-split__label">
              Value of physical inventory on Day 1
            </label>
            <input
              id="opening-stock"
              type="text"
              inputMode="decimal"
              className="auth-split__input"
              placeholder="0.00"
              autoFocus
              value={openingStockInput}
              disabled={openingStockSaving}
              aria-invalid={Boolean(openingStockError)}
              onChange={(event) => {
                setOpeningStockInput(event.target.value);
                setOpeningStockError(null);
              }}
            />
            {openingStockError ? (
              <p className="app-form-error" role="alert">{openingStockError}</p>
            ) : null}
            <button
              type="button"
              className="auth-split__submit"
              disabled={openingStockSaving}
              onClick={() => void saveOpeningStock()}
            >
              {openingStockSaving ? "Saving…" : "Save Opening Stock"}
            </button>
          </div>
          <p className="ios-settings__footer">
            We have pre-filled this with the total value of all items currently in your inventory. You can edit it if needed. Confirm it carefully because it can only be set once.
          </p>
        </section>
      </div>
    );
  }

  if (pane === "camera") {
    return (
      <div className="ios-settings">
        <button type="button" className="ios-settings__back" onClick={backToList}>
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">Camera</h2>
        <TransChapCameraSettings />
      </div>
    );
  }

  if (pane === "menu-sections" && restaurant) {
    return (
      <div className="ios-settings">
        <button type="button" className="ios-settings__back" onClick={backToList}>
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">Menu sections</h2>
        <TransChapMenuSectionsSettings />
      </div>
    );
  }

  if (pane === "download") {
    return (
      <div className="ios-settings">
        <button type="button" className="ios-settings__back" onClick={backToList}>
          <i className="fa-solid fa-chevron-left" aria-hidden />
          Settings
        </button>
        <h2 className="ios-settings__screen-title">Add to Home Screen</h2>
        <TransChapInstallPanel showOpenLink={false} />
      </div>
    );
  }

  if (pane === "team" && owner) {
    return <TransChapTeamSettings onClose={backToList} />;
  }

  return (
    <div className="ios-settings">
      <section className="ios-settings__profile" aria-label="Account">
        <span className="ios-settings__avatar" aria-hidden>
          {initials(user.name || shopName)}
        </span>
        <div className="ios-settings__profile-copy">
          <strong>{user.name || "Merchant"}</strong>
          <span>{shopName}</span>
        </div>
      </section>

      <label className="ios-settings__search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden />
        <input
          type="search"
          value={settingsQuery}
          placeholder="Search settings…"
          aria-label="Search settings"
          onChange={(event) => setSettingsQuery(event.target.value)}
        />
      </label>

      {groupMatches("getting started opening investment cash till setup payments mpesa mobile money") ? (
      <section className="ios-settings__group" aria-label="Getting started">
        <h3 className="ios-settings__caption">Getting Started</h3>
        <div className="ios-settings__card">
          {canSetOpeningAmount ? (
            <button
              type="button"
              className="ios-settings__row"
              onClick={() => setPane("opening-amount")}
            >
              <span className="ios-settings__icon ios-settings__icon--cash" aria-hidden>
                <i className="fa-solid fa-wallet" />
              </span>
              <span className="ios-settings__label">Opening amount</span>
              <span className="ios-settings__value">
                {openingAmount == null ? "Not Set" : formatMoney(Number(openingAmount))}
              </span>
              <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
            </button>
          ) : (
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__icon ios-settings__icon--cash" aria-hidden>
                <i className="fa-solid fa-wallet" />
              </span>
              <span className="ios-settings__label">Opening amount</span>
              <span className="ios-settings__value">
                {openingAmount == null ? "Owner only" : formatMoney(Number(openingAmount))}
              </span>
            </div>
          )}
          {canSetOpeningInvestment ? (
            <button
              type="button"
              className="ios-settings__row"
              onClick={() => setPane("opening-investment")}
            >
              <span className="ios-settings__icon ios-settings__icon--cash" aria-hidden>
                <i className="fa-solid fa-sack-dollar" />
              </span>
              <span className="ios-settings__label">Opening investment</span>
              <span className="ios-settings__value">
                {openingInvestment == null ? "Not Set" : formatMoney(Number(openingInvestment))}
              </span>
              <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
            </button>
          ) : (
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__icon ios-settings__icon--cash" aria-hidden>
                <i className="fa-solid fa-sack-dollar" />
              </span>
              <span className="ios-settings__label">Opening investment</span>
              <span className="ios-settings__value">
                {openingInvestment == null ? "Owner only" : formatMoney(Number(openingInvestment))}
              </span>
            </div>
          )}
          {canSetOpeningStock ? (
            <button
              type="button"
              className="ios-settings__row"
              onClick={() => setPane("opening-stock")}
            >
              <span className="ios-settings__icon ios-settings__icon--cash" aria-hidden>
                <i className="fa-solid fa-boxes-stacked" />
              </span>
              <span className="ios-settings__label">Opening stock</span>
              <span className="ios-settings__value">
                {openingStock == null ? "Not Set" : formatMoney(Number(openingStock))}
              </span>
              <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
            </button>
          ) : (
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__icon ios-settings__icon--cash" aria-hidden>
                <i className="fa-solid fa-boxes-stacked" />
              </span>
              <span className="ios-settings__label">Opening stock</span>
              <span className="ios-settings__value">
                {openingStock == null ? "Owner only" : formatMoney(Number(openingStock))}
              </span>
            </div>
          )}
          <button
            type="button"
            className="ios-settings__row"
            onClick={() => setPane("mpesa")}
          >
            <span className="ios-settings__icon ios-settings__icon--mpesa" aria-hidden>
              <i className="fa-solid fa-mobile-screen" />
            </span>
            <span className="ios-settings__label">M-PESA Till Settings</span>
            <span className="ios-settings__value">
              {mpesaReady == null ? "" : mpesaReady ? "Set" : "Not Set"}
            </span>
            <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
          </button>
          <div className="ios-settings__row ios-settings__row--static">
            <span className="ios-settings__icon ios-settings__icon--mpesa" aria-hidden>
              <i className="fa-solid fa-bell" />
            </span>
            <span className="ios-settings__label">Force STK Prompts</span>
            <span className="ios-settings__value">
              {owner ? (
                <button
                  type="button"
                  role="switch"
                  className={`theme-switch${forceMpesaPrompt ? " is-on" : ""}`}
                  aria-checked={forceMpesaPrompt}
                  aria-label="Force M-PESA STK Prompts"
                  disabled={operationsSaving}
                  onClick={() => void handleForceMpesaToggle(!forceMpesaPrompt)}
                >
                  <span className="theme-switch__thumb" aria-hidden />
                </button>
              ) : (
                <span className="ios-settings__value">Owner only</span>
              )}
            </span>
          </div>
        </div>
        <p className="ios-settings__footer">
          Configure till numbers and choose whether to send push prompts to customer phones.
        </p>
      </section>
      ) : null}


      {groupMatches("messaging instagram chats feeds ai auto reply dm") ? (
      <section className="ios-settings__group" aria-label="Messaging">
        <h3 className="ios-settings__caption">Messaging</h3>
        <div className="ios-settings__card">
          {!hasInstagram ? (
            canManageInstagram ? (
              <a
                href={resolveSameOriginUrl(
                  `${instagramAuthPath}?next=${encodeURIComponent("/trans-chap/settings")}`,
                )}
                className="ios-settings__row"
              >
                <span className="ios-settings__icon ios-settings__icon--ai" aria-hidden>
                  <i className="fa-brands fa-instagram" />
                </span>
                <span className="ios-settings__label">Connect Instagram</span>
                <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
              </a>
            ) : (
              <div className="ios-settings__row ios-settings__row--static is-disabled">
                <span className="ios-settings__icon ios-settings__icon--ai" aria-hidden>
                  <i className="fa-brands fa-instagram" />
                </span>
                <span className="ios-settings__label">Instagram</span>
                <span className="ios-settings__value">Admin only</span>
              </div>
            )
          ) : (
            <div
              className={`ios-settings__row ios-settings__row--static${
                !canManageInstagram ? " is-disabled" : ""
              }`}
            >
              <span className="ios-settings__icon ios-settings__icon--ai" aria-hidden>
                <i className="fa-solid fa-robot" />
              </span>
              <span className="ios-settings__label">AI Auto-Reply</span>
              <span className="ios-settings__trailing">
                {canManageInstagram ? (
                  <button
                    type="button"
                    role="switch"
                    className={`theme-switch${autoRepliesEnabled ? " is-on" : ""}`}
                    aria-checked={autoRepliesEnabled}
                    aria-label="AI auto-reply"
                    disabled={autoRepliesSaving}
                    onClick={() => void handleAutoRepliesToggle(!autoRepliesEnabled)}
                  >
                    <span className="theme-switch__thumb" aria-hidden />
                  </button>
                ) : (
                  <span className="ios-settings__value">Admin only</span>
                )}
              </span>
            </div>
          )}
        </div>
        <p className="ios-settings__footer">
          {!hasInstagram
            ? canManageInstagram
              ? "Connect Instagram to enable chats, feeds, and AI auto-reply."
              : "Ask a shop admin to connect Instagram for chats and feeds."
            : autoRepliesEnabled
              ? "DukAI replies to matching customer DMs automatically."
              : "Automatic replies are off. Customers won’t get AI responses."}
        </p>
      </section>
      ) : null}

      {groupMatches("inventory stock item quantity adjustment purchases") ? (
      <section className="ios-settings__group" aria-label="Inventory">
        <h3 className="ios-settings__caption">Inventory</h3>
        <div className="ios-settings__card">
          <div className="ios-settings__row ios-settings__row--static">
            <span className="ios-settings__icon ios-settings__icon--inventory" aria-hidden>
              <i className="fa-solid fa-boxes-stacked" />
            </span>
            <span className="ios-settings__label">Allow item quantity adjustment</span>
            <span className="ios-settings__trailing">
              {owner ? (
                <button
                  type="button"
                  role="switch"
                  className={`theme-switch${allowQuantityAdjustment ? " is-on" : ""}`}
                  aria-checked={allowQuantityAdjustment}
                  aria-label="Allow item quantity adjustment"
                  disabled={operationsSaving}
                  onClick={() =>
                    void handleQuantityAdjustmentToggle(!allowQuantityAdjustment)
                  }
                >
                  <span className="theme-switch__thumb" aria-hidden />
                </button>
              ) : (
                <span className="ios-settings__value">Owner only</span>
              )}
            </span>
          </div>
          <div className="ios-settings__row ios-settings__row--static">
            <span className="ios-settings__icon ios-settings__icon--cash" aria-hidden>
              <i className="fa-solid fa-money-bill-transfer" />
            </span>
            <span className="ios-settings__label">Allow sale price update</span>
            <span className="ios-settings__trailing">
              {owner ? (
                <button
                  type="button"
                  role="switch"
                  className={`theme-switch${allowPriceAdjustment ? " is-on" : ""}`}
                  aria-checked={allowPriceAdjustment}
                  aria-label="Allow sale price update"
                  disabled={operationsSaving}
                  onClick={() =>
                    void handleAllowPriceAdjustmentToggle(!allowPriceAdjustment)
                  }
                >
                  <span className="theme-switch__thumb" aria-hidden />
                </button>
              ) : (
                <span className="ios-settings__value">Owner only</span>
              )}
            </span>
          </div>
        </div>
        <p className="ios-settings__footer">
          {allowQuantityAdjustment
            ? "Owners and staff can edit stock quantities. "
            : "Quantities are read-only for staff. "}
          {allowPriceAdjustment
            ? "Sale prices can be modified during checkout."
            : "Sale prices are fixed during checkout."}
        </p>
      </section>
      ) : null}

      {restaurant && groupMatches("menu sections categories dishes restaurant hotel") ? (
        <section className="ios-settings__group" aria-label="Menu">
          <h3 className="ios-settings__caption">Menu</h3>
          <div className="ios-settings__card">
            <button
              type="button"
              className="ios-settings__row"
              onClick={() => setPane("menu-sections")}
            >
              <span className="ios-settings__icon ios-settings__icon--inventory" aria-hidden>
                <i className="fa-solid fa-utensils" />
              </span>
              <span className="ios-settings__label">Menu sections</span>
              <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
            </button>
          </div>
          <p className="ios-settings__footer">
            Choose the sections your dishes are grouped under, e.g. Burgers, Breakfast, Drinks.
          </p>
        </section>
      ) : null}

      {restaurant && groupMatches("supplies kitchen store issue ingredients stock recipe") ? (
        <section className="ios-settings__group" aria-label="Supplies and kitchen">
          <h3 className="ios-settings__caption">Supplies and kitchen</h3>
          <div className="ios-settings__card">
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__icon ios-settings__icon--inventory" aria-hidden>
                <i className="fa-solid fa-warehouse" />
              </span>
              <span className="ios-settings__label">Store and kitchen</span>
              <span className="ios-settings__trailing">
                {owner ? (
                  <button
                    type="button"
                    role="switch"
                    className={`theme-switch${kitchenIssuing ? " is-on" : ""}`}
                    aria-checked={kitchenIssuing}
                    aria-label="Store and kitchen"
                    disabled={operationsSaving}
                    onClick={() => void handleKitchenIssuingToggle(!kitchenIssuing)}
                  >
                    <span className="theme-switch__thumb" aria-hidden />
                  </button>
                ) : (
                  <span className="ios-settings__value">{kitchenIssuing ? "On" : "Off"}</span>
                )}
              </span>
            </div>
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__icon ios-settings__icon--cash" aria-hidden>
                <i className="fa-solid fa-ban" />
              </span>
              <span className="ios-settings__label">Block sales when ingredients run out</span>
              <span className="ios-settings__trailing">
                {owner ? (
                  <button
                    type="button"
                    role="switch"
                    className={`theme-switch${blockLowIngredients ? " is-on" : ""}`}
                    aria-checked={blockLowIngredients}
                    aria-label="Block sales when ingredients run out"
                    disabled={operationsSaving}
                    onClick={() => void handleBlockLowIngredientsToggle(!blockLowIngredients)}
                  >
                    <span className="theme-switch__thumb" aria-hidden />
                  </button>
                ) : (
                  <span className="ios-settings__value">Owner only</span>
                )}
              </span>
            </div>
          </div>
          <p className="ios-settings__footer">
            {kitchenIssuing
              ? "Supplies are issued from the store to the kitchen each day; sales use up kitchen stock. "
              : "Sales use up supplies straight from stock. "}
            {blockLowIngredients
              ? "Dishes can't be sold once an ingredient runs out."
              : "Dishes can still be sold when ingredients run low; stock goes negative until counted."}
          </p>
        </section>
      ) : null}

      {groupMatches("purchases buying selling price adjust pricing") ? (
      <section className="ios-settings__group" aria-label="Purchases">
        <h3 className="ios-settings__caption">Purchases</h3>
        <div className="ios-settings__card">
          <div className="ios-settings__row ios-settings__row--static">
            <span className="ios-settings__icon ios-settings__icon--purchase" aria-hidden>
              <i className="fa-solid fa-tags" />
            </span>
            <span className="ios-settings__label">Adjust selling price</span>
            <span className="ios-settings__trailing">
              {owner ? (
                <button
                  type="button"
                  role="switch"
                  className={`theme-switch${adjustSellingPrice ? " is-on" : ""}`}
                  aria-checked={adjustSellingPrice}
                  aria-label="Adjust selling price on purchases"
                  disabled={operationsSaving}
                  onClick={() => void handleAdjustSellingPriceToggle(!adjustSellingPrice)}
                >
                  <span className="theme-switch__thumb" aria-hidden />
                </button>
              ) : (
                <span className="ios-settings__value">Owner only</span>
              )}
            </span>
          </div>
        </div>
        <p className="ios-settings__footer">
          {adjustSellingPrice
            ? "Set selling and buying prices on purchases."
            : "Purchases ask for buying price only."}
        </p>
      </section>
      ) : null}

      {owner && groupMatches("team staff members invite login permissions access") ? (
        <section className="ios-settings__group" aria-label="Team">
          <h3 className="ios-settings__caption">Team</h3>
          <div className="ios-settings__card">
            <button
              type="button"
              className="ios-settings__row"
              onClick={() => setPane("team")}
            >
              <span className="ios-settings__icon ios-settings__icon--team" aria-hidden>
                <i className="fa-solid fa-users" />
              </span>
              <span className="ios-settings__label">Team members</span>
              <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
            </button>
          </div>
          <p className="ios-settings__footer">Invite staff and manage access.</p>
        </section>
      ) : null}

      {groupMatches("app camera download home screen install dark mode theme appearance") ? (
      <section className="ios-settings__group" aria-label="App">
        <h3 className="ios-settings__caption">App</h3>
        <div className="ios-settings__card">
          <button
            type="button"
            className="ios-settings__row"
            onClick={() => setPane("camera")}
          >
            <span className="ios-settings__icon ios-settings__icon--camera" aria-hidden>
              <i className="fa-solid fa-camera" />
            </span>
            <span className="ios-settings__label">Camera</span>
            <span className="ios-settings__value">
              {cameraReady == null ? "" : cameraReady ? "Ready" : "Off"}
            </span>
            <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
          </button>
          <button
            type="button"
            className="ios-settings__row"
            onClick={() => setPane("download")}
          >
            <span className="ios-settings__icon ios-settings__icon--download" aria-hidden>
              <i className="fa-solid fa-download" />
            </span>
            <span className="ios-settings__label">Add to Home Screen</span>
            <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
          </button>
          <div className="ios-settings__row ios-settings__row--static">
            <span className="ios-settings__icon ios-settings__icon--theme" aria-hidden>
              <i className="fa-solid fa-moon" />
            </span>
            <span className="ios-settings__label">Dark Mode</span>
            <span className="ios-settings__trailing">
              <ThemeToggle variant="switch" />
            </span>
          </div>
        </div>
      </section>
      ) : null}

      {groupMatches("account logout log out sign out") ? (
      <section className="ios-settings__group" aria-label="Account">
        <div className="ios-settings__card">
          <button
            type="button"
            className="ios-settings__row ios-settings__row--danger"
            onClick={() => void logout()}
            disabled={loggingOut}
            aria-busy={loggingOut}
          >
            <span className="ios-settings__label ios-settings__label--center">
              {loggingOut ? "Logging Out…" : "Log Out"}
            </span>
          </button>
        </div>
      </section>
      ) : null}
    </div>
  );
}
