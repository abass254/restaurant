#!/usr/bin/env node
// Regenerates every logo/icon asset from the chef-hat + lightning mark.
// Usage: node scripts/generate-brand-icons.mjs

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(join(root, "frontend/package.json"))("sharp");

const BRAND = "TransChap";
const NAVY = "#0b2545";
const CREAM = "#f8e9dc";

// Geometry lives in a 64x64 grid.
const HAT_SHAPES = `
        <circle cx="21.5" cy="31" r="8"/>
        <circle cx="31" cy="22" r="9.5"/>
        <circle cx="41" cy="29" r="8.5"/>
        <path d="M22 27h20v16H22z"/>
        <rect x="21" y="45.5" width="22" height="6.5" rx="1.8"/>`;
const HAT_ROTATE = "rotate(-6 32 32)";
const PLEATS = "M27 33.5v8M31.5 32.5v9";
const BOLT = "M49 6.8 35.4 25.2l6 .7-7.4 16.8 19.6-23.4-6.6-.2z";
const SPARKLE = "M14 11.2Q14.6 14 17.4 14.6Q14.6 15.2 14 18Q13.4 15.2 10.6 14.6Q13.4 14 14 11.2z";
const MARK_VIEWBOX = "6 1.5 56 56";
// Tight crop around hat + bolt so the favicon fills the tab slot.
const FAVICON_VIEWBOX = "10 5.6 47.8 47.8";

function appIcon({ rounded = true, contentScale = 1 } = {}) {
  const rx = rounded ? ' rx="112"' : "";
  const content =
    contentScale === 1
      ? 'transform="scale(8)"'
      : `transform="translate(256 256) scale(${8 * contentScale}) translate(-32 -32)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="${BRAND}">
  <title>${BRAND}</title>
  <defs>
    <linearGradient id="tc-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fcf3e8"/>
      <stop offset="1" stop-color="#f1dcc4"/>
    </linearGradient>
    <radialGradient id="tc-glow" cx="376" cy="190" r="190" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f6d58a" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#f6d58a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="tc-bolt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6d58a"/>
      <stop offset="1" stop-color="#dea23c"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512"${rx} fill="url(#tc-bg)"/>
  <rect width="512" height="512"${rx} fill="url(#tc-glow)"/>
  <g ${content}>
    <path fill="#d99a2b" d="${SPARKLE}"/>
    <g transform="${HAT_ROTATE}">
      <g fill="${NAVY}">${HAT_SHAPES}
      </g>
      <path d="${PLEATS}" fill="none" stroke="${CREAM}" stroke-width="1.7" stroke-linecap="round"/>
    </g>
    <path
      d="${BOLT}"
      fill="url(#tc-bolt)"
      stroke="${NAVY}"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
  </g>
</svg>
`;
}

// Transparent favicon; the hat flips to cream on dark browser chrome.
function favicon({ adaptive = true } = {}) {
  const darkStyle = adaptive
    ? `
    @media (prefers-color-scheme: dark) {
      .tc-hat { fill: ${CREAM}; }
      .tc-pleat { stroke: ${NAVY}; }
    }`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FAVICON_VIEWBOX}" width="512" height="512" role="img" aria-label="${BRAND}">
  <title>${BRAND}</title>
  <style>
    .tc-hat { fill: ${NAVY}; }
    .tc-pleat { stroke: ${CREAM}; }${darkStyle}
  </style>
  <defs>
    <linearGradient id="tc-bolt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6d58a"/>
      <stop offset="1" stop-color="#dea23c"/>
    </linearGradient>
  </defs>
  <g transform="${HAT_ROTATE}">
    <g class="tc-hat">${HAT_SHAPES}
    </g>
    <path class="tc-pleat" d="${PLEATS}" fill="none" stroke-width="1.7" stroke-linecap="round"/>
  </g>
  <path d="${BOLT}" fill="url(#tc-bolt)" stroke="${NAVY}" stroke-width="1.4" stroke-linejoin="round"/>
</svg>
`;
}

// Flat mark on a transparent background: bolt and pleats are knocked out of the hat.
function flatMark({ color, accent, size = 512 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="${size}" height="${size}" role="img" aria-label="${BRAND}">
  <title>${BRAND}</title>
  <defs>
    <mask id="tc-mark" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <g transform="${HAT_ROTATE}">
        <g fill="#fff">${HAT_SHAPES}
        </g>
        <path d="${PLEATS}" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round"/>
      </g>
      <path d="${BOLT}" fill="#000" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
    </mask>
  </defs>
  <rect width="64" height="64" fill="${color}" mask="url(#tc-mark)"/>
  <path d="${BOLT}" fill="${accent}"/>
</svg>
`;
}

function write(rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log("wrote", rel);
}

async function png(svg, rel, size) {
  const path = join(root, rel);
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(size, size)
    .png()
    .toFile(path);
  console.log("wrote", rel);
  return path;
}

async function ico(svg, rel, sizes = [16, 32, 48]) {
  const images = await Promise.all(
    sizes.map((size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()),
  );
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((data, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], entry);
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  write(rel, Buffer.concat([header, ...images]));
}

const icon = appIcon();
const squareIcon = appIcon({ rounded: false });
const maskableIcon = appIcon({ rounded: false, contentScale: 0.8 });
const navyMark = flatMark({ color: NAVY, accent: "#cfae6c" });
const badge = flatMark({ color: "#ffffff", accent: "#ffffff", size: 96 });

const faviconSvg = favicon();
const faviconFlat = favicon({ adaptive: false });

for (const rel of [
  "brand/logo/logo.svg",
  "frontend/public/logo.svg",
  "frontend/public/icons/icon.svg",
  "frontend/public/icons/trans-chap-icon.svg",
]) {
  write(rel, icon);
}
write("frontend/public/icons/favicon.svg", faviconSvg);
write("frontend/src/app/icon.svg", faviconSvg);
write("brand/logo/favicon.svg", faviconSvg);
write("frontend/public/icons/trans-chap-icon-maskable.svg", maskableIcon);
write("brand/logo/logo-mark.svg", navyMark);
write("frontend/public/icons/badge.svg", badge);

await png(icon, "brand/logo/icon-512.png", 512);
await png(navyMark, "brand/logo/logo-mark-512.png", 512);
await png(icon, "frontend/public/icons/icon-192.png", 192);
await png(icon, "frontend/public/icons/icon-512.png", 512);
await png(icon, "frontend/public/icons/logo-256.png", 256);
await png(icon, "frontend/public/icons/logo-512.png", 512);
await png(icon, "frontend/public/icons/trans-chap-192.png", 192);
await png(icon, "frontend/public/icons/trans-chap-512.png", 512);
await png(maskableIcon, "frontend/public/icons/trans-chap-512-maskable.png", 512);
await png(squareIcon, "frontend/public/icons/trans-chap-180.png", 180);
await png(squareIcon, "frontend/public/icons/apple-touch-icon.png", 180);
await png(badge, "frontend/public/icons/badge-72.png", 72);
await png(badge, "frontend/public/icons/badge-96.png", 96);
await ico(faviconFlat, "frontend/public/favicon.ico");
await ico(faviconFlat, "frontend/src/app/favicon.ico");
await ico(faviconFlat, "brand/logo/favicon.ico");
