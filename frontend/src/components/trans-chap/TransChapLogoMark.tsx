import { useId } from "react";

type TransChapLogoMarkProps = {
  size?: number;
  className?: string;
  color?: string;
  accentColor?: string;
};

const BOLT = "M49 6.8 35.4 25.2l6 .7-7.4 16.8 19.6-23.4-6.6-.2z";

/** TransChap mark: chef hat struck by a lightning bolt. */
export function TransChapLogoMark({
  size = 52,
  className,
  color = "currentColor",
  accentColor = "#be9b58",
}: TransChapLogoMarkProps) {
  const maskId = `tc-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="6 1.5 56 56"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <g transform="rotate(-6 32 32)">
            <g fill="#fff">
              <circle cx="21.5" cy="31" r="8" />
              <circle cx="31" cy="22" r="9.5" />
              <circle cx="41" cy="29" r="8.5" />
              <path d="M22 27h20v16H22z" />
              <rect x="21" y="45.5" width="22" height="6.5" rx="1.8" />
            </g>
            <path
              d="M27 33.5v8M31.5 32.5v9"
              fill="none"
              stroke="#000"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </g>
          <path d={BOLT} fill="#000" stroke="#000" strokeWidth="3" strokeLinejoin="round" />
        </mask>
      </defs>
      <rect width="64" height="64" fill={color} mask={`url(#${maskId})`} />
      <path d={BOLT} fill={accentColor} />
    </svg>
  );
}
