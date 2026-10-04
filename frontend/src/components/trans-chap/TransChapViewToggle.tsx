"use client";

import type { TransChapListView } from "@/lib/trans-chap-list-view";

export function TransChapViewToggle({
  view,
  onChange,
  label,
}: {
  view: TransChapListView;
  onChange: (next: TransChapListView) => void;
  label: string;
}) {
  return (
    <div className="trans-chap-sales__view" role="group" aria-label={label}>
      <button
        type="button"
        className={`trans-chap-sales__filter-btn${view === "grid" ? " is-on" : ""}`}
        aria-pressed={view === "grid"}
        aria-label="Grid view"
        title="Grid view"
        onClick={() => onChange("grid")}
      >
        <i className="fa-solid fa-table-cells" aria-hidden />
      </button>
      <button
        type="button"
        className={`trans-chap-sales__filter-btn${view === "list" ? " is-on" : ""}`}
        aria-pressed={view === "list"}
        aria-label="List view"
        title="List view"
        onClick={() => onChange("list")}
      >
        <i className="fa-solid fa-list" aria-hidden />
      </button>
    </div>
  );
}
