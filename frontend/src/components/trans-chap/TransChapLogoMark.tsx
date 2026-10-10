type TransChapLogoMarkProps = {
  size?: number;
  className?: string;
  color?: string;
  accentColor?: string;
};

/** Distinct Trans Chap mark: receipt + chapchap lightning (not the DukAI bag). */
export function TransChapLogoMark({
  size = 52,
  className,
  color = "currentColor",
  accentColor = "#e8412a",
}: TransChapLogoMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M15 11h24a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4z"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M20 22h14M20 30h14M20 38h8"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        fill={accentColor}
        d="M46 6 34 30h9L36 58l18-30h-9L54 6z"
      />
    </svg>
  );
}
