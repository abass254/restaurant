import Swal from "sweetalert2";
import { ApiError } from "@/lib/api";
import { notifyNavigationComplete } from "@/lib/navigation-loading";

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
  return dukaiSwal.fire({
    icon: "error",
    title,
    text,
  });
}

export async function showSuccess(title: string, text?: string) {
  return dukaiSwal.fire({
    icon: "success",
    title,
    text,
  });
}

export async function showWarning(title: string, text?: string) {
  return dukaiSwal.fire({
    icon: "warning",
    title,
    text,
  });
}

export async function showInfo(title: string, text?: string) {
  return dukaiSwal.fire({
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
  const result = await dukaiSwal.fire({
    icon: "question",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
  });

  return result.isConfirmed;
}

export async function promptRejectReason(
  title = "Reject this order?",
  text = "Tell the customer why this order is being rejected.",
) {
  const result = await dukaiSwal.fire({
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
  const result = await dukaiSwal.fire({
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
  const result = await dukaiSwal.fire({
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
  const Toast = Swal.mixin({
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: durationMs,
    timerProgressBar: true,
    showCloseButton: durationMs >= 10000,
    customClass: {
      popup: "dukai-swal-toast dukai-swal-popup",
      title: "dukai-swal-title",
    },
    buttonsStyling: false,
  });

  return Toast.fire({ icon: "success", title });
}

export async function toastError(title: string) {
  const Toast = Swal.mixin({
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 4000,
    timerProgressBar: true,
    customClass: {
      popup: "dukai-swal-toast dukai-swal-popup",
      title: "dukai-swal-title",
    },
    buttonsStyling: false,
  });

  return Toast.fire({ icon: "error", title });
}

export async function toastInfo(title: string, text?: string, durationMs = 4200) {
  const Toast = Swal.mixin({
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: durationMs,
    timerProgressBar: true,
    customClass: {
      popup: "dukai-swal-toast dukai-swal-popup",
      title: "dukai-swal-title",
      htmlContainer: "dukai-swal-text",
    },
    buttonsStyling: false,
  });

  return Toast.fire({ icon: "info", title, text });
}

let loadingToastOpen = false;

function closeLoadingToastOnly() {
  if (!loadingToastOpen) return;
  loadingToastOpen = false;
  Swal.close();
}

export async function toastLoading(title = "Loading…") {
  closeLoadingToastOnly();

  const Toast = Swal.mixin({
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: undefined,
    timerProgressBar: false,
    customClass: {
      popup: "dukai-swal-toast dukai-swal-popup dukai-swal-toast--loading",
      htmlContainer: "dukai-swal-toast-loading",
    },
    buttonsStyling: false,
  });

  loadingToastOpen = true;
  return Toast.fire({
    html: `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>${title}</span>`,
  });
}

export function dismissLoadingToast() {
  closeLoadingToastOnly();
}

export function finishNavigationLoading() {
  closeLoadingToastOnly();
  notifyNavigationComplete();
}
