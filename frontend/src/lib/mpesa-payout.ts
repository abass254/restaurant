export const MERCHANT_PAYOUT_TYPES = [
  "paybill",
  "till",
  "pochi",
  "phone",
] as const;

export type MerchantPayoutType = (typeof MERCHANT_PAYOUT_TYPES)[number];

export type MerchantPayoutFormState = {
  shortcode: string;
  shortcode_type: MerchantPayoutType;
  account_number: string;
};

export const EMPTY_MERCHANT_PAYOUT_FORM: MerchantPayoutFormState = {
  shortcode: "",
  shortcode_type: "paybill",
  account_number: "",
};

export const PAYOUT_DESTINATION_META: Record<
  MerchantPayoutType,
  {
    label: string;
    shortLabel: string;
    hint: string;
    field: string;
    placeholder: string;
    icon: string;
    needsAccount: boolean;
  }
> = {
  paybill: {
    label: "Paybill",
    shortLabel: "Paybill",
    hint: "Funds go to your business Paybill. Enter the Paybill and the account number.",
    field: "Paybill number",
    placeholder: "e.g. 123456",
    icon: "fa-building-columns",
    needsAccount: true,
  },
  till: {
    label: "Till number",
    shortLabel: "Till",
    hint: "Funds go to your Lipa Na M-PESA Till number.",
    field: "Till number",
    placeholder: "e.g. 5575731",
    icon: "fa-store",
    needsAccount: false,
  },
  pochi: {
    label: "Pochi la Biashara",
    shortLabel: "Pochi",
    hint: "Funds go to the phone number linked to your Pochi wallet.",
    field: "Pochi phone number",
    placeholder: "07XXXXXXXX or 2547XXXXXXXX",
    icon: "fa-wallet",
    needsAccount: false,
  },
  phone: {
    label: "Phone deposit (B2C)",
    shortLabel: "Phone",
    hint: "Funds go to this personal M-PESA number as a B2C deposit.",
    field: "M-PESA phone number",
    placeholder: "07XXXXXXXX or 2547XXXXXXXX",
    icon: "fa-mobile-screen",
    needsAccount: false,
  },
};

export function isMerchantPayoutType(value: string): value is MerchantPayoutType {
  return (MERCHANT_PAYOUT_TYPES as readonly string[]).includes(value);
}

export function looksLikeMsisdn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return (
    (digits.startsWith("254") && digits.length === 12) ||
    (digits.startsWith("0") && digits.length === 10) ||
    (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("1")))
  );
}

export function nextPayoutShortcode(
  nextType: MerchantPayoutType,
  currentShortcode: string,
  suggestedPhone: string | null,
): string {
  if (nextType === "phone") {
    return looksLikeMsisdn(currentShortcode) ? currentShortcode : suggestedPhone ?? "";
  }
  if (nextType === "pochi") {
    return looksLikeMsisdn(currentShortcode) ? currentShortcode : "";
  }
  return looksLikeMsisdn(currentShortcode) ? "" : currentShortcode;
}
