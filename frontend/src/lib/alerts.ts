import Swal from "sweetalert2";
import type { SweetAlertOptions } from "sweetalert2";
import { ApiError } from "@/lib/api";
import { notifyNavigationComplete } from "@/lib/navigation-loading";
import { toWhatsAppMsisdn } from "@/lib/whatsapp-phone";

const dukaiSwal = Swal.mixin({
  customClass: {
    popup: "dukai-swal-popup",
    title: "dukai-swal-title",
    htmlContainer: "dukai-swal-text",
    confirmButton: "dukai-swal-btn dukai-swal-btn--confirm",
    cancelButton: "dukai-swal-btn dukai-swal-btn--cancel",
    denyButton: "dukai-swal-btn dukai-swal-btn--cancel",
  },
  buttonsStyling: false,
  confirmButtonText: "OK",
  cancelButtonText: "Cancel",
  reverseButtons: true,
});

function isTransChapUi(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith("/trans-chap");
}

function transChapHost(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  return document.querySelector<HTMLElement>(".trans-chap-app") ?? undefined;
}

function withDialogOptions(options: SweetAlertOptions): SweetAlertOptions {
  if (!isTransChapUi()) return options;
  const host = transChapHost();
  return {
    ...options,
    ...(host ? { target: host } : {}),
    position: "bottom",
    width: "100%",
    scrollbarPadding: false,
    customClass: {
      container: "trans-chap-swal",
      popup: "dukai-swal-popup trans-chap-swal-popup",
      title: "dukai-swal-title trans-chap-swal-title",
      htmlContainer: "dukai-swal-text trans-chap-swal-text",
      confirmButton: "dukai-swal-btn dukai-swal-btn--confirm",
      cancelButton: "dukai-swal-btn dukai-swal-btn--cancel",
      denyButton: "dukai-swal-btn dukai-swal-btn--cancel",
      actions: "trans-chap-swal-actions",
      input: "trans-chap-swal-input",
      validationMessage: "trans-chap-swal-validation",
      ...options.customClass,
    },
    showClass: {
      popup: "trans-chap-swal-sheet-in",
      backdrop: "swal2-backdrop-show",
      icon: "swal2-icon-show",
    },
    hideClass: {
      popup: "trans-chap-swal-sheet-out",
      backdrop: "swal2-backdrop-hide",
      icon: "swal2-icon-hide",
    },
  };
}

function fireDialog(options: SweetAlertOptions) {
  return dukaiSwal.fire(withDialogOptions(options));
}

const TOAST_ICON_HTML = {
  success: '<i class="fa-solid fa-check" aria-hidden="true"></i>',
  error: '<i class="fa-solid fa-xmark" aria-hidden="true"></i>',
  info: '<i class="fa-solid fa-info" aria-hidden="true"></i>',
} as const;

function toastMixin(extra: SweetAlertOptions = {}) {
  const mobile = isTransChapUi();
  const host = mobile ? transChapHost() : undefined;
  const { customClass, ...rest } = extra;
  return Swal.mixin({
    toast: true,
    position: mobile ? "top" : "top-end",
    showConfirmButton: false,
    buttonsStyling: false,
    ...(host ? { target: host } : {}),
    customClass: {
      ...(mobile ? { container: "trans-chap-swal trans-chap-swal--toast" } : {}),
      popup: mobile
        ? "dukai-swal-toast dukai-swal-popup trans-chap-swal-toast"
        : "dukai-swal-toast dukai-swal-popup",
      title: mobile ? "dukai-swal-title trans-chap-swal-toast-title" : "dukai-swal-title",
      htmlContainer: "dukai-swal-text",
      icon: "dukai-swal-toast-icon",
      ...customClass,
    },
    ...(mobile
      ? {
          showClass: { popup: "trans-chap-swal-toast-in" },
          hideClass: { popup: "trans-chap-swal-toast-out" },
        }
      : {}),
    ...rest,
  });
}

/** User-facing copy for unexpected failures (never surface backend/log detail). */
export const INTERNAL_ERROR_TITLE = "Internal error";
export const INTERNAL_ERROR_TEXT = "Please try again.";

export function internalErrorMessage(): string {
  return "Internal error. Please try again.";
}

export async function showInternalError() {
  return showError(INTERNAL_ERROR_TITLE, INTERNAL_ERROR_TEXT);
}

