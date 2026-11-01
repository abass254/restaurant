import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { TRANSCHAP_MAP_COLORS } from '@/src/map/brandStyle';
import { focusForVariant, type LatLng, type MapVariant } from '@/src/map/tripLocations';

type Props = {
  variant: MapVariant;
  path?: LatLng[];
  interactive?: boolean;
  simulateRide?: boolean;
  /** Zoomed navigation guide — tighter framing and follow the rider. */
  navGuide?: boolean;
  onLoad?: () => void;
};

type MapUpdatePayload = {
  center: { lat: number; lng: number };
  zoom: number;
  pins: Array<{ lat: number; lng: number; kind: string }>;
  path: Array<{ lat: number; lng: number }>;
  start: { lat: number; lng: number };
  simulate: boolean;
  navGuide: boolean;
};

function buildUpdatePayload(
  variant: MapVariant,
  path: LatLng[],
  simulateRide: boolean,
  navGuide: boolean,
): MapUpdatePayload {
  const focus = focusForVariant(variant);
  const center = focus.center;
  const pins = focus.pins
    .filter((p) => (path.length >= 2 && simulateRide ? p.kind !== 'rider' : true))
    .map((p) => ({
      lat: p.coord.latitude,
      lng: p.coord.longitude,
      kind: p.kind,
    }));
  const route = path.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  const zoom = navGuide ? 16 : variant === 'idle' ? 13 : 14;
  const start =
    route.length > 0
      ? route[0]
      : {
          lat: focus.pins[0]?.coord.latitude ?? center.latitude,
          lng: focus.pins[0]?.coord.longitude ?? center.longitude,
        };

  return {
    center: { lat: center.latitude, lng: center.longitude },
    zoom,
    pins,
    path: route,
    start,
    simulate: simulateRide,
    navGuide,
  };
}

/**
 * In-app map using Leaflet + clear OSM basemap.
 * TransChap branding lives on pins/routes — not CSS filters (those washed the map out).
 */
