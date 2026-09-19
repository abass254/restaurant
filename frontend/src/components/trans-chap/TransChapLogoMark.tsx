type TransChapLogoMarkProps = {
  size?: number;
  className?: string;
  color?: string;
  accentColor?: string;
};

/** DukAI logo mark for Trans Chap (orange variant). */
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
        d="M24 28 L24 24 A3 3 0 0 1 30 24 L30 28"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M34 28 L34 24 A3 3 0 0 1 40 24 L40 28"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M16 34 A6 6 0 0 1 22 28 L42 28 A6 6 0 0 1 48 34 L48 48 A6 6 0 0 1 42 54 L24 54 L12 62 L16 50 Z"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        fill={color}
        d="M32 34 C32.7 38.9 34.1 40.3 39 41 C34.1 41.7 32.7 43.1 32 48 C31.3 43.1 29.9 41.7 25 41 C29.9 40.3 31.3 38.9 32 34 Z"
      />

      <path
        fill={accentColor}
        d="M42 32 C42.3 34.1 42.9 34.7 45 35 C42.9 35.3 42.3 35.9 42 38 C41.7 35.9 41.1 35.3 39 35 C41.1 34.7 41.7 34.1 42 32 Z"
      />
    </svg>
  );
}
