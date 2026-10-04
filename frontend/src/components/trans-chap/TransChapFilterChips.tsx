"use client";

export type ChipOption<T extends string> = { id: T; label: string };

/** Single-choice chip group; tapping the active chip clears it back to "all". */
export function TransChapFilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | "all";
  options: ChipOption<T>[];
  onChange: (id: T | "all") => void;
}) {
  return (
    <div className="trans-chap-sales__chips-group" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`trans-chap-sales__chip${value === option.id ? " is-active" : ""}`}
          aria-pressed={value === option.id}
          onClick={() => onChange(value === option.id ? "all" : option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
