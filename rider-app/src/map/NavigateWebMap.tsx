import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ColorScheme } from '@/src/theme';
import type { LatLng } from '@/src/map/tripLocations';

type Props = {
  path: LatLng[];
  progress: number;
  bearing: number;
  scheme: ColorScheme;
  onReady?: () => void;
};

const BRAND = {
  light: {
    bg: '#F3F0EA',
    route: '#3D4732',
    routeHalo: '#ECEFE8',
    rider: '#3D4732',
    riderStroke: '#FAF8F4',
    glow: '#3D4732',
    attribBg: 'rgba(243,240,234,0.88)',
    attribFg: '#7A756C',
    attribLink: '#3D4732',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  },
  dark: {
    bg: '#121410',
    route: '#A8B89A',
    routeHalo: '#2A3324',
    rider: '#A8B89A',
    riderStroke: '#F3F0EA',
    glow: '#A8B89A',
    attribBg: 'rgba(18,20,16,0.88)',
    attribFg: '#A8A299',
    attribLink: '#A8B89A',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark',
  },
} as const;

/** Pitched nav map with TransChap olive/cream branding for light & dark. */
export function NavigateWebMap({ path, progress, bearing, scheme, onReady }: Props) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const brand = BRAND[scheme];

  const html = useMemo(() => {
    const initial = path.map((p) => [p.longitude, p.latitude]);
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { margin:0; padding:0; width:100%; height:100%; background:${brand.bg}; overflow:hidden; }
    .maplibregl-ctrl-attrib {
      font-size: 9px !important;
      background: ${brand.attribBg} !important;
      color: ${brand.attribFg} !important;
      border-radius: 8px 0 0 0;
    }
    .maplibregl-ctrl-attrib a { color: ${brand.attribLink} !important; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    var map = null;
    var ready = false;
    var ROUTE = ${JSON.stringify(initial)};
    var ROUTE_COLOR = '${brand.route}';
    var ROUTE_HALO = '${brand.routeHalo}';
    var RIDER = '${brand.rider}';
    var RIDER_STROKE = '${brand.riderStroke}';
    var GLOW = '${brand.glow}';

    function ensureRoute() {
      if (!map.getSource('route')) {
        map.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ROUTE } }
        });
        map.addLayer({
          id: 'route-halo',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ROUTE_HALO, 'line-width': 14, 'line-opacity': 0.9 }
        });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ROUTE_COLOR, 'line-width': 7, 'line-opacity': 0.98 }
        });
      }
      if (!map.getSource('rider')) {
        map.addSource('rider', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: ROUTE[0] || [36.8, -1.29] }, properties: {} }
        });
        map.addLayer({
          id: 'rider-glow',
          type: 'circle',
          source: 'rider',
          paint: {
            'circle-radius': 18,
            'circle-color': GLOW,
            'circle-opacity': 0.22,
            'circle-blur': 0.55
          }
        });
        map.addLayer({
          id: 'rider-dot',
          type: 'circle',
          source: 'rider',
          paint: {
            'circle-radius': 9,
            'circle-color': RIDER_STROKE,
            'circle-stroke-width': 4,
            'circle-stroke-color': RIDER
          }
        });
      }
    }

    function pointAlong(coords, t) {
      if (!coords.length) return [36.8, -1.29];
      if (coords.length === 1) return coords[0];
      t = Math.max(0, Math.min(1, t));
      function dist(a, b) {
        var R = 6371000, toRad = function(d){return d*Math.PI/180};
        var dLat = toRad(b[1]-a[1]), dLng = toRad(b[0]-a[0]);
        var lat1 = toRad(a[1]), lat2 = toRad(b[1]);
        var h = Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)*Math.sin(dLng/2);
        return 2*R*Math.asin(Math.sqrt(h));
      }
      var total = 0;
      for (var i = 1; i < coords.length; i++) total += dist(coords[i-1], coords[i]);
      if (total <= 0) return coords[0];
      var remain = total * t;
      for (var j = 1; j < coords.length; j++) {
        var seg = dist(coords[j-1], coords[j]);
        if (remain <= seg || j === coords.length - 1) {
          var r = seg > 0 ? remain / seg : 0;
          return [
            coords[j-1][0] + (coords[j][0] - coords[j-1][0]) * r,
            coords[j-1][1] + (coords[j][1] - coords[j-1][1]) * r
          ];
        }
        remain -= seg;
      }
      return coords[coords.length - 1];
    }

    window.__TransChapNavUpdate = function(progress, bearing, pathCoords) {
      if (!ready || !map) return;
      if (pathCoords && pathCoords.length >= 2) {
        ROUTE = pathCoords;
        if (map.getSource('route')) {
          map.getSource('route').setData({
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: ROUTE }
          });
        }
      }
      ensureRoute();
      var pos = pointAlong(ROUTE, progress);
      if (map.getSource('rider')) {
        map.getSource('rider').setData({
          type: 'Feature', properties: {},
          geometry: { type: 'Point', coordinates: pos }
        });
      }
      map.easeTo({
        center: pos,
        zoom: 17.1,
        pitch: 56,
        bearing: bearing,
        duration: 280,
        essential: true
      });
    };

    map = new maplibregl.Map({
      container: 'map',
      style: '${brand.styleUrl}',
      center: ROUTE[0] || [36.8012, -1.2934],
      zoom: 15.5,
      pitch: 56,
      bearing: 0,
      attributionControl: true,
      interactive: false
    });

    map.on('load', function() {
      ready = true;
      ensureRoute();
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('nav-ready');
      window.__TransChapNavUpdate(0, 0, ROUTE);
    });
  </script>
</body>
</html>`;
  }, [brand, path]);

  useEffect(() => {
    readyRef.current = false;
  }, [html]);

  useEffect(() => {
    if (!readyRef.current) return;
    const coords = path.map((p) => [p.longitude, p.latitude]);
    const script = `window.__TransChapNavUpdate && window.__TransChapNavUpdate(${progress},${bearing},${JSON.stringify(
      coords,
    )}); true;`;
    webRef.current?.injectJavaScript(script);
  }, [progress, bearing, path]);

  return (
    <View style={[styles.root, { backgroundColor: brand.bg }]}>
      <WebView
        key={scheme}
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        style={[styles.web, { backgroundColor: brand.bg }]}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        onMessage={(e) => {
          if (e.nativeEvent.data === 'nav-ready') {
            readyRef.current = true;
            onReady?.();
            const coords = path.map((p) => [p.longitude, p.latitude]);
            webRef.current?.injectJavaScript(
              `window.__TransChapNavUpdate && window.__TransChapNavUpdate(${progress},${bearing},${JSON.stringify(
                coords,
              )}); true;`,
            );
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
});
