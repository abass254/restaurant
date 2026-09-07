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

export async function shareReceiptAttachment(
  file: File,
): Promise<"shared" | "cancelled" | "unsupported"> {
  const data: ShareData = { files: [file] };
  if (
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function" ||
    !navigator.canShare(data)
  ) {
    return "unsupported";
  }
  try {
    await navigator.share(data);
    return "shared";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "cancelled";
    throw err;
  }
}