export function extractErrorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiError && err.message && !err.message.startsWith("Request failed (")) {
    return err.message;
  }

  if (err instanceof ApiError && err.payload && typeof err.payload === "object") {
    const payload = err.payload as {
      detail?: string | { message?: string; errors?: Record<string, string[]> };
      errors?: Record<string, string[]>;
      message?: string;
    };
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
    if (payload.detail && typeof payload.detail === "object") {
      const detail = payload.detail as {
        message?: string;
        errors?: Record<string, string[]>;
        missing?: string[];
      };
      if (detail.errors) {
        const first = Object.values(detail.errors).flat()[0];
        if (first) return first;
      }
      if (detail.message) {
        if (Array.isArray(detail.missing) && detail.missing.length) {
          return `${detail.message} ${detail.missing.join("; ")}.`;
        }
        return detail.message;
      }
    }
    if (payload.errors) {
      const first = Object.values(payload.errors).flat()[0];
      if (first) return first;
    }
    if (payload.message) return payload.message;
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return fallback;
}

export async function showError(title: string, text?: string) {
  return fireDialog({
    icon: "error",
    title,
    text,
  });
}

export async function showSuccess(title: string, text?: string) {
  return fireDialog({
    icon: "success",
    title,
    text,
  });
}

export async function showWarning(title: string, text?: string) {
  return fireDialog({
    icon: "warning",
    title,
    text,
  });
}

export async function showInfo(title: string, text?: string) {
  return fireDialog({
    icon: "info",
    title,
    text,
  });
}

export async function confirmAction(
  title: string,
  text: string,
  confirmText = "Yes, continue",
) {
  const result = await fireDialog({
    icon: "question",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
  });

  return result.isConfirmed;
}

export async function promptPendingStk(): Promise<"resend" | "check" | null> {
  const result = await fireDialog({
    icon: "question",
    title: "M-PESA is still waiting",
    text: "The customer hasn’t finished on their phone. Check if they already paid, or send the prompt again.",
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: "Send prompt again",
    denyButtonText: "Check if paid",
    cancelButtonText: "Close",
  });
  if (result.isConfirmed) return "resend";
  if (result.isDenied) return "check";
  return null;
}

export async function promptVoidReason(
  title: string,
  text: string,
  confirmText: string,
) {
  const result = await fireDialog({
    icon: "warning",
    title,
    text,
    input: "textarea",
    inputLabel: "Reason",
    inputPlaceholder: "e.g. Wrong item, customer changed mind…",
    inputAttributes: {
      maxlength: "1000",
      "aria-label": "Reason",
    },
    showCancelButton: true,
    confirmButtonText: confirmText,
    preConfirm: (value) => {
      const reason = String(value ?? "").trim();
      if (!reason) {
        dukaiSwal.showValidationMessage("Enter a reason.");
        return false;
      }
      if (reason.length < 3) {
        dukaiSwal.showValidationMessage("Reason must be at least 3 characters.");
        return false;
      }
      return reason;
    },
  });

  if (!result.isConfirmed || !result.value) {
    return null;
  }
  return String(result.value).trim();
}

export async function promptRejectReason(
  title = "Reject this order?",
  text = "Tell the customer why this order is being rejected.",
) {
  const result = await fireDialog({
    icon: "warning",
    title,
    text,
    input: "textarea",
    inputLabel: "Rejection reason",
    inputPlaceholder: "e.g. Out of stock, closed for the day, can't deliver to that area…",
    inputAttributes: {
      maxlength: "1000",
      "aria-label": "Rejection reason",
    },
    showCancelButton: true,
    confirmButtonText: "Reject order",
    preConfirm: (value) => {
      const reason = String(value ?? "").trim();
      if (!reason) {
        dukaiSwal.showValidationMessage("Enter a reason for rejecting this order.");
        return false;
      }
      if (reason.length < 3) {
        dukaiSwal.showValidationMessage("Reason must be at least 3 characters.");
        return false;
      }
      return reason;
    },
  });

  if (!result.isConfirmed || !result.value) {
    return null;
  }
  return String(result.value).trim();
}

export async function promptMpesaReceipt(
  title = "Confirm M-PESA payment",
  text = "Enter the M-PESA transaction code from the customer's SMS.",
) {
  const result = await fireDialog({
    icon: "question",
    title,
    text,
    input: "text",
    inputLabel: "M-PESA transaction code",
    inputPlaceholder: "e.g. QGH7X2ABCD",
    inputAttributes: {
      autocapitalize: "characters",
      autocorrect: "off",
      spellcheck: "false",
    },
    showCancelButton: true,
    confirmButtonText: "Confirm payment",
    preConfirm: (value) => {
      const code = String(value ?? "").trim();
      if (!code) {
        dukaiSwal.showValidationMessage("Enter the M-PESA transaction code.");
        return false;
      }
      return code;
    },
  });

  if (!result.isConfirmed || !result.value) {
    return null;
  }
  return String(result.value).trim();
}

