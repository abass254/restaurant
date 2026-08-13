"use client";

import { useEffect } from "react";

const ENDPOINT =
  "http://localhost:7479/ingest/bbcc2a2f-58e9-46d1-8437-4c7a9526dc62";
const SESSION_ID = "582009";

function log(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
) {
  // #region agent log
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": SESSION_ID,
    },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      runId: "pre-fix",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export function LegalLayoutProbe() {
  useEffect(() => {
    const body = document.querySelector(".legal-body");
    const main = document.querySelector(".legal-content-wrap");
    const soloRule = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some(
          (rule) =>
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes("legal-content-wrap--solo")
        );
      } catch {
        return false;
      }
    });

    const bodyStyle = body ? getComputedStyle(body) : null;
    const mainRect = main?.getBoundingClientRect();
    const bodyRect = body?.getBoundingClientRect();

    // Hypothesis A: two-column grid leaves empty left column on solo page
    log("A", "LegalLayoutProbe.tsx:mount", "legal-body grid layout", {
      gridTemplateColumns: bodyStyle?.gridTemplateColumns ?? null,
      bodyWidth: bodyRect?.width ?? null,
      mainLeft: mainRect?.left ?? null,
      mainWidth: mainRect?.width ?? null,
      leftGapPx:
        mainRect && bodyRect ? Math.round(mainRect.left - bodyRect.left) : null,
      hasSoloCssRule: soloRule,
      mainClasses: main?.className ?? null,
    });

    // Hypothesis B: ordered lists lack legal-content ol styles
    const ol = document.querySelector(".legal-content ol");
    const olStyle = ol ? getComputedStyle(ol) : null;
    log("B", "LegalLayoutProbe.tsx:mount", "ordered list styles", {
      olFound: Boolean(ol),
      listStyleType: olStyle?.listStyleType ?? null,
      marginLeft: olStyle?.marginLeft ?? null,
      paddingLeft: olStyle?.paddingLeft ?? null,
    });

    // Hypothesis D: legal stylesheet variables missing
    const root = getComputedStyle(document.documentElement);
    log("D", "LegalLayoutProbe.tsx:mount", "legal theme tokens", {
      ufBgLight: root.getPropertyValue("--uf-bg-light").trim() || null,
      ufCardBg: root.getPropertyValue("--uf-card-bg").trim() || null,
      ufPrimary: root.getPropertyValue("--uf-primary").trim() || null,
    });

    // Hypothesis E: content wrap has width constraint
    const mainStyle = main ? getComputedStyle(main) : null;
    const content = document.querySelector(".legal-content");
    const contentStyle = content ? getComputedStyle(content) : null;
    log("E", "LegalLayoutProbe.tsx:mount", "content width constraints", {
      mainMaxWidth: mainStyle?.maxWidth ?? null,
      contentMaxWidth: contentStyle?.maxWidth ?? null,
      contentWidth: content?.getBoundingClientRect().width ?? null,
    });
  }, []);

  return null;
}