function buildShellHtml(interactive: boolean): string {
  const cream = TRANSCHAP_MAP_COLORS.cream100;
  const cream50 = TRANSCHAP_MAP_COLORS.cream50;
  const olive = '#3D4732';
  const oliveSoft = '#5A6750';
  const brown = TRANSCHAP_MAP_COLORS.primary;
  const textMuted = TRANSCHAP_MAP_COLORS.textMuted;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map {
      margin:0; padding:0; width:100%; height:100%;
      background:${cream};
    }
    .leaflet-control-attribution {
      font-size: 9px !important;
      background: rgba(255, 255, 255, 0.85) !important;
      color: ${textMuted} !important;
      border-radius: 6px 0 0 0;
      margin: 0 !important;
      padding: 2px 6px !important;
      box-shadow: none !important;
    }
    .leaflet-control-attribution a { color: ${oliveSoft} !important; }
    .leaflet-control-zoom a {
      background: #fff !important;
      color: ${olive} !important;
      border-color: #E8E2D8 !important;
      width: 34px !important;
      height: 34px !important;
      line-height: 34px !important;
      font-size: 16px !important;
    }
    .leaflet-control-zoom {
      border: none !important;
      box-shadow: 0 2px 10px rgba(28, 31, 24, 0.12) !important;
      border-radius: 12px !important;
      overflow: hidden;
    }
    .TransChap-pin {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid ${cream50};
      box-shadow: 0 1px 4px rgba(42, 47, 36, 0.28);
    }
    .TransChap-rider {
      width: 18px; height: 18px; border-radius: 50%;
      background: ${olive};
      border: 3px solid ${cream50};
      box-shadow: 0 1px 6px rgba(42, 47, 36, 0.35);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const INTERACTIVE = ${interactive ? 'true' : 'false'};
    const ROUTE_COLOR = '${olive}';
    const ROUTE_HALO = '#FFFFFF';
    var map = null;
    var pinLayer = null;
    var routeHalo = null;
    var routeLine = null;
    var riderMarker = null;
    var simTimer = null;

    function pinColor(kind) {
      if (kind === 'rider') return '${olive}';
      if (kind === 'store') return '${brown}';
      return '#2A2F24';
    }

    function pathLength(path) {
      var total = 0;
      for (var i = 1; i < path.length; i++) total += haversine(path[i-1], path[i]);
      return total;
    }

    function haversine(a, b) {
      var R = 6371000;
      var toRad = function (d) { return d * Math.PI / 180; };
      var dLat = toRad(b.lat - a.lat);
      var dLng = toRad(b.lng - a.lng);
      var lat1 = toRad(a.lat), lat2 = toRad(b.lat);
      var h = Math.sin(dLat/2)*Math.sin(dLat/2) +
        Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)*Math.sin(dLng/2);
      return 2 * R * Math.asin(Math.sqrt(h));
    }

    function pointAlong(path, t) {
      if (!path.length) return { lat: 0, lng: 0 };
      if (path.length === 1) return path[0];
      t = Math.max(0, Math.min(1, t));
      var total = pathLength(path);
      if (total <= 0) return path[0];
      var remain = total * t;
      for (var i = 1; i < path.length; i++) {
        var seg = haversine(path[i-1], path[i]);
        if (remain <= seg || i === path.length - 1) {
          var r = seg > 0 ? remain / seg : 0;
          return {
            lat: path[i-1].lat + (path[i].lat - path[i-1].lat) * r,
            lng: path[i-1].lng + (path[i].lng - path[i-1].lng) * r
          };
        }
        remain -= seg;
      }
      return path[path.length - 1];
    }

    function circleIcon(color, rider) {
      var el = document.createElement('div');
      el.className = rider ? 'TransChap-rider' : 'TransChap-pin';
      if (!rider) el.style.background = color;
      return L.divIcon({
        className: '',
        html: el.outerHTML,
        iconSize: rider ? [18, 18] : [16, 16],
        iconAnchor: rider ? [9, 9] : [8, 8],
      });
    }

    function stopSim() {
      if (simTimer) { clearInterval(simTimer); simTimer = null; }
    }

    function clearRoute() {
      if (routeHalo) { map.removeLayer(routeHalo); routeHalo = null; }
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    }

    function applyUpdate(payload) {
      if (!map) return;
      stopSim();
      if (pinLayer) { map.removeLayer(pinLayer); pinLayer = null; }
      clearRoute();

      pinLayer = L.layerGroup();
      var bounds = [];

      payload.pins.forEach(function (pin) {
        var m = L.marker([pin.lat, pin.lng], {
          icon: circleIcon(pinColor(pin.kind), false),
          interactive: false,
        });
        pinLayer.addLayer(m);
        bounds.push([pin.lat, pin.lng]);
      });
      pinLayer.addTo(map);

      if (payload.path.length >= 2) {
        var latlngs = payload.path.map(function (p) { return [p.lat, p.lng]; });
        routeHalo = L.polyline(latlngs, {
          color: ROUTE_HALO,
          weight: 9,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        routeLine = L.polyline(latlngs, {
          color: ROUTE_COLOR,
          weight: 5,
          opacity: 0.96,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        payload.path.forEach(function (p) { bounds.push([p.lat, p.lng]); });
      }

      if (!riderMarker) {
        riderMarker = L.marker([payload.start.lat, payload.start.lng], {
          icon: circleIcon('${olive}', true),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        riderMarker.setLatLng([payload.start.lat, payload.start.lng]);
      }
      bounds.push([payload.start.lat, payload.start.lng]);

      if (payload.navGuide && payload.path.length >= 2) {
        var near = payload.path.slice(0, Math.max(3, Math.ceil(payload.path.length * 0.35)));
        var nearBounds = near.map(function (p) { return [p.lat, p.lng]; });
        nearBounds.push([payload.start.lat, payload.start.lng]);
        map.fitBounds(nearBounds, { padding: [36, 36], maxZoom: 17 });
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [48, 48] });
      } else {
        map.setView([payload.center.lat, payload.center.lng], payload.zoom);
      }

      if (payload.simulate && payload.path.length >= 2) {
        var t = 0;
        var dir = 1;
        simTimer = setInterval(function () {
          t += (payload.navGuide ? 0.0028 : 0.004) * dir;
          if (t >= 1) { t = 1; dir = -1; }
          if (t <= 0) { t = 0; dir = 1; }
          var pos = pointAlong(payload.path, t);
          riderMarker.setLatLng([pos.lat, pos.lng]);
          if (payload.navGuide || !INTERACTIVE) {
            map.setView([pos.lat, pos.lng], payload.navGuide ? 17 : map.getZoom(), { animate: false });
          }
        }, 80);
      }
    }

    window.__TransChapApplyMapUpdate = applyUpdate;

    function init() {
      map = L.map('map', {
        zoomControl: INTERACTIVE,
        attributionControl: true,
        dragging: INTERACTIVE,
        scrollWheelZoom: INTERACTIVE,
        doubleClickZoom: INTERACTIVE,
        boxZoom: INTERACTIVE,
        keyboard: INTERACTIVE,
        tap: INTERACTIVE,
      }).setView([-1.2921, 36.8219], 14);

      // Standard OSM — sharp labels/roads. Brand via route + pins only.
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage('map-ready');
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  </script>
</body>
</html>`;
}

/** Built-in Leaflet map — always available in Expo Go, no Maps API key. */
export function NativeWebMap({
  variant,
  path = [],
  interactive = false,
  simulateRide = false,
  navGuide = false,
  onLoad,
}: Props) {
  const webRef = useRef<WebView>(null);
  const mapReadyRef = useRef(false);
  const pendingUpdateRef = useRef<MapUpdatePayload | null>(null);

  const html = useMemo(() => buildShellHtml(interactive), [interactive]);

  const updatePayload = useMemo(
    () => buildUpdatePayload(variant, path, simulateRide, navGuide),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      variant,
      simulateRide,
      navGuide,
      path.map((p) => `${p.latitude},${p.longitude}`).join('|'),
    ],
  );

  function injectUpdate(payload: MapUpdatePayload) {
    const script = `window.__TransChapApplyMapUpdate && window.__TransChapApplyMapUpdate(${JSON.stringify(
      payload,
    )}); true;`;
    webRef.current?.injectJavaScript(script);
  }

  useEffect(() => {
    mapReadyRef.current = false;
    pendingUpdateRef.current = updatePayload;
  }, [html]);

  useEffect(() => {
    if (!mapReadyRef.current) {
      pendingUpdateRef.current = updatePayload;
      return;
    }
    injectUpdate(updatePayload);
  }, [updatePayload]);

  return (
    <WebView
      ref={webRef}
      originWhitelist={['*']}
      source={{ html }}
      style={styles.web}
      scrollEnabled={false}
      bounces={false}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      allowsInlineMediaPlayback
      mixedContentMode="always"
      onMessage={(e) => {
        if (e.nativeEvent.data === 'map-ready') {
          mapReadyRef.current = true;
          const pending = pendingUpdateRef.current ?? updatePayload;
          pendingUpdateRef.current = null;
          injectUpdate(pending);
          onLoad?.();
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  web: {
    flex: 1,
    backgroundColor: TRANSCHAP_MAP_COLORS.cream100,
  },
});