export async function promptWhatsAppPhone(
  title = "Send receipt on WhatsApp",
  text = "Enter the WhatsApp number to send this receipt to.",
  initialValue = "",
  onConfirm?: (phone: string) => void,
) {
  const result = await fireDialog({
    icon: "question",
    title,
    text,
    input: "tel",
    inputLabel: "WhatsApp number",
    inputValue: initialValue,
    inputPlaceholder: "07… or 2547…",
    inputAttributes: {
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
      inputmode: "tel",
      "aria-label": "WhatsApp number",
    },
    showCancelButton: true,
    confirmButtonText: "Open WhatsApp",
    preConfirm: (value) => {
      const phone = String(value ?? "").trim();
      if (!phone) {
        dukaiSwal.showValidationMessage("Enter a WhatsApp number.");
        return false;
      }
      const msisdn = toWhatsAppMsisdn(phone);
      if (!msisdn) {
        dukaiSwal.showValidationMessage("Enter a valid phone number, e.g. 0712 345 678.");
        return false;
      }
      const normalized = `+${msisdn}`;
      onConfirm?.(normalized);
      return normalized;
    },
  });

  if (!result.isConfirmed || !result.value) {
    return null;
  }
  return String(result.value).trim();
}

export async function promptEmail(
  title = "Send receipt by email",
  text = "Enter the customer's email address.",
  initialValue = "",
) {
  const result = await fireDialog({
    icon: "question",
    title,
    text,
    input: "email",
    inputLabel: "Email address",
    inputValue: initialValue,
    inputPlaceholder: "name@example.com",
    inputAttributes: {
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
      inputmode: "email",
      autocomplete: "email",
      "aria-label": "Email address",
    },
    showCancelButton: true,
    confirmButtonText: "Send receipt",
    preConfirm: (value) => {
      const email = String(value ?? "").trim();
      if (!email) {
        dukaiSwal.showValidationMessage("Enter an email address.");
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        dukaiSwal.showValidationMessage("Enter a valid email address.");
        return false;
      }
      return email;
    },
  });

  if (!result.isConfirmed || !result.value) {
    return null;
  }
  return String(result.value).trim();
}

type MpesaTxnDraft = {
  status: string;
  phone_number: string;
  amount: number;
  result_desc: string;
  mpesa_receipt_number: string;
};

