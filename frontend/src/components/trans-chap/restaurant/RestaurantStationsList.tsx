"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { extractErrorMessage, showError } from "@/lib/alerts";
import {
  fetchRestaurantStations,
  stationHint,
  stationIcon,
} from "@/lib/trans-chap-product";
import type { RestaurantStationDef } from "@/lib/types";

export function RestaurantStationsList() {
  const [stations, setStations] = useState<RestaurantStationDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchRestaurantStations()
      .then((next) => {
        if (alive) setStations(next);
      })
      .catch((err) => {
        if (alive) void showError("Could not load stations", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <p className="rs-empty">Loading stations…</p>;

  return (
    <div className="ios-settings">
      <div className="ios-settings__groups">
        <section className="ios-settings__group" aria-label="Prep stations">
          <h3 className="ios-settings__caption">Prep stations</h3>
          {stations.length === 0 ? (
            <div className="ios-settings__empty">
              <i className="fa-solid fa-fire-burner" aria-hidden />
              <strong>No stations yet</strong>
              <span>Add prep stations in Settings → Tables & stations.</span>
            </div>
          ) : (
            <div className="ios-settings__card">
              {stations.map((station) => (
                <Link
                  key={station.id}
                  href={`/trans-chap/kitchen?station=${encodeURIComponent(station.id)}`}
                  className="ios-settings__row"
                >
                  <span className="ios-settings__icon ios-settings__icon--inventory" aria-hidden>
                    <i className={`fa-solid ${stationIcon(station)}`} />
                  </span>
                  <span className="ios-settings__label-stack">
                    <strong>{station.label}</strong>
                    <span>{stationHint(station)}</span>
                  </span>
                  <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
                </Link>
              ))}
            </div>
          )}
          <p className="ios-settings__footer">
            Open a station to see its orders, recipes, and prep work. Manage stations in Settings.
          </p>
        </section>
      </div>
    </div>
  );
}
