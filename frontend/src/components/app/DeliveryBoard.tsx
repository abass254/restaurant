"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ListLoadError } from "@/components/app/ListLoadError";
import { motion, useReducedMotion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { useAuthUser } from "@/components/app/AuthProvider";
import { OnlineRidersBadge } from "@/components/app/OnlineRidersBadge";
import { Skeleton } from "@/components/app/Skeleton";
import { MotionModal } from "@/components/app/MotionModal";
import { MpesaFlowStatus } from "@/components/app/MpesaFlowStatus";
import { LocationPicker } from "@/components/shared/LocationPicker";
import { OpenLocationPicker } from "@/components/shared/OpenLocationPicker";
import { OpenRouteMap } from "@/components/shared/OpenRouteMap";
import { MotorbikeRouteMap, type RouteQuoteState } from "@/components/shared/MotorbikeRouteMap";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { type LatLng } from "@/lib/google-maps";
import { formatMoney } from "@/lib/orders";
import {
  buildDeliveryFlowSteps,
  deliveryStatusLabel,
  deliveryStatusTone,
} from "@/lib/delivery-workflow";
import {
  canRetryRiderSearch,
  isActivelyLookingForRider,
  riderSearchDeadline,
} from "@/lib/rider-search";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import { useMapProviderConfig } from "@/lib/useMapProviderConfig";
import type {
  DeliveriesListResponse,
  DeliveryHailResponse,
  DeliveryRecord,
} from "@/lib/types";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return formatNairobiDateTime(iso) || "—";
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  if (raw.length === 12 && raw.startsWith("254")) {
    return `+${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6, 9)} ${raw.slice(9)}`;
  }
  return raw;
}

