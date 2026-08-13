"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthRefresh, useAuthUser } from "@/components/app/AuthProvider";
import { BusinessLocationSection } from "@/components/app/BusinessLocationSection";
import { AuthShell } from "@/components/auth/AuthShell";
import { apiFetch, resetCsrfCookie } from "@/lib/api";
import {
  accountHasLocationCoordinates,
  accountNeedsLocationSetup,
} from "@/lib/account-location";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  STORAGE_KEY,
  defaultCategoryForVertical,
  loadSignupCity,
  saveBusinessVertical,
  stepsForCategory,
  type OnboardingDraft,
  type OnboardingStepId,
} from "@/lib/onboarding";
import type { AuthUser, BusinessAccount } from "@/lib/types";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";

type ProductRow = {
  inventory_item_id: string;
  name: string;
  price: number | null;
  stock_quantity: number | null;
};

type ProductDraftRow = {
  key: string;
  inventory_item_id?: string;
  name: string;
  price: string;
  stock_quantity: string;
};

function newProductDraft(partial?: Partial<ProductDraftRow>): ProductDraftRow {
  return {
    key:
      partial?.key ||
      `prd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    inventory_item_id: partial?.inventory_item_id,
    name: partial?.name ?? "",
    price: partial?.price ?? "",
    stock_quantity: partial?.stock_quantity ?? "10",
  };
}

function draftsFromProducts(rows: ProductRow[]): ProductDraftRow[] {
  if (rows.length === 0) return [newProductDraft()];
  return rows.map((p) =>
    newProductDraft({
      key: p.inventory_item_id,
      inventory_item_id: p.inventory_item_id,
      name: p.name,
      price: p.price != null ? String(p.price) : "",
      stock_quantity:
        p.stock_quantity != null ? String(p.stock_quantity) : "10",
    }),
  );
}

const STEP_IDS = new Set<OnboardingStepId>(
  stepsForCategory().map((s) => s.id),
);

const LEGACY_STEP_MAP: Record<string, OnboardingStepId> = {
  business: "welcome",
  staff: "catalog",
  availability: "catalog",
  booking_link: "catalog",
  payment: "catalog",
  ai: "catalog",
  channels: "catalog",
  test: "catalog",
  go_live: "catalog",
};

function loadDraft(): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OnboardingDraft) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: OnboardingDraft) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

function resolveResumeStep(draft: OnboardingDraft | null): OnboardingStepId {
  const raw = draft?.stepId as string | undefined;
  const mapped = raw ? (LEGACY_STEP_MAP[raw] ?? raw) : null;
  if (mapped && STEP_IDS.has(mapped as OnboardingStepId)) {
    return mapped as OnboardingStepId;
  }
  return "welcome";
}

const POST_LOCATION_STEPS = new Set<OnboardingStepId>(["catalog"]);

function resolveStepWithLocation(
  resume: OnboardingStepId,
  account: BusinessAccount | null | undefined,
  mapEnabled: boolean,
): OnboardingStepId {
  const needsLocation = mapEnabled && accountNeedsLocationSetup(account);
  if (needsLocation && POST_LOCATION_STEPS.has(resume)) {
    return "location";
  }
  if (
    resume === "location" &&
    (!mapEnabled || accountHasLocationCoordinates(account))
  ) {
    return "catalog";
  }
  return resume;
}

function shopAccountFromUser(user: AuthUser): BusinessAccount | null {
  return user.active_account || user.account || null;
}

export function OnboardingWizard() {
  const router = useRouter();
  const authUser = useAuthUser();
  const refreshUser = useAuthRefresh();
  const { mapEnabled, loading: mapsLoading } = useGoogleMapsPublicConfig();
  const [stepId, setStepId] = useState<OnboardingStepId>("welcome");
  const [category, setCategory] = useState<string | null>(null);
  const [userName, setUserName] = useState("there");
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [locationAdjusted, setLocationAdjusted] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [productRows, setProductRows] = useState<ProductDraftRow[]>([
    newProductDraft(),
  ]);

  const steps = useMemo(() => stepsForCategory(category), [category]);
  const progressSteps = useMemo(
    () => steps.filter((s) => s.id !== "welcome"),
    [steps],
  );
  const progressIndex = Math.max(
    0,
    progressSteps.findIndex((s) => s.id === stepId),
  );
  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const businessAccount = shopAccountFromUser(authUser);
  const locationReady =
    !mapsLoading &&
    (!mapEnabled || accountHasLocationCoordinates(businessAccount));

  const persist = useCallback((nextStep: OnboardingStepId, nextCategory: string | null) => {
    saveDraft({
      stepId: nextStep,
      category: nextCategory,
      accountId: null,
      registered: true,
      vertical: "retail",
    });
  }, []);

  const goTo = useCallback(
    (id: OnboardingStepId) => {
      setStepId(id);
      persist(id, category);
      setError(null);
    },
    [category, persist],
  );

  const nextStep = useCallback(() => {
    const idx = steps.findIndex((s) => s.id === stepId);
    let next = steps[idx + 1];
    if (
      next?.id === "location" &&
      !mapsLoading &&
      (!mapEnabled || accountHasLocationCoordinates(businessAccount))
    ) {
      next = steps[idx + 2];
    }
    if (next) goTo(next.id);
  }, [businessAccount, goTo, mapEnabled, mapsLoading, stepId, steps]);

  const prevStep = useCallback(() => {
    const idx = steps.findIndex((s) => s.id === stepId);
    const prev = steps[idx - 1];
    if (prev) goTo(prev.id);
  }, [goTo, stepId, steps]);

  const refreshInventory = useCallback(async () => {
    const res = await apiFetch<{ data: Array<Record<string, unknown>> }>(
      apiRoutes.inventory,
    );
    const rows = (res.data || []).map((item) => {
      const product = (item.product || {}) as Record<string, unknown>;
      return {
        inventory_item_id: String(item.id),
        name: String(product.name || "Item"),
        price: item.selling_price != null ? Number(item.selling_price) : null,
        stock_quantity:
          item.stock_quantity != null ? Number(item.stock_quantity) : null,
      };
    });
    setProductRows(draftsFromProducts(rows));
  }, []);

  const ensureShop = useCallback(
    async (user: AuthUser) => {
      const fromUser = (u: AuthUser) => ({
        category:
          u.active_account?.business_category ||
          u.account?.business_category ||
          defaultCategoryForVertical("retail"),
        businessName:
          u.active_account?.business_name || u.account?.business_name || null,
        user: u,
      });

      const hasShop = Boolean(
        user.active_account?.id ||
          user.account?.id ||
          (user.memberships && user.memberships.length > 0),
      );
      if (hasShop) return fromUser(user);

      try {
        resetCsrfCookie();
        const res = await apiFetch<{
          account: {
            id: string;
            business_category: string;
            business_name?: string;
          };
        }>(apiRoutes.createShop, {
          method: "POST",
          body: JSON.stringify({
            business_name: (user.name || "My shop").trim(),
            business_location: (loadSignupCity() || "Kenya").trim(),
            business_category: defaultCategoryForVertical("retail"),
            admin_phone: user.phone || null,
            latitude: null,
            longitude: null,
          }),
        });
        resetCsrfCookie();
        const refreshed =
          (await refreshUser()) || (await apiFetch<AuthUser>(apiRoutes.user));
        return {
          category: res.account.business_category,
          businessName: res.account.business_name || user.name || null,
          user: refreshed,
        };
      } catch (err) {
        try {
          const refreshed =
            (await refreshUser()) || (await apiFetch<AuthUser>(apiRoutes.user));
          const ready = Boolean(
            refreshed.active_account?.id ||
              refreshed.account?.id ||
              (refreshed.memberships && refreshed.memberships.length > 0),
          );
          if (ready) return fromUser(refreshed);
        } catch {
          /* still unauthenticated / unavailable */
        }
        throw new Error(
          extractErrorMessage(
            err,
            "Could not prepare your shop. Please try again.",
          ),
        );
      }
    },
    [refreshUser],
  );

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const draft = loadDraft();
      try {
        const user = await apiFetch<AuthUser>(apiRoutes.user);
        if (cancelled) return;

        const shop = await ensureShop(user);
        if (cancelled) return;

        setUserName(shop.user.name || user.name || "there");
        setBusinessName(shop.businessName);
        setCategory(shop.category);
        saveBusinessVertical("retail");
        const resume = resolveResumeStep(draft);
        setStepId(resume);
        persist(resume, shop.category);

        await refreshInventory().catch(() => undefined);
      } catch (err) {
        if (cancelled) return;
        try {
          await apiFetch<AuthUser>(apiRoutes.user);
          setError(
            extractErrorMessage(
              err,
              "Could not prepare your shop. Please refresh and try again.",
            ),
          );
        } catch {
          router.replace("/sign-in?next=/onboarding");
        }
        return;
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bootstrapping || mapsLoading || locationAdjusted) return;
    const adjusted = resolveStepWithLocation(
      stepId,
      businessAccount,
      mapEnabled,
    );
    if (adjusted !== stepId) {
      goTo(adjusted);
    }
    setLocationAdjusted(true);
  }, [
    bootstrapping,
    businessAccount,
    goTo,
    locationAdjusted,
    mapEnabled,
    mapsLoading,
    stepId,
  ]);

  function updateProductRow(key: string, patch: Partial<ProductDraftRow>) {
    setProductRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function addProductRow() {
    setProductRows((rows) => [...rows, newProductDraft()]);
  }

  function removeProductRow(key: string) {
    setProductRows((rows) => {
      const next = rows.filter((r) => r.key !== key);
      return next.length > 0 ? next : [newProductDraft()];
    });
  }

  async function saveProductsAndFinish() {
    const filled = productRows.filter((r) => r.name.trim() && r.price.trim());
    if (filled.length < 1) {
      setError("Add at least one product with a name and price.");
      return;
    }
    const incomplete = productRows.some(
      (r) =>
        (r.name.trim() || r.price.trim()) && !(r.name.trim() && r.price.trim()),
    );
    if (incomplete) {
      setError("Each product needs both a name and a price.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      for (const row of filled) {
        if (row.inventory_item_id) continue;
        const product = await apiFetch<{ data: { id: string } }>(
          apiRoutes.products,
          {
            method: "POST",
            body: JSON.stringify({
              name: row.name.trim(),
              product_type: "product",
              category: category || defaultCategoryForVertical("retail"),
            }),
          },
        );
        await apiFetch(apiRoutes.inventory, {
          method: "POST",
          body: JSON.stringify({
            product_id: product.data.id,
            selling_price: Number(row.price),
            stock_quantity: Number(row.stock_quantity) || 0,
          }),
        });
      }
      localStorage.removeItem(STORAGE_KEY);
      router.push("/dashboard");
    } catch (err) {
      setError(extractErrorMessage(err, "Could not save products."));
    } finally {
      setBusy(false);
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
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.href = "/sign-in";
  }

  return (
    <AuthShell
      heroLabel="setup"
      className="auth-split--setup"
      panelAction={
        <button
          type="button"
          className="auth-split__logout"
          disabled={loggingOut}
          onClick={() => void logout()}
        >
          {loggingOut ? "Logging out…" : "Log out"}
        </button>
      }
    >
      {bootstrapping ? (
        <div className="auth-split__loading" aria-live="polite">
          Loading setup…
        </div>
      ) : error && !category ? (
        <>
          <h1 className="auth-split__title">Setup paused</h1>
          <p className="auth-split__subtitle">{error}</p>
          <button
            type="button"
            className="auth-split__btn"
            onClick={() => window.location.reload()}
          >
            Retry setup
          </button>
        </>
      ) : (
        <>
          {stepId !== "welcome" ? (
            <aside className="ob-stepper" aria-label="Setup progress">
              <ol className="ob-stepper__list">
                {progressSteps.map((s, i) => {
                  const state =
                    i < progressIndex
                      ? "is-done"
                      : i === progressIndex
                        ? "is-active"
                        : "";
                  return (
                    <li
                      key={s.id}
                      className={`ob-stepper__item ${state}`.trim()}
                    >
                      <span
                        className="ob-stepper__circle"
                        aria-current={
                          i === progressIndex ? "step" : undefined
                        }
                      >
                        {i < progressIndex ? (
                          <i className="fas fa-check" aria-hidden="true" />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className="ob-stepper__label">{s.label}</span>
                    </li>
                  );
                })}
              </ol>
            </aside>
          ) : null}

          <div
            className={`ob-card${stepId === "welcome" ? " ob-card--welcome" : ""}`}
          >
            {error ? (
              <p
                role="alert"
                className="auth-split__alert auth-split__alert--error"
              >
                {error}
              </p>
            ) : null}

            {stepId === "welcome" && (
              <>
                <p className="ob-welcome__eyebrow">Account setup</p>
                <h1>
                  Welcome{firstName !== "there" ? `, ${firstName}` : ""}
                </h1>
                <p className="ob-lead">
                  Let&apos;s get {businessName || "your shop"} ready to sell.
                  We&apos;ll walk through location and products — it only takes
                  a few minutes.
                </p>
                <ul className="ob-welcome__list" aria-label="What you will set up">
                  <li>
                    <span className="ob-welcome__icon" aria-hidden="true">
                      <i className="fas fa-location-dot" />
                    </span>
                    <div>
                      <strong>Location</strong>
                      <span>
                        Pin your shop on the map for accurate delivery &amp;
                        routes
                      </span>
                    </div>
                  </li>
                  <li>
                    <span className="ob-welcome__icon" aria-hidden="true">
                      <i className="fas fa-boxes-stacked" />
                    </span>
                    <div>
                      <strong>Products</strong>
                      <span>What you sell, for how much, and how many you have</span>
                    </div>
                  </li>
                  <li>
                    <span className="ob-welcome__icon" aria-hidden="true">
                      <i className="fas fa-cash-register" />
                    </span>
                    <div>
                      <strong>Dashboard</strong>
                      <span>
                        Then open POS, orders, and M-Pesa from your shop
                      </span>
                    </div>
                  </li>
                </ul>
                <div className="ob-actions ob-actions--welcome">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={nextStep}
                  >
                    Start setup
                  </button>
                </div>
              </>
            )}

            {stepId === "location" && (
              <>
                <h1>Shop location</h1>
                <p className="ob-lead">
                  Pin your business on the map so delivery routes and fees work
                  correctly. Save your location, then continue to products.
                </p>
                {businessAccount ? (
                  <BusinessLocationSection
                    account={businessAccount}
                    hideSignedInAs
                    onSaved={() => setError(null)}
                  />
                ) : (
                  <p className="ob-muted">Preparing your shop…</p>
                )}
                <div className="ob-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={prevStep}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || mapsLoading || (mapEnabled && !locationReady)}
                    onClick={() => {
                      if (mapEnabled && !locationReady) {
                        setError(
                          "Save your shop location on the map before continuing.",
                        );
                        return;
                      }
                      nextStep();
                    }}
                  >
                    {mapsLoading
                      ? "Loading maps…"
                      : mapEnabled && !locationReady
                        ? "Save location to continue"
                        : "Continue"}
                  </button>
                </div>
              </>
            )}

            {stepId === "catalog" && (
              <>
                <h1>Products</h1>
                <p className="ob-lead">
                  Add your products in a row — name, price, and stock. Add as
                  many as you need before opening the dashboard.
                </p>
                <div className="ob-svc-rows" role="list">
                  {productRows.map((row) => (
                    <div key={row.key} className="ob-svc-row" role="listitem">
                      <input
                        className="ob-svc-row__input ob-svc-row__input--name"
                        value={row.name}
                        onChange={(e) =>
                          updateProductRow(row.key, { name: e.target.value })
                        }
                        placeholder="Product name"
                        aria-label="Product name"
                        disabled={Boolean(row.inventory_item_id) || busy}
                      />
                      <input
                        className="ob-svc-row__input ob-svc-row__input--price"
                        type="number"
                        min={0}
                        value={row.price}
                        onChange={(e) =>
                          updateProductRow(row.key, { price: e.target.value })
                        }
                        placeholder="Price (KES)"
                        aria-label="Price in KES"
                        disabled={Boolean(row.inventory_item_id) || busy}
                      />
                      <input
                        className="ob-svc-row__input ob-svc-row__input--stock"
                        type="number"
                        min={0}
                        value={row.stock_quantity}
                        onChange={(e) =>
                          updateProductRow(row.key, {
                            stock_quantity: e.target.value,
                          })
                        }
                        placeholder="Stock"
                        aria-label="Stock quantity"
                        disabled={Boolean(row.inventory_item_id) || busy}
                      />
                      <button
                        type="button"
                        className="ob-svc-row__remove"
                        aria-label={`Remove ${row.name || "product"}`}
                        disabled={
                          busy ||
                          (productRows.length === 1 && !row.name && !row.price)
                        }
                        onClick={() => removeProductRow(row.key)}
                        title="Remove"
                      >
                        <i className="fas fa-xmark" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="ob-svc-add"
                  disabled={busy}
                  onClick={addProductRow}
                >
                  <i className="fas fa-plus" aria-hidden="true" /> Add another
                  product
                </button>
                <div className="ob-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={prevStep}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void saveProductsAndFinish()}
                  >
                    {busy ? "Saving…" : "Finish & open dashboard"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </AuthShell>
  );
}