export async function promptMpesaTransactionEdit(
  initial: MpesaTxnDraft,
): Promise<MpesaTxnDraft | null> {
  const safeAmount = Number.isFinite(initial.amount) ? initial.amount : 1;
  const result = await fireDialog({
    title: "Edit M-PESA attempt",
    html: `
      <div class="dukai-mpesa-edit">
        <label>
          <span>Status</span>
          <select id="dukai-mpesa-status" class="swal2-select">
            <option value="pending">Awaiting customer</option>
            <option value="success">Paid</option>
            <option value="cancelled">Customer cancelled</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label>
          <span>Phone</span>
          <input id="dukai-mpesa-phone" class="swal2-input" maxlength="20" />
        </label>
        <label>
          <span>Amount</span>
          <input id="dukai-mpesa-amount" type="number" min="1" step="1" class="swal2-input" />
        </label>
        <label>
          <span>Receipt code</span>
          <input id="dukai-mpesa-receipt" class="swal2-input" maxlength="50" />
        </label>
        <label>
          <span>Notes</span>
          <textarea id="dukai-mpesa-notes" class="swal2-textarea" maxlength="500"></textarea>
        </label>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: "Save changes",
    focusConfirm: false,
    didOpen: () => {
      const popup = dukaiSwal.getPopup();
      if (!popup) return;
      const statusEl = popup.querySelector<HTMLSelectElement>("#dukai-mpesa-status");
      const phoneEl = popup.querySelector<HTMLInputElement>("#dukai-mpesa-phone");
      const amountEl = popup.querySelector<HTMLInputElement>("#dukai-mpesa-amount");
      const receiptEl = popup.querySelector<HTMLInputElement>("#dukai-mpesa-receipt");
      const notesEl = popup.querySelector<HTMLTextAreaElement>("#dukai-mpesa-notes");
      if (statusEl) statusEl.value = initial.status || "pending";
      if (phoneEl) phoneEl.value = initial.phone_number || "";
      if (amountEl) amountEl.value = String(Math.max(1, Math.round(safeAmount)));
      if (receiptEl) receiptEl.value = initial.mpesa_receipt_number || "";
      if (notesEl) notesEl.value = initial.result_desc || "";
    },
    preConfirm: () => {
      const popup = dukaiSwal.getPopup();
      if (!popup) return null;
      const statusEl = popup.querySelector<HTMLSelectElement>("#dukai-mpesa-status");
      const phoneEl = popup.querySelector<HTMLInputElement>("#dukai-mpesa-phone");
      const amountEl = popup.querySelector<HTMLInputElement>("#dukai-mpesa-amount");
      const receiptEl = popup.querySelector<HTMLInputElement>("#dukai-mpesa-receipt");
      const notesEl = popup.querySelector<HTMLTextAreaElement>("#dukai-mpesa-notes");
      const status = (statusEl?.value ?? "pending").trim();
      const phone = (phoneEl?.value ?? "").trim();
      const amount = Number(amountEl?.value ?? "0");
      const receipt = (receiptEl?.value ?? "").trim();
      const notes = (notesEl?.value ?? "").trim();

      if (!phone) {
        dukaiSwal.showValidationMessage("Phone is required.");
        return false;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        dukaiSwal.showValidationMessage("Enter a valid amount.");
        return false;
      }
      return {
        status,
        phone_number: phone,
        amount: Math.round(amount),
        result_desc: notes,
        mpesa_receipt_number: receipt,
      };
    },
  });

  if (!result.isConfirmed || !result.value) {
    return null;
  }
  return result.value as MpesaTxnDraft;
}

export async function toastSuccess(title: string, durationMs = 3200) {
  return toastMixin({
    timer: durationMs,
    timerProgressBar: true,
    showCloseButton: durationMs >= 10000,
  }).fire({ icon: "success", iconHtml: TOAST_ICON_HTML.success, title });
}

export async function toastError(title: string) {
  return toastMixin({
    timer: 4000,
    timerProgressBar: true,
  }).fire({ icon: "error", iconHtml: TOAST_ICON_HTML.error, title });
}

export async function toastInfo(title: string, text?: string, durationMs = 4200) {
  return toastMixin({
    timer: durationMs,
    timerProgressBar: true,
  }).fire({ icon: "info", iconHtml: TOAST_ICON_HTML.info, title, text });
}

let loadingToastOpen = false;

function closeLoadingToastOnly() {
  if (!loadingToastOpen) return;
  loadingToastOpen = false;
  Swal.close();
}

export async function toastLoading(title = "Loading…") {
  closeLoadingToastOnly();

  const mobile = isTransChapUi();
  const label = title.replace(/[<>&"]/g, (ch) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch] ?? ch,
  );
  loadingToastOpen = true;

  if (mobile) {
    const host = transChapHost();
    return Swal.fire({
      toast: false,
      ...(host ? { target: host } : {}),
      position: "center",
      width: "auto",
      backdrop: true,
      allowOutsideClick: false,
      allowEscapeKey: false,
      allowEnterKey: false,
      showConfirmButton: false,
      showCancelButton: false,
      buttonsStyling: false,
      scrollbarPadding: false,
      customClass: {
        container: "trans-chap-swal trans-chap-swal--loading",
        popup: "dukai-swal-popup trans-chap-swal-popup trans-chap-swal-popup--loading",
        htmlContainer: "trans-chap-swal-loading",
      },
      showClass: {
        popup: "trans-chap-swal-loading-in",
        backdrop: "swal2-backdrop-show",
      },
      hideClass: {
        popup: "trans-chap-swal-loading-out",
        backdrop: "swal2-backdrop-hide",
      },
      html: `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>${label}</span>`,
    });
  }

  const Toast = toastMixin({
    timer: undefined,
    timerProgressBar: false,
    position: "bottom",
    customClass: {
      container: "dukai-swal-toast-container dukai-swal-toast-container--loading",
      popup: "dukai-swal-toast dukai-swal-popup dukai-swal-toast--loading",
      htmlContainer: "dukai-swal-toast-loading",
    },
  });

  return Toast.fire({
    html: `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>${label}</span>`,
  });
}

export function dismissLoadingToast() {
  closeLoadingToastOnly();
}

export function finishNavigationLoading() {
  closeLoadingToastOnly();
  notifyNavigationComplete();
}
