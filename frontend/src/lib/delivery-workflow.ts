import type { MpesaFlowStep } from "@/components/app/MpesaFlowStatus";
import type { DeliveryRecord } from "@/lib/types";
import {
  isActivelyLookingForRider,
  isTimedOutHail,
  riderSearchDeadline,
} from "@/lib/rider-search";

/** Merchant-facing delivery stages (matches rider trip phases). */
export type DeliveryStageKey =
  | "looking_for_rider"
  | "rider_on_the_way"
  | "rider_arrived"
  | "rider_to_client"
  | "delivered"
  | "no_rider_found"
  | "cancelled"
  | "disputed";

export const DELIVERY_PROGRESS_STAGES = [
  "looking_for_rider",
  "rider_on_the_way",
  "rider_arrived",
  "rider_to_client",
  "delivered",
] as const;

export type DeliveryProgressStage = (typeof DELIVERY_PROGRESS_STAGES)[number];

export const DELIVERY_STAGE_LABELS: Record<DeliveryProgressStage, string> = {
  looking_for_rider: "Looking for rider",
  rider_on_the_way: "Rider on the way",
  rider_arrived: "Rider arrived",
  rider_to_client: "Rider goes to the client",
  delivered: "Delivered",
};

const STAGE_ICONS: Record<DeliveryProgressStage, string> = {
  looking_for_rider: "fa-magnifying-glass",
  rider_on_the_way: "fa-motorcycle",
  rider_arrived: "fa-location-dot",
  rider_to_client: "fa-route",
  delivered: "fa-flag-checkered",
};

export function resolveDeliveryStage(delivery: DeliveryRecord): DeliveryStageKey {
  const phase = (delivery.rider_trip_phase || "").trim();
  const status = delivery.status;

  if (status === "completed" || phase === "completed") {
    return "delivered";
  }

  if (phase === "en_route_to_store") return "rider_on_the_way";
  if (phase === "at_store" || phase === "picking_up") return "rider_arrived";
  if (phase === "en_route_to_client" || phase === "at_client") {
    return "rider_to_client";
  }
  if (delivery.assigned_rider_id) return "rider_on_the_way";

  if (isTimedOutHail(delivery)) return "no_rider_found";
  if (status === "cancelled" || phase === "cancelled") return "cancelled";
  if (isActivelyLookingForRider(delivery)) return "looking_for_rider";

  return "looking_for_rider";
}

export function deliveryStatusLabel(delivery: DeliveryRecord): string {
  const stage = resolveDeliveryStage(delivery);

  if (stage === "no_rider_found") return "No rider found";
  if (stage === "cancelled") return "Cancelled";

  if (stage === "looking_for_rider") {
    const deadline = riderSearchDeadline(delivery);
    if (deadline) {
      const secondsLeft = Math.max(
        0,
        Math.ceil((deadline.getTime() - Date.now()) / 1000),
      );
      if (secondsLeft > 0) {
        const countdown =
          secondsLeft >= 60
            ? `${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60)
                .toString()
                .padStart(2, "0")} left`
            : `${secondsLeft}s left`;
        return `${DELIVERY_STAGE_LABELS.looking_for_rider} (${countdown})`;
      }
      return `${DELIVERY_STAGE_LABELS.looking_for_rider} (timing out…)`;
    }
  }

  if (stage in DELIVERY_STAGE_LABELS) {
    return DELIVERY_STAGE_LABELS[stage as DeliveryProgressStage];
  }

  return DELIVERY_STAGE_LABELS.looking_for_rider;
}

export function deliveryStatusTone(
  delivery: DeliveryRecord,
): "is-success" | "is-failed" | "is-cancelled" | "is-pending" {
  const stage = resolveDeliveryStage(delivery);
  if (stage === "delivered") return "is-success";
  if (stage === "no_rider_found") return "is-failed";
  if (stage === "cancelled") return "is-cancelled";
  return "is-pending";
}

export function buildDeliveryFlowSteps(delivery: DeliveryRecord): MpesaFlowStep[] {
  const stage = resolveDeliveryStage(delivery);
  const rider = (delivery.assigned_rider_name || "").trim() || "Rider";
  const pickup = (delivery.pickup_address || "").trim() || "pickup";
  const dropoff = (delivery.delivery_address || "").trim() || "the drop-off";

  const progressIndex =
    stage === "no_rider_found" || stage === "cancelled"
      ? -1
      : DELIVERY_PROGRESS_STAGES.indexOf(stage as DeliveryProgressStage);

  const tooltips: Record<DeliveryProgressStage, string> = {
    looking_for_rider: "Waiting for a rider to accept this trip.",
    rider_on_the_way: `${rider} is heading to ${pickup}.`,
    rider_arrived: `${rider} is at ${pickup}.`,
    rider_to_client: `${rider} is heading to ${dropoff}.`,
    delivered: `Delivered to ${dropoff}.`,
  };

  return DELIVERY_PROGRESS_STAGES.map((key, index) => {
    let tone: MpesaFlowStep["tone"] = "idle";
    let link: MpesaFlowStep["link"] = "idle";

    if (stage === "no_rider_found" && key === "looking_for_rider") {
      tone = "failed";
      link = "failed";
    } else if (stage === "cancelled") {
      if (progressIndex >= 0 && index <= progressIndex) {
        tone = index === progressIndex ? "failed" : "success";
        link = index < progressIndex ? "done" : "failed";
      }
    } else if (progressIndex >= 0) {
      if (index < progressIndex) {
        tone = "success";
        link = "done";
      } else if (index === progressIndex) {
        tone = key === "delivered" && stage === "delivered" ? "success" : "current";
        link = key === "delivered" && stage === "delivered" ? "done" : "progress";
      }
    }

    return {
      key,
      icon: STAGE_ICONS[key],
      label: DELIVERY_STAGE_LABELS[key],
      tone,
      tooltip: tooltips[key],
      link: index < DELIVERY_PROGRESS_STAGES.length - 1 ? link : undefined,
    };
  });
}
