"use client";

import {
  addDays,
  daysBetween,
  MAX_CUSTOM_RANGE_DAYS,
  RANGE_PRESET_LABELS,
  rangeForPreset,
  type DateRange,
  type RangePreset,
} from "@/lib/trans-chap-range";

type Props = {
  value: DateRange;
  onChange: (next: DateRange) => void;
  todayKey: string;
  presets: RangePreset[];
  /** Oldest day with data, used by the "all" preset. */
  earliestKey?: string | null;
  className?: string;
};

export function TransChapRangeFilter({
  value,
  onChange,
  todayKey,
  presets,
  earliestKey,
  className,
}: Props) {
  function pick(preset: RangePreset) {
    if (preset === "custom") {
      onChange({ ...value, preset });
      return;
    }
    onChange(rangeForPreset(preset, todayKey, earliestKey));
  }

  function setEdge(edge: "from" | "to", picked: string) {
    if (!picked) return;
    let { from, to } = value;
    if (edge === "from") from = picked;
    else to = picked;
    if (from > to) {
      if (edge === "from") to = from;
      else from = to;
    }
    if (daysBetween(from, to) >= MAX_CUSTOM_RANGE_DAYS) {
      if (edge === "from") to = addDays(from, MAX_CUSTOM_RANGE_DAYS - 1);
      else from = addDays(to, -(MAX_CUSTOM_RANGE_DAYS - 1));
    }
    if (to > todayKey) to = todayKey;
    onChange({ preset: "custom", from, to });
  }

  return (
    <div className={`trans-chap-range${className ? ` ${className}` : ""}`}>
      <div className="trans-chap-range__chips" role="group" aria-label="Date range">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={value.preset === preset ? "is-on" : undefined}
            aria-pressed={value.preset === preset}
            onClick={() => pick(preset)}
          >
            {preset === "custom" ? (
              <i className="fa-regular fa-calendar" aria-hidden />
            ) : null}
            {RANGE_PRESET_LABELS[preset]}
          </button>
        ))}
      </div>

      {value.preset === "custom" ? (
        <div className="trans-chap-range__custom">
          <label>
            <span>From</span>
            <input
              type="date"
              value={value.from}
              max={todayKey}
              onChange={(e) => setEdge("from", e.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={value.to}
              min={value.from}
              max={todayKey}
              onChange={(e) => setEdge("to", e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
