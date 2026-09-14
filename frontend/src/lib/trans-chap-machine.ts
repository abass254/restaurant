export const TRANS_CHAP_MACHINE_ATTR = "data-trans-chap-machine";

export type TransChapMachine = "phone" | "tablet";

/**
 * Phones keep the compact chrome (even in landscape).
 * iPad mini and up have a shortest screen edge of at least 600 CSS pixels.
 * Computers / tablets use the full-width sidebar shell when the viewport is wide enough.
 */
const PHONE_SHORTEST_EDGE = 600;
const TABLET_MIN_VIEWPORT_WIDTH = 768;

export function detectTransChapMachine(): TransChapMachine {
  if (typeof window === "undefined") return "phone";
  const shortest = Math.min(window.screen.width, window.screen.height);
  const isPhoneHardware = shortest < PHONE_SHORTEST_EDGE;
  if (isPhoneHardware) return "phone";
  return window.innerWidth >= TABLET_MIN_VIEWPORT_WIDTH ? "tablet" : "phone";
}

export function syncTransChapMachine(
  machine = detectTransChapMachine(),
): TransChapMachine {
  document.documentElement.setAttribute(TRANS_CHAP_MACHINE_ATTR, machine);
  return machine;
}

export const transChapMachineInit = `(function(){try{var s=Math.min(screen.width,screen.height);var t=s>=${PHONE_SHORTEST_EDGE}&&innerWidth>=${TABLET_MIN_VIEWPORT_WIDTH};document.documentElement.setAttribute("${TRANS_CHAP_MACHINE_ATTR}",t?"tablet":"phone");}catch(e){document.documentElement.setAttribute("${TRANS_CHAP_MACHINE_ATTR}","phone");}})();`;
