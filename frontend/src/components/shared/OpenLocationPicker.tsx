"use client";

import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { TRANSCHAP_MAP_COLORS } from "@/lib/google-maps-style";
import {
  FALLBACK_CENTER,
  fetchPlaceSuggestions,
  forwardGeocode,
  loadMapLibre,
  MIN_AUTOCOMPLETE_CHARS,
  OPEN_MAP_STYLE_URL,
  parseCoordinateQuery,
  reverseGeocode,
  type LatLng,
  type MapLibreMap,
  type MapLibreMarker,
  type MapViewConfig,
  type PlaceSuggestion,
} from "@/lib/open-map";

type OpenLocationPickerProps = {
  config: MapViewConfig;
  value: string;
  onChange: (text: string) => void;
  onCoordsChange?: (coords: LatLng | null) => void;
  coords?: LatLng | null;
  label?: string;
  placeholder?: string;
  required?: boolean;
  variant?: "inline" | "ride";
  disabled?: boolean;
  hideHint?: boolean;
  showMap?: boolean;
  allowMapPin?: boolean;
  showCurrentLocation?: boolean;
  showStoreLocation?: boolean;
  storeLabel?: string;
  storeCoords?: LatLng | null;
  autoFocus?: boolean;
};

const REVERSE_GEOCODE_DEBOUNCE_MS = 350;

