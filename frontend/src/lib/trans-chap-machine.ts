export const TRANS_CHAP_MACHINE_ATTR = "data-trans-chap-machine";

export type TransChapMachine = "phone" | "tablet";

/** iPad mini and up have a shortest screen edge of at least 600 CSS pixels. */
const TABLET_SHORTEST_EDGE = 600;
const TABLET_MIN_VIEWPORT_WIDTH = 768;
const TABLET_MIN_VIEWPORT_HEIGHT = 600;

export function detectTransChapMachine(): TransChapMachine {
  if (typeof window === "undefined") return "phone";
  const shortest = Math.min(window.screen.width, window.screen.height);
  const roomy =
    window.innerWidth >= TABLET_MIN_VIEWPORT_WIDTH &&
    window.innerHeight >= TABLET_MIN_VIEWPORT_HEIGHT;
  return shortest >= TABLET_SHORTEST_EDGE && roomy ? "tablet" : "phone";
}

export function syncTransChapMachine(
  machine = detectTransChapMachine(),
): TransChapMachine {
  document.documentElement.setAttribute(TRANS_CHAP_MACHINE_ATTR, machine);
  return machine;
}

export const transChapMachineInit = `(function(){try{var s=Math.min(screen.width,screen.height);var t=s>=${TABLET_SHORTEST_EDGE}&&innerWidth>=${TABLET_MIN_VIEWPORT_WIDTH}&&innerHeight>=${TABLET_MIN_VIEWPORT_HEIGHT};document.documentElement.setAttribute("${TRANS_CHAP_MACHINE_ATTR}",t?"tablet":"phone");}catch(e){document.documentElement.setAttribute("${TRANS_CHAP_MACHINE_ATTR}","phone");}})();`;
