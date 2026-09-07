import { toBlob } from "html-to-image";

const SLIP_PAPER = "#f6eee3";
const SHARE_CLASS = "is-sharing";

export function receiptPngFileName(orderNumber: string): string {
  return `receipt-${orderNumber.replace(/[^\w.-]+/g, "-")}.png`;
}

export async function captureReceiptPng(node: HTMLElement, orderNumber: string): Promise<File> {
  node.classList.add(SHARE_CLASS);
  try {
    const blob = await toBlob(node, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: SLIP_PAPER,
      // html-to-image reads cssRules on every sheet; Google Fonts / Font Awesome
      // are cross-origin and throw SecurityError. Computed styles already copy
      // the family stack (Satoshi, Outfit, system-ui) onto the clone.
      skipFonts: true,
    });
    if (!blob) {
      throw new Error("empty receipt image");
    }
    return new File([blob], receiptPngFileName(orderNumber), { type: "image/png" });
  } finally {
    node.classList.remove(SHARE_CLASS);
  }
}

export function canShareFiles(file: File): boolean {
  const data: ShareData = { files: [file], title: file.name };
  try {
    return typeof navigator.canShare === "function" && navigator.canShare(data);
  } catch {
    return false;
  }
}

/**
 * Start a native share with the file attached. Must run inside a click handler.
 * Files-only: Android WhatsApp drops the PDF if `text` is sent alongside it.
 */
export function startFileShare(file: File): Promise<void> | null {
  const data: ShareData = { files: [file], title: file.name };
  if (!canShareFiles(file) || typeof navigator.share !== "function") return null;
  return navigator.share(data);
}

/** Open a URL from a click handler without replacing the current page. */
export function openExternalUrl(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
