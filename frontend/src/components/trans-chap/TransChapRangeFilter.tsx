"use client";

import { useEffect, useState } from "react";
import {
  addDays,
  daysBetween,
  MAX_CUSTOM_RANGE_DAYS,
  type DateRange,
  type RangePreset,
} from "@/lib/trans-chap-range";

type Props = {
  value: DateRange;
  onChange: (next: DateRange) => void;
  todayKey: string;
  presets?: RangePreset[];
  /** Oldest day with data, used by the "all" preset. */
  earliestKey?: string | null;
  className?: string;
};

export function TransChapRangeFilter({
  value,
  onChange,
  todayKey,
  className,
}: Props) {
  const isRangeMode = value.preset === "custom" && value.from !== value.to;
  const [rangeOpen, setRangeOpen] = useState(isRangeMode);
  const [draftFrom, setDraftFrom] = useState(() =>
    value.from === value.to ? addDays(todayKey, -6) : value.from,
  );
  const [draftTo, setDraftTo] = useState(() => value.to || todayKey);

  useEffect(() => {
    if (value.from !== value.to) {
      setDraftFrom(value.from);
      setDraftTo(value.to);
    }
  }, [value.from, value.to]);

  const singleDateValue = !rangeOpen && value.from === value.to ? value.from : todayKey;

  function handleSingleDateChange(picked: string) {
    if (!picked) return;
    const clamped = picked > todayKey ? todayKey : picked;
    setRangeOpen(false);
    onChange({
      preset: clamped === todayKey ? "today" : "custom",
      from: clamped,
      to: clamped,
    });
  }

  function updateDraftEdge(edge: "from" | "to", picked: string) {
    if (!picked) return;
    let from = edge === "from" ? picked : draftFrom;
    let to = edge === "to" ? picked : draftTo;
    if (from > to) {
      if (edge === "from") to = from;
      else from = to;
    }
    if (daysBetween(from, to) >= MAX_CUSTOM_RANGE_DAYS) {
      if (edge === "from") to = addDays(from, MAX_CUSTOM_RANGE_DAYS - 1);
      else from = addDays(to, -(MAX_CUSTOM_RANGE_DAYS - 1));
    }
    if (to > todayKey) to = todayKey;
    setDraftFrom(from);
    setDraftTo(to);
  }

  function applyRange() {
    onChange({ preset: "custom", from: draftFrom, to: draftTo });
  }

  function handleToggleRange() {
    if (!rangeOpen) {
      setRangeOpen(true);
      onChange({ preset: "custom", from: draftFrom, to: draftTo });
    } else {
      applyRange();
    }
  }

  return (
    <div className={`trans-chap-range${className ? ` ${className}` : ""}`}>
      <div className="trans-chap-range__chips" role="group" aria-label="Date filter">
        <label
          className={`trans-chap-sales__chip${!rangeOpen ? " is-active" : ""}`}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}
        >
          <i className="fa-regular fa-calendar" aria-hidden />
          <input
            type="date"
            aria-label="Select date"
            value={singleDateValue}
            max={todayKey}
            onClick={() => {
              if (rangeOpen) {
                setRangeOpen(false);
                onChange({
                  preset: singleDateValue === todayKey ? "today" : "custom",
                  from: singleDateValue,
                  to: singleDateValue,
                });
              }
            }}
            onChange={(e) => handleSingleDateChange(e.target.value)}
            style={{
              border: 0,
              background: "transparent",
              color: "inherit",
              font: "inherit",
              fontSize: "0.78rem",
              fontWeight: 700,
              padding: 0,
              outline: "none",
              cursor: "pointer",
              colorScheme: "dark light",
            }}
          />
        </label>
        <button
          type="button"
          className={rangeOpen ? "is-on" : undefined}
          aria-pressed={rangeOpen}
          onClick={handleToggleRange}
        >
          <i className="fa-solid fa-calendar-week" aria-hidden />
          Get range
        </button>
      </div>

      {rangeOpen ? (
        <div className="trans-chap-range__custom">
          <label>
            <span>From</span>
            <input
              type="date"
              value={draftFrom}
              max={todayKey}
              onChange={(e) => updateDraftEdge("from", e.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={draftTo}
              min={draftFrom}
              max={todayKey}
              onChange={(e) => updateDraftEdge("to", e.target.value)}
            />
          </label>
          <button
            type="button"
            className="trans-chap-sales__chip is-active"
            style={{ gridColumn: "1 / -1", justifyContent: "center", padding: "0.48rem 0.85rem" }}
            onClick={applyRange}
          >
            <i className="fa-solid fa-filter" aria-hidden style={{ marginRight: "0.35rem" }} />
            Get range
          </button>
        </div>
      ) : null}
    </div>
  );
}