export function OpenLocationPicker({
  config,
  value,
  onChange,
  onCoordsChange,
  coords = null,
  label = "Location",
  placeholder = "Search for a location",
  required = false,
  variant = "inline",
  disabled = false,
  hideHint = false,
  showMap = false,
  allowMapPin = false,
  showCurrentLocation = false,
  showStoreLocation = false,
  storeLabel = "",
  storeCoords = null,
  autoFocus = false,
}: OpenLocationPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const debounceRef = useRef<number | null>(null);
  const reverseDebounceRef = useRef<number | null>(null);
  const skipSuggestionsRef = useRef(false);
  const [mapOpen, setMapOpen] = useState(showMap || Boolean(coords));
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const isRide = variant === "ride";
  const mapVisible = showMap || mapOpen;
  const canToggleMap = allowMapPin && !showMap && !isRide;

  const center: LatLng = {
    lat: coords?.lat ?? config.default_center_lat ?? FALLBACK_CENTER.lat,
    lng: coords?.lng ?? config.default_center_lng ?? FALLBACK_CENTER.lng,
  };
  const zoom = config.default_zoom ?? 11;

  const flyToPin = useCallback((lat: number, lng: number) => {
    markerRef.current?.setLngLat([lng, lat]);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 16 });
  }, []);

  const applySelection = useCallback(
    (placeName: string, lat: number, lng: number) => {
      skipSuggestionsRef.current = true;
      onChange(placeName);
      onCoordsChange?.({ lat, lng });
      setSuggestions([]);
      setDropdownOpen(false);
      setActiveIndex(-1);
      flyToPin(lat, lng);
    },
    [flyToPin, onChange, onCoordsChange],
  );

  const closeDropdown = useCallback(() => {
    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
    setLoadingSuggestions(false);
  }, []);

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [autoFocus]);

  useEffect(() => {
    if (!mapVisible || !containerRef.current) return;
    let cancelled = false;

    void loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: OPEN_MAP_STYLE_URL,
          center: [center.lng, center.lat],
          zoom: coords ? 16 : zoom,
          attributionControl: true,
        });
        const marker = new maplibregl.Marker({
          color: TRANSCHAP_MAP_COLORS.primary,
          draggable: !disabled,
        })
          .setLngLat([center.lng, center.lat])
          .addTo(map);

        mapRef.current = map;
        markerRef.current = marker;

        const applyPoint = (lat: number, lng: number) => {
          skipSuggestionsRef.current = true;
          onCoordsChange?.({ lat, lng });
          closeDropdown();
          if (reverseDebounceRef.current) {
            window.clearTimeout(reverseDebounceRef.current);
          }
          reverseDebounceRef.current = window.setTimeout(() => {
            void reverseGeocode(lng, lat).then((place) => {
              if (cancelled) return;
              onChange(place || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
            });
          }, REVERSE_GEOCODE_DEBOUNCE_MS);
        };

        map.on("load", () => {
          if (cancelled) return;
          setReady(true);
          map.resize();
        });
        map.on("click", (event) => {
          if (disabled) return;
          const lngLat = (event as { lngLat?: { lng: number; lat: number } } | undefined)
            ?.lngLat;
          if (!lngLat) return;
          marker.setLngLat([lngLat.lng, lngLat.lat]);
          applyPoint(lngLat.lat, lngLat.lng);
        });
        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          applyPoint(pos.lat, pos.lng);
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Open map failed to load:", error);
          setMapError("Map could not load. You can still search for your location.");
        }
      });

    return () => {
      cancelled = true;
      if (reverseDebounceRef.current) {
        window.clearTimeout(reverseDebounceRef.current);
      }
      markerRef.current?.remove();
      mapRef.current?.remove();
      markerRef.current = null;
      mapRef.current = null;
      setReady(false);
    };
    // Map is created once per visibility toggle; pin moves via flyToPin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, mapVisible]);

  useEffect(() => {
    if (!ready || !coords) return;
    flyToPin(coords.lat, coords.lng);
  }, [coords?.lat, coords?.lng, flyToPin, ready]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < MIN_AUTOCOMPLETE_CHARS || disabled) {
      closeDropdown();
      return;
    }

    if (skipSuggestionsRef.current) {
      skipSuggestionsRef.current = false;
      closeDropdown();
      return;
    }

    setDropdownOpen(true);
    setLoadingSuggestions(true);
    debounceRef.current = window.setTimeout(() => {
      void fetchPlaceSuggestions(trimmed, config)
        .then((items) => {
          setSuggestions(items);
          setDropdownOpen(items.length > 0 || trimmed.length >= MIN_AUTOCOMPLETE_CHARS);
          setActiveIndex(-1);
        })
        .finally(() => setLoadingSuggestions(false));
    }, 280);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, config, disabled, closeDropdown]);

  useEffect(() => {
    function updateDropdownPosition() {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }

    if (dropdownOpen && value.trim().length >= MIN_AUTOCOMPLETE_CHARS) {
      updateDropdownPosition();
      window.addEventListener("resize", updateDropdownPosition);
      window.addEventListener("scroll", updateDropdownPosition, true);
      return () => {
        window.removeEventListener("resize", updateDropdownPosition);
        window.removeEventListener("scroll", updateDropdownPosition, true);
      };
    }
    setDropdownStyle(null);
  }, [dropdownOpen, value, suggestions.length]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      const inSearch = searchWrapRef.current?.contains(target);
      const inDropdown = (target as Element).closest?.(".loc-picker__dropdown");
      if (!inSearch && !inDropdown) {
        setDropdownOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function useStoreLocation() {
    const labelText = storeLabel.trim();
    if (!labelText || disabled) return;
    skipSuggestionsRef.current = true;
    onChange(labelText);
    onCoordsChange?.(storeCoords ?? null);
    closeDropdown();
    if (storeCoords) flyToPin(storeCoords.lat, storeCoords.lng);
  }

  function useMyLocation() {
    if (disabled || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        void reverseGeocode(lng, lat).then((place) => {
          applySelection(place || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng);
          setLocating(false);
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function selectSuggestion(item: PlaceSuggestion) {
    applySelection(item.placeName, item.lat, item.lng);
  }

  async function runSearch() {
    if (!value.trim() || disabled) return;
    skipSuggestionsRef.current = true;
    setSearching(true);
    closeDropdown();
    try {
      const parsed = parseCoordinateQuery(value);
      if (parsed) {
        const place = await reverseGeocode(parsed.lng, parsed.lat);
        applySelection(place ?? value.trim(), parsed.lat, parsed.lng);
        return;
      }
      const result = await forwardGeocode(value, config);
      if (result) {
        applySelection(result.placeName, result.lat, result.lng);
      }
    } finally {
      setSearching(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (dropdownOpen && suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeDropdown();
        return;
      }
      if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        void selectSuggestion(suggestions[activeIndex]);
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  }

  const showDropdown = dropdownOpen && value.trim().length >= MIN_AUTOCOMPLETE_CHARS;
  const dropdown =
    showDropdown && dropdownStyle
      ? createPortal(
          <ul
            id="open-loc-picker-suggestions"
            className="loc-picker__dropdown loc-picker__dropdown--fixed"
            role="listbox"
            style={{
              top: dropdownStyle.top,
              left: dropdownStyle.left,
              width: dropdownStyle.width,
            }}
          >
            {loadingSuggestions && suggestions.length === 0 ? (
              <li className="loc-picker__dropdown-item loc-picker__dropdown-item--status">
                <i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> Searching…
              </li>
            ) : null}
            {!loadingSuggestions && suggestions.length === 0 ? (
              <li className="loc-picker__dropdown-item loc-picker__dropdown-item--status">
                No matches found
              </li>
            ) : null}
            {suggestions.map((item, index) => (
              <li key={item.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className={`loc-picker__dropdown-item${
                    index === activeIndex ? " is-active" : ""
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void selectSuggestion(item)}
                >
                  <i className="fas fa-map-pin" aria-hidden="true" />
                  <span className="loc-picker__dropdown-text">
                    <strong>{item.mainText}</strong>
                    {item.secondaryText ? (
                      <span className="loc-picker__dropdown-sub">{item.secondaryText}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  const controlClassName = isRide
    ? `ride-stop__control loc-picker__search-wrap${
        showStoreLocation || showCurrentLocation ? " ride-stop__control--locate" : ""
      }`
    : "loc-picker__control loc-picker__control--search loc-picker__search-wrap";

  return (
    <div className={isRide ? "ride-stop" : "loc-picker"}>
      <span className={isRide ? "sr-only" : "loc-picker__label"}>{label}</span>
      <span ref={searchWrapRef} className={controlClassName}>
        {!isRide ? <i className="fas fa-location-dot" aria-hidden="true" /> : null}
        <input
          ref={inputRef}
          type="text"
          required={required}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            onCoordsChange?.(null);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 && value.trim().length >= MIN_AUTOCOMPLETE_CHARS) {
              setDropdownOpen(true);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="open-loc-picker-suggestions"
          aria-label={isRide ? label : undefined}
        />
        {!isRide ? (
          <button
            type="button"
            className="loc-picker__action"
            onClick={() => void runSearch()}
            disabled={searching || !value.trim() || disabled}
            aria-label="Search location"
          >
            <i
              className={`fas ${searching ? "fa-circle-notch fa-spin" : "fa-magnifying-glass"}`}
              aria-hidden="true"
            />
          </button>
        ) : null}
        {isRide && showStoreLocation ? (
          <button
            type="button"
            className="ride-stop__locate"
            onClick={useStoreLocation}
            disabled={disabled || !storeLabel.trim()}
            aria-label="Use store location for pickup"
            title="Use store location"
          >
            <i className="fas fa-store" aria-hidden="true" />
          </button>
        ) : null}
        {isRide && showCurrentLocation ? (
          <button
            type="button"
            className="ride-stop__locate"
            onClick={useMyLocation}
            disabled={disabled || locating}
            aria-label="Use my current location for pickup"
            title="Use my current location"
          >
            <i
              className={`fas ${locating ? "fa-circle-notch fa-spin" : "fa-crosshairs"}`}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </span>
      {dropdown}

      {canToggleMap ? (
        <button
          type="button"
          className="loc-picker__pin-toggle"
          onClick={() => setMapOpen((open) => !open)}
          disabled={disabled}
          aria-expanded={mapVisible}
        >
          <i className={`fas ${mapVisible ? "fa-chevron-up" : "fa-map-location-dot"}`} aria-hidden="true" />
          {mapVisible ? "Hide map" : "Pin on map"}
        </button>
      ) : null}

      {mapVisible ? (
        <span className="loc-picker__map">
          <div ref={containerRef} className="loc-picker__canvas" />
          {!ready && !mapError ? (
            <span className="loc-picker__overlay">
              <i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> Loading map…
            </span>
          ) : null}
          {mapError ? <span className="loc-picker__overlay">{mapError}</span> : null}
        </span>
      ) : (
        <div ref={containerRef} className="sr-only" aria-hidden="true" />
      )}

      {!hideHint && !isRide ? (
        <span className="loc-picker__hint">
          {showCurrentLocation ? (
            <button
              type="button"
              className="loc-picker__locate"
              onClick={useMyLocation}
              disabled={disabled || locating}
            >
              <i
                className={`fas ${locating ? "fa-circle-notch fa-spin" : "fa-crosshairs"}`}
                aria-hidden="true"
              />{" "}
              Use my current location
            </button>
          ) : null}
          <span>
            {mapVisible
              ? `Type at least ${MIN_AUTOCOMPLETE_CHARS} characters for suggestions, or tap the map to pin your spot.`
              : `Type at least ${MIN_AUTOCOMPLETE_CHARS} characters for suggestions${
                  canToggleMap ? ", or pin on the map" : ""
                }.`}
          </span>
        </span>
      ) : null}
    </div>
  );
}
