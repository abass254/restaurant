"use client";

import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  createMapWithMarker,
  fetchPlacePredictions,
  flyTo,
  forwardGeocode,
  latLngFromMarker,
  loadGoogleMaps,
  MIN_AUTOCOMPLETE_CHARS,
  parseCoordinateQuery,
  placePredictionDisplayName,
  resolvePlacePrediction,
  reverseGeocode,
  setMarkerPosition,
  type GoogleMapsMap,
  type GoogleMapsMarker,
  type GoogleMapsRuntime,
  type LatLng,
  type PlacePrediction,
} from "@/lib/google-maps";
import type { GoogleMapsPublicConfig } from "@/lib/types";

type LocationPickerProps = {
  config: GoogleMapsPublicConfig;
  value: string;
  onChange: (text: string) => void;
  onCoordsChange?: (coords: LatLng | null) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  /** `waitlist` matches registration modal styling; `inline` fits dashboard/POS forms. */
  variant?: "waitlist" | "inline" | "ride";
  disabled?: boolean;
  /**
   * When true, the embedded map is always shown (Dynamic Maps session on mount).
   * Prefer false + allowMapPin so Maps JS loads only after “Pin on map”.
   */
  showMap?: boolean;
  /** Offer a toggle that mounts the map on demand when `showMap` is false. */
  allowMapPin?: boolean;
  /** Hide helper text under the field (used in compact ride layouts). */
  hideHint?: boolean;
  /** Show a compact “use current location” control (e.g. pickup in ride UI). */
  showCurrentLocation?: boolean;
  /** Show a compact “use store location” control (e.g. pickup in ride UI). */
  showStoreLocation?: boolean;
  storeLabel?: string;
  storeCoords?: LatLng | null;
  autoFocus?: boolean;
};

const FALLBACK_CENTER: LatLng = { lat: -1.2921, lng: 36.8219 }; // Nairobi
const REVERSE_GEOCODE_DEBOUNCE_MS = 350;

