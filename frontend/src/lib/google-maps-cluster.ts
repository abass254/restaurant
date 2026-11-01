import {
  MarkerClusterer,
  SuperClusterAlgorithm,
  defaultOnClusterClickHandler,
  type Marker,
} from "@googlemaps/markerclusterer";
import {
  createStoreClusterMarkerElement,
  getStoreClusterMarkerIcon,
} from "./google-maps-style";
import { hasCloudMapId, type GoogleMapsMap, type GoogleMapsMarker } from "./google-maps";

type ClusterMarkerCtor = new (options: Record<string, unknown>) => GoogleMapsMarker;

/** Store pins are 44×52px; use a wider radius so overlapping icons merge into one cluster. */
const STORE_CLUSTER_RADIUS_PX = 100;
/** Keep clustering active until street-level zoom so pins do not stack on top of each other. */
const STORE_CLUSTER_MAX_ZOOM = 19;

async function resolveClusterMarkerCtor(): Promise<{
  MarkerCtor: ClusterMarkerCtor;
  usesAdvanced: boolean;
}> {
  // Match `createMarker` in google-maps.ts: prefer classic markers when available.
  const classic = (window.google?.maps as { Marker?: ClusterMarkerCtor })?.Marker;
  if (classic) {
    return { MarkerCtor: classic, usesAdvanced: false };
  }

  const markerLib = await window.google!.maps.importLibrary("marker").catch(() => null);
  const advanced = markerLib
    ? (markerLib as { AdvancedMarkerElement?: ClusterMarkerCtor }).AdvancedMarkerElement
    : null;
  if (advanced && hasCloudMapId()) {
    return { MarkerCtor: advanced, usesAdvanced: true };
  }

  throw new Error("No supported Google Maps marker implementation is available for clusters.");
}

/** Attach TransChap-styled clustering to merchant store markers. */
export async function attachStoreMarkerClusterer(
  map: GoogleMapsMap,
  markers: GoogleMapsMarker[],
): Promise<MarkerClusterer> {
  const { MarkerCtor, usesAdvanced } = await resolveClusterMarkerCtor();

  return new MarkerClusterer({
    map: map as never,
    markers: markers as unknown as Marker[],
    onClusterClick: defaultOnClusterClickHandler,
    algorithm: new SuperClusterAlgorithm({
      radius: STORE_CLUSTER_RADIUS_PX,
      maxZoom: STORE_CLUSTER_MAX_ZOOM,
      minPoints: 2,
    }),
    renderer: {
      render: ({ count, position }) => {
        if (usesAdvanced) {
          return new MarkerCtor({
            position,
            content: createStoreClusterMarkerElement(count),
            zIndex: 1000 + count,
          });
        }

        return new MarkerCtor({
          position,
          icon: getStoreClusterMarkerIcon(count),
          zIndex: 1000 + count,
        });
      },
    },
  });
}
