const MAPLIBRE_VERSION = "4.7.1";
const SCRIPT_SRC = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const STYLE_HREF = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;

export type MapLibreLngLat = { lng: number; lat: number };

export type MapLibreMap = {
  on: (event: string, handler: (event?: unknown) => void) => void;
  remove: () => void;
  flyTo: (options: Record<string, unknown>) => void;
  resize: () => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  addLayer: (layer: Record<string, unknown>) => void;
  getLayer: (id: string) => unknown;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: Record<string, unknown>,
  ) => void;
};

export type MapLibreMarker = {
  setLngLat: (lngLat: [number, number]) => MapLibreMarker;
  addTo: (map: MapLibreMap) => MapLibreMarker;
  remove: () => void;
  getLngLat: () => MapLibreLngLat;
  on: (event: string, handler: () => void) => MapLibreMarker;
};

export type MapLibreGl = {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  Marker: new (options?: Record<string, unknown>) => MapLibreMarker;
};

let loaderPromise: Promise<MapLibreGl> | null = null;

function loadStylesheet(): void {
  if (document.querySelector(`link[data-maplibre-gl="${MAPLIBRE_VERSION}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  link.dataset.maplibreGl = MAPLIBRE_VERSION;
  document.head.appendChild(link);
}

export function loadMapLibre(): Promise<MapLibreGl> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MapLibre can only load in the browser."));
  }
  const existing = (window as unknown as { maplibregl?: MapLibreGl }).maplibregl;
  if (existing) {
    loadStylesheet();
    return Promise.resolve(existing);
  }
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<MapLibreGl>((resolve, reject) => {
    loadStylesheet();
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const gl = (window as unknown as { maplibregl?: MapLibreGl }).maplibregl;
      if (gl) resolve(gl);
      else reject(new Error("MapLibre failed to initialise."));
    };
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("Could not load MapLibre GL JS."));
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
}