export function LocationPicker({
  config,
  value,
  onChange,
  onCoordsChange,
  label = "Location",
  placeholder = "Search for a location",
  required = false,
  variant = "inline",
  disabled = false,
  showMap = false,
  allowMapPin = true,
  hideHint = false,
  showCurrentLocation = false,
  showStoreLocation = false,
  storeLabel = "",
  storeCoords = null,
  autoFocus = false,
}: LocationPickerProps) {
  const apiKey = config.api_key ?? "";
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLSpanElement>(null);
  const mapRef = useRef<GoogleMapsMap | null>(null);
  const markerRef = useRef<GoogleMapsMarker | null>(null);
  const runtimeRef = useRef<GoogleMapsRuntime | null>(null);
  const debounceRef = useRef<number | null>(null);
  const reverseDebounceRef = useRef<number | null>(null);
  const skipSuggestionsRef = useRef(false);
  const [mapOpen, setMapOpen] = useState(showMap);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [locating, setLocating] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const mapVisible = showMap || mapOpen;
  const canToggleMap = allowMapPin && !showMap && variant !== "ride";

  const center: LatLng = {
    lat: config.default_center_lat ?? FALLBACK_CENTER.lat,
    lng: config.default_center_lng ?? FALLBACK_CENTER.lng,
  };
  const zoom = config.default_zoom ?? 11;

  const applySelection = useCallback(
    (placeName: string, lat: number, lng: number) => {
      skipSuggestionsRef.current = true;
      onChange(placeName);
      onCoordsChange?.({ lat, lng });
      if (markerRef.current) setMarkerPosition(markerRef.current, { lat, lng });
      if (mapRef.current) flyTo(mapRef.current, { lat, lng }, 15);
      setSuggestions([]);
      setDropdownOpen(false);
      setActiveIndex(-1);
    },
    [onChange, onCoordsChange],
  );

  const closeDropdown = useCallback(() => {
    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
    setLoadingSuggestions(false);
  }, []);

  const scheduleReverseGeocode = useCallback(
    (lat: number, lng: number, runtime: GoogleMapsRuntime) => {
      if (reverseDebounceRef.current) {
        window.clearTimeout(reverseDebounceRef.current);
      }
      reverseDebounceRef.current = window.setTimeout(() => {
        void reverseGeocode(lng, lat, runtime).then((place) => {
          if (place) onChange(place);
        });
      }, REVERSE_GEOCODE_DEBOUNCE_MS);
    },
    [onChange],
  );

  useEffect(() => {
    if (showMap) setMapOpen(true);
  }, [showMap]);

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [autoFocus]);

  const initialValueRef = useRef(value);
  useEffect(() => {
    if (ready && initialValueRef.current.trim()) {
      skipSuggestionsRef.current = true;
    }
  }, [ready]);

  useEffect(() => {
    if (!apiKey || disabled) return;
    if (mapVisible) return;

    let cancelled = false;
    void loadGoogleMaps(apiKey)
      .then((runtime) => {
        if (cancelled) return;
        runtimeRef.current = runtime;
        setReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Google Maps failed to load:", error);
          setMapError("Location search could not load.");
        }
      });

    return () => {
      cancelled = true;
      runtimeRef.current = null;
      setReady(false);
    };
  }, [apiKey, disabled, mapVisible]);

  useEffect(() => {
    if (!apiKey || !containerRef.current || disabled || !mapVisible) return;
    let cancelled = false;

    void loadGoogleMaps(apiKey)
      .then((runtime) => {
        if (cancelled || !containerRef.current) return;
        runtimeRef.current = runtime;

        const { map, marker } = createMapWithMarker(
          runtime,
          containerRef.current,
          center,
          zoom,
          !disabled,
        );

        mapRef.current = map;
        markerRef.current = marker;
        setReady(true);

        const applyPoint = (lat: number, lng: number) => {
          skipSuggestionsRef.current = true;
          onCoordsChange?.({ lat, lng });
          scheduleReverseGeocode(lat, lng, runtime);
          closeDropdown();
        };

        map.addListener("click", (event) => {
          if (disabled || !event.latLng) return;
          const lat = event.latLng.lat();
          const lng = event.latLng.lng();
          setMarkerPosition(marker, { lat, lng });
          applyPoint(lat, lng);
        });

        marker.addListener("dragend", () => {
          const pos = latLngFromMarker(marker);
          if (pos) applyPoint(pos.lat, pos.lng);
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Google Maps failed to load:", error);
          setMapError("Map could not load. You can still type your location.");
        }
      });

    return () => {
      cancelled = true;
      if (reverseDebounceRef.current) {
        window.clearTimeout(reverseDebounceRef.current);
      }
      if (markerRef.current) {
        markerRef.current.setMap(null);
      }
      mapRef.current = null;
      markerRef.current = null;
      runtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, disabled, mapVisible]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (!ready || !runtimeRef.current || trimmed.length < MIN_AUTOCOMPLETE_CHARS || disabled) {
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
      void fetchPlacePredictions(trimmed, runtimeRef.current!, {
        country: config.default_country,
        proximity: center,
      })
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
  }, [value, config.default_country, center.lat, center.lng, disabled, ready, closeDropdown]);

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

  async function selectPrediction(prediction: PlacePrediction) {
    if (!runtimeRef.current) return;
    const displayName = placePredictionDisplayName(prediction);
    skipSuggestionsRef.current = true;
    closeDropdown();
    setSearching(true);
    try {
      const result = await resolvePlacePrediction(prediction, runtimeRef.current);
      if (result) {
        applySelection(displayName, result.lat, result.lng);
        return;
      }

      const parsed = parseCoordinateQuery(prediction.description);
      if (parsed) {
        const place = await reverseGeocode(parsed.lng, parsed.lat, runtimeRef.current);
        applySelection(place ?? displayName, parsed.lat, parsed.lng);
        return;
      }

      const fallback = await forwardGeocode(displayName, runtimeRef.current, {
        country: config.default_country,
        proximity: center,
      });
      if (fallback) {
        applySelection(displayName, fallback.lat, fallback.lng);
        return;
      }

      onChange(displayName);
      onCoordsChange?.(null);
      skipSuggestionsRef.current = true;
      closeDropdown();
    } finally {
      setSearching(false);
    }
  }

  async function runSearch() {
    if (!apiKey || !value.trim() || !runtimeRef.current) return;
    skipSuggestionsRef.current = true;
    setSearching(true);
    closeDropdown();
    try {
      const parsed = parseCoordinateQuery(value);
      if (parsed) {
        const place = await reverseGeocode(parsed.lng, parsed.lat, runtimeRef.current);
        applySelection(place ?? value.trim(), parsed.lat, parsed.lng);
        return;
      }

      const result = await forwardGeocode(value, runtimeRef.current, {
        country: config.default_country,
        proximity: center,
      });
      if (result) {
        applySelection(result.placeName, result.lat, result.lng);
      }
    } finally {
      setSearching(false);
    }
  }

  function useStoreLocation() {
    const label = storeLabel.trim();
    if (!label || disabled) return;
    skipSuggestionsRef.current = true;
    onChange(label);
    onCoordsChange?.(storeCoords ?? null);
    if (storeCoords && markerRef.current) {
      setMarkerPosition(markerRef.current, storeCoords);
    }
    if (storeCoords && mapRef.current) {
      flyTo(mapRef.current, storeCoords, 15);
    }
    closeDropdown();
  }

  function useMyLocation() {
    if (!navigator.geolocation || disabled || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        onCoordsChange?.({ lat, lng });
        if (markerRef.current) setMarkerPosition(markerRef.current, { lat, lng });
        if (mapRef.current) flyTo(mapRef.current, { lat, lng }, 15);
        if (runtimeRef.current) {
          scheduleReverseGeocode(lat, lng, runtimeRef.current);
        }
        skipSuggestionsRef.current = true;
        closeDropdown();
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
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
        setDropdownOpen(false);
        setActiveIndex(-1);
        return;
      }
      if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        void selectPrediction(suggestions[activeIndex]);
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  }

  const isWaitlist = variant === "waitlist";
  const isRide = variant === "ride";
  const showDropdown = dropdownOpen && value.trim().length >= MIN_AUTOCOMPLETE_CHARS;

  const dropdown =
    showDropdown && dropdownStyle
      ? createPortal(
          <ul
            id="loc-picker-suggestions"
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
                No locations found
              </li>
            ) : null}
            {suggestions.map((item, index) => (
              <li key={item.placeId} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className={`loc-picker__dropdown-item${
                    index === activeIndex ? " is-active" : ""
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    skipSuggestionsRef.current = true;
                    closeDropdown();
                    void selectPrediction(item);
                  }}
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

  const rootClassName = isWaitlist ? "waitlist-field" : isRide ? "ride-stop" : "loc-picker";
  const labelClassName = isWaitlist
    ? "waitlist-field__label"
    : isRide
      ? "sr-only"
      : "loc-picker__label";
  const controlClassName = isWaitlist
    ? "waitlist-field__control waitlist-field__control--search loc-picker__search-wrap"
    : isRide
      ? `ride-stop__control loc-picker__search-wrap${
          showCurrentLocation || showStoreLocation ? " ride-stop__control--locate" : ""
        }`
      : "loc-picker__control loc-picker__control--search loc-picker__search-wrap";

  return (
    <div className={rootClassName}>
      <span className={labelClassName}>{label}</span>
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
          aria-controls="loc-picker-suggestions"
          aria-label={isRide ? label : undefined}
        />
        {!isRide ? (
          <button
            type="button"
            className={isWaitlist ? "waitlist-field__action" : "loc-picker__action"}
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
          className={isWaitlist ? "waitlist-map__pin-toggle" : "loc-picker__pin-toggle"}
          onClick={() => setMapOpen((open) => !open)}
          disabled={disabled}
          aria-expanded={mapVisible}
        >
          <i className={`fas ${mapVisible ? "fa-chevron-up" : "fa-map-location-dot"}`} aria-hidden="true" />
          {mapVisible ? "Hide map" : "Pin on map"}
        </button>
      ) : null}

      {mapVisible ? (
        <span className={isWaitlist ? "waitlist-map" : "loc-picker__map"}>
          <div
            ref={containerRef}
            className={isWaitlist ? "waitlist-map__canvas" : "loc-picker__canvas"}
          />
          {!ready && !mapError ? (
            <span className={isWaitlist ? "waitlist-map__overlay" : "loc-picker__overlay"}>
              <i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> Loading map…
            </span>
          ) : null}
          {mapError ? (
            <span className={isWaitlist ? "waitlist-map__overlay" : "loc-picker__overlay"}>
              {mapError}
            </span>
          ) : null}
        </span>
      ) : (
        <div ref={containerRef} className="sr-only" aria-hidden="true" />
      )}

      {!hideHint && !isRide ? (
        <span className={isWaitlist ? "waitlist-map__hint" : "loc-picker__hint"}>
          <button
            type="button"
            className={isWaitlist ? "waitlist-map__locate" : "loc-picker__locate"}
            onClick={useMyLocation}
            disabled={disabled || locating}
          >
            <i
              className={`fas ${locating ? "fa-circle-notch fa-spin" : "fa-crosshairs"}`}
              aria-hidden="true"
            />{" "}
            Use my current location
          </button>
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