export function DeliveryBoard({ children }: { children?: ReactNode }) {
  const user = useAuthUser();
  const reduce = useReducedMotion();
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);
  const [, countdownTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<DeliveriesListResponse>(
        `${apiRoutes.deliveries}?standalone=1&per_page=100`,
      );
      setDeliveries(data.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(extractErrorMessage(err, "Could not load deliveries."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const looking = deliveries.some(isActivelyLookingForRider);
    if (!looking) return;
    const id = window.setInterval(() => {
      countdownTick((tick) => tick + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [deliveries]);

  useEffect(() => {
    const shouldReload = deliveries.some((delivery) => {
      const deadline = riderSearchDeadline(delivery);
      return Boolean(deadline && deadline.getTime() <= Date.now());
    });
    if (shouldReload) void reload();
  }, [deliveries, countdownTick, reload]);

  useEffect(() => {
    const inProgress = deliveries.some(
      (delivery) =>
        !["completed", "cancelled"].includes(delivery.status) &&
        delivery.rider_trip_phase !== "completed" &&
        delivery.rider_trip_phase !== "cancelled",
    );
    if (!inProgress) return;
    const pollMs =
      deliveries.some(isActivelyLookingForRider) ||
      deliveries.some(
        (delivery) =>
          Boolean(delivery.assigned_rider_id) &&
          !["completed", "cancelled"].includes(delivery.status),
      )
        ? 2000
        : 4000;
    const id = window.setInterval(() => {
      void reload();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [deliveries, reload]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return deliveries;
    return deliveries.filter((delivery) =>
      [
        delivery.delivery_number,
        delivery.customer_name ?? "",
        delivery.customer_phone ?? "",
        delivery.pickup_address ?? "",
        delivery.delivery_address ?? "",
        delivery.assigned_rider_name ?? "",
        deliveryStatusLabel(delivery),
        String(delivery.delivery_fee),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [deliveries, filterText, countdownTick]);

  const account = user.active_account ?? user.account;
  const shopLabel = account?.business_location ?? "";
  const shopCoords = useMemo<LatLng | null>(() => {
    if (account?.latitude == null || account?.longitude == null) return null;
    return { lat: account.latitude, lng: account.longitude };
  }, [account?.latitude, account?.longitude]);

  const retryRiderSearch = useCallback(
    async (delivery: DeliveryRecord) => {
      if (retryingDeliveryId) return;
      setRetryingDeliveryId(delivery.id);
      try {
        const data = await apiFetch<DeliveryHailResponse>(
          apiRoutes.deliveryRetryRiderSearch(delivery.id),
          { method: "POST" },
        );
        await toastSuccess(data.message);
        await reload();
      } catch (err) {
        await showError("Could not look for a rider again", extractErrorMessage(err));
      } finally {
        setRetryingDeliveryId(null);
      }
    },
    [reload, retryingDeliveryId],
  );

  return (
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Delivery</h1>
          <p className="app-lead">
            Request a rider, track live jobs, and manage your fleet below.
          </p>
        </div>
        <div className="inventory-header__actions">
          <OnlineRidersBadge />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setModalOpen(true)}
          >
            <i className="fa-solid fa-motorcycle" aria-hidden="true" />
            Look for rider
          </button>
        </div>
      </header>

      <div className="inventory-toolbar">
        <label className="inventory-toolbar__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter by customer, drop-off, rider, status…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void reload()}
          title="Refresh deliveries"
        >
          <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {loadError && deliveries.length > 0 ? (
        <p className="list-load-banner" role="status">
          {loadError}{" "}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      ) : null}

      {loading ? (
        <DeliveriesSkeleton />
      ) : loadError && deliveries.length === 0 ? (
        <ListLoadError
          title="Could not load deliveries"
          message={loadError}
          onRetry={() => {
            setLoading(true);
            void reload();
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="inventory-empty">
          <i className="fa-solid fa-motorcycle" aria-hidden="true" />
          <h2>{deliveries.length === 0 ? "No deliveries yet" : "No matches"}</h2>
          <p>
            {deliveries.length === 0
              ? "Look for a rider to collect from your pickup and go to a drop-off."
              : "Try a different customer, address, rider, or status."}
          </p>
          {deliveries.length === 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setModalOpen(true)}
            >
              <i className="fa-solid fa-motorcycle" aria-hidden="true" />
              Look for rider
            </button>
          ) : null}
        </div>
      ) : (
        <div className="inventory-table-wrap">
          <table className="inventory-table payment-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Drop-off</th>
                <th>Fee</th>
                <th>Rider</th>
                <th>Status</th>
                <th>Action</th>
                <th>Flow</th>
              </tr>
            </thead>
            <motion.tbody
              variants={reduce ? undefined : staggerContainer}
              initial={reduce ? false : "hidden"}
              animate={reduce ? undefined : "visible"}
            >
              {filtered.map((delivery) => {
                const statusLabel = deliveryStatusLabel(delivery);
                const statusCls = deliveryStatusTone(delivery);
                return (
                  <motion.tr
                    key={delivery.id}
                    variants={reduce ? undefined : staggerItem}
                    layout={reduce ? false : "position"}
                  >
                    <td>
                      <div className="payment-cell-when">
                        <span>{formatWhen(delivery.created_at)}</span>
                        <span className="app-muted">{delivery.delivery_number}</span>
                      </div>
                    </td>
                    <td>
                      <div className="payment-cell-phone">
                        <strong>{delivery.customer_name || "—"}</strong>
                        <span className="app-muted">{formatPhone(delivery.customer_phone)}</span>
                      </div>
                    </td>
                    <td>
                      <span className="payment-cell-note">
                        {delivery.delivery_address || "—"}
                      </span>
                    </td>
                    <td>
                      <strong>{formatMoney(delivery.delivery_fee, delivery.currency)}</strong>
                    </td>
                    <td>{delivery.assigned_rider_name || "—"}</td>
                    <td>
                      <span className={`payment-status-pill ${statusCls}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td>
                      {canRetryRiderSearch(delivery) ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={retryingDeliveryId === delivery.id}
                          onClick={() => void retryRiderSearch(delivery)}
                        >
                          <i className="fa-solid fa-motorcycle" aria-hidden="true" />
                          {retryingDeliveryId === delivery.id
                            ? "Looking…"
                            : "Look for rider again"}
                        </button>
                      ) : (
                        <span className="app-muted">—</span>
                      )}
                    </td>
                    <td>
                      <MpesaFlowStatus
                        ariaLabel="Delivery progress"
                        steps={buildDeliveryFlowSteps(delivery)}
                      />
                    </td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table>
        </div>
      )}

      {children}

      <LookForRiderModal
        open={modalOpen}
        shopLabel={shopLabel}
        shopCoords={shopCoords}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          void reload();
        }}
      />
    </section>
  );
}

function DeliveriesSkeleton() {
  const rows = Array.from({ length: 6 });
  return (
    <div className="inventory-table-wrap" aria-busy="true" aria-live="polite">
      <table className="inventory-table payment-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Customer</th>
            <th>Drop-off</th>
            <th>Fee</th>
            <th>Rider</th>
            <th>Status</th>
            <th>Action</th>
            <th>Flow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((_, i) => (
            <tr key={i}>
              <td>
                <Skeleton variant="text" height={12} width={120} />
                <Skeleton variant="text" height={10} width={70} />
              </td>
              <td>
                <Skeleton variant="text" height={13} width={140} />
                <Skeleton variant="text" height={10} width={90} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={180} />
              </td>
              <td>
                <Skeleton variant="text" height={14} width={80} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={90} />
              </td>
              <td>
                <Skeleton variant="text" height={22} width={96} />
              </td>
              <td>
                <Skeleton variant="text" height={28} width={140} />
              </td>
              <td>
                <Skeleton variant="text" height={22} width={120} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LookForRiderModal({
  open,
  shopLabel,
  shopCoords,
  onClose,
  onCreated,
}: {
  open: boolean;
  shopLabel: string;
  shopCoords: LatLng | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { provider, mapEnabled, mapConfig, googleConfig } = useMapProviderConfig();
  const [fromLabel, setFromLabel] = useState(shopLabel);
  const [fromCoords, setFromCoords] = useState<LatLng | null>(shopCoords);
  const [toLabel, setToLabel] = useState("");
  const [toCoords, setToCoords] = useState<LatLng | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [routeState, setRouteState] = useState<RouteQuoteState>({
    distanceKm: null,
    durationMinutes: null,
    travelMode: null,
    source: null,
    loading: false,
    error: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const pickupTouchedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    pickupTouchedRef.current = false;
    setFromLabel(shopLabel);
    setFromCoords(shopCoords);
    setToLabel("");
    setToCoords(null);
    setCustomerName("");
    setCustomerPhone("");
    setRouteState({
      distanceKm: null,
      durationMinutes: null,
      travelMode: null,
      source: null,
      loading: false,
      error: null,
    });
  }, [open, shopLabel, shopCoords]);

  const handleRouteChange = useCallback((next: RouteQuoteState) => {
    setRouteState(next);
  }, []);

  function swapStops() {
    setFromLabel(toLabel);
    setToLabel(fromLabel);
    setFromCoords(toCoords);
    setToCoords(fromCoords);
  }

  function useStorePickup() {
    pickupTouchedRef.current = true;
    setFromLabel(shopLabel);
    setFromCoords(shopCoords);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const pickup = fromLabel.trim() || shopLabel.trim();
    const dropoff = toLabel.trim();
    if (!pickup) {
      await showError("Pickup needed", "Choose where the rider should collect from.");
      return;
    }
    if (!dropoff) {
      await showError("Drop-off needed", "Choose where the rider should deliver to.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, string | number> = {
        pickup_address: pickup,
        delivery_address: dropoff,
      };
      if (fromCoords) {
        payload.pickup_lat = fromCoords.lat;
        payload.pickup_lng = fromCoords.lng;
      }
      if (customerName.trim()) payload.customer_name = customerName.trim();
      if (customerPhone.trim()) payload.customer_phone = customerPhone.trim();
      const data = await apiFetch<DeliveryHailResponse>(apiRoutes.deliveryHail, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await toastSuccess(data.message);
      onCreated();
    } catch (err) {
      await showError("Could not look for a rider", extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const hasQuote =
    routeState.distanceKm != null && !routeState.loading && !routeState.error;
  const canSubmit = Boolean((fromLabel.trim() || shopLabel.trim()) && toLabel.trim()) && !submitting;

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Look for rider"
      panelClassName="ride-request-modal"
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
    >
      <form className="tools-delivery ride-request" onSubmit={(e) => void handleSubmit(e)}>
        <div className="ride-request__map">
          {mapEnabled ? (
            provider === "open" ? (
              <OpenRouteMap
                className="ride-preview__map"
                config={mapConfig}
                from={fromCoords}
                to={toCoords}
                onRouteChange={handleRouteChange}
              />
            ) : googleConfig ? (
              <MotorbikeRouteMap
                className="ride-preview__map"
                config={googleConfig}
                from={fromCoords}
                to={toCoords}
                onRouteChange={handleRouteChange}
              />
            ) : (
              <div className="ride-request__map-empty">
                <i className="fa-solid fa-map-location-dot" aria-hidden="true" />
                <span>Set pickup and drop-off below</span>
              </div>
            )
          ) : (
            <div className="ride-request__map-empty">
              <i className="fa-solid fa-map-location-dot" aria-hidden="true" />
              <span>Set pickup and drop-off below</span>
            </div>
          )}
          <button
            type="button"
            className="ride-request__close"
            aria-label="Close"
            onClick={onClose}
            disabled={submitting}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div className="ride-request__sheet">
          <h2 className="ride-request__title">Where to?</h2>

          <div className="ride-preview__stops-card">
            <div className="ride-preview__rail" aria-hidden="true">
              <span className="ride-preview__dot ride-preview__dot--pickup" />
              <span className="ride-preview__line" />
              <span className="ride-preview__dot ride-preview__dot--dropoff" />
            </div>
            <div className="ride-preview__fields">
              {mapEnabled ? (
                provider === "open" ? (
                  <>
                    <OpenLocationPicker
                      config={mapConfig}
                      value={fromLabel}
                      onChange={(value) => {
                        pickupTouchedRef.current = true;
                        setFromLabel(value);
                      }}
                      onCoordsChange={setFromCoords}
                      label="Pickup"
                      placeholder="Store location"
                      variant="ride"
                      hideHint
                      showStoreLocation
                      storeLabel={shopLabel}
                      storeCoords={shopCoords}
                    />
                    <div className="ride-preview__divider" />
                    <OpenLocationPicker
                      config={mapConfig}
                      value={toLabel}
                      onChange={setToLabel}
                      onCoordsChange={setToCoords}
                      label="Drop-off"
                      placeholder="Where to?"
                      variant="ride"
                      hideHint
                      required
                      autoFocus={open}
                    />
                  </>
                ) : googleConfig ? (
                  <>
                    <LocationPicker
                      config={googleConfig}
                      value={fromLabel}
                      onChange={(value) => {
                        pickupTouchedRef.current = true;
                        setFromLabel(value);
                      }}
                      onCoordsChange={setFromCoords}
                      label="Pickup"
                      placeholder="Store location"
                      variant="ride"
                      showMap={false}
                      hideHint
                      showStoreLocation
                      storeLabel={shopLabel}
                      storeCoords={shopCoords}
                    />
                    <div className="ride-preview__divider" />
                    <LocationPicker
                      config={googleConfig}
                      value={toLabel}
                      onChange={setToLabel}
                      onCoordsChange={setToCoords}
                      label="Drop-off"
                      placeholder="Where to?"
                      variant="ride"
                      showMap={false}
                      hideHint
                      required
                      autoFocus={open}
                    />
                  </>
                ) : null
              ) : (
                <>
                  <div className="ride-stop">
                    <span className="sr-only">Pickup</span>
                    <span className="ride-stop__control ride-stop__control--locate">
                      <input
                        type="text"
                        value={fromLabel}
                        onChange={(e) => {
                          pickupTouchedRef.current = true;
                          setFromLabel(e.target.value);
                        }}
                        placeholder="Store location"
                      />
                      {shopLabel ? (
                        <button
                          type="button"
                          className="ride-stop__locate"
                          onClick={useStorePickup}
                          aria-label="Use store location for pickup"
                          title="Use store location"
                        >
                          <i className="fa-solid fa-store" aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                  <div className="ride-preview__divider" />
                  <div className="ride-stop">
                    <span className="sr-only">Drop-off</span>
                    <span className="ride-stop__control">
                      <input
                        type="text"
                        required
                        value={toLabel}
                        onChange={(e) => setToLabel(e.target.value)}
                        placeholder="Where to?"
                      />
                    </span>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className="ride-preview__swap"
              onClick={swapStops}
              aria-label="Swap pickup and drop-off"
              title="Swap locations"
            >
              <i className="fa-solid fa-arrow-up-arrow-down" aria-hidden="true" />
            </button>
          </div>

          {routeState.loading ? (
            <p className="ride-request__quote">
              <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" /> Getting route…
            </p>
          ) : hasQuote ? (
            <p className="ride-request__quote">
              <span>
                <strong>{routeState.distanceKm!.toFixed(1)} km</strong>
                {routeState.durationMinutes != null
                  ? ` · ${Math.max(1, Math.round(routeState.durationMinutes))} min`
                  : ""}
              </span>
            </p>
          ) : null}

          <div className="ride-request__contact">
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Recipient name"
              autoComplete="name"
            />
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Phone"
              autoComplete="tel"
            />
          </div>

          <button type="submit" className="btn btn-primary ride-request__cta" disabled={!canSubmit}>
            {submitting ? "Looking for a rider…" : "Look for rider"}
          </button>
        </div>
      </form>
    </MotionModal>
  );
}
