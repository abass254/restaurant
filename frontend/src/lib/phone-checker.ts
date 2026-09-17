/**
 * Kenyan phone number checker and carrier detector.
 * Supports +254 formatting and carrier resolution (Safaricom, Airtel, Telkom, etc.).
 */

export type PhoneCheckResult = {
  isValid: boolean;
  isIncomplete: boolean;
  network: string | null;
  formatted: string;
  normalized: string;
  message: string;
  status: "idle" | "valid" | "invalid" | "incomplete";
};

export function checkKenyanPhone(input: string): PhoneCheckResult {
  const raw = input.trim();
  if (!raw || raw === "+254" || raw === "+" || raw === "254") {
    return {
      isValid: false,
      isIncomplete: true,
      network: null,
      formatted: raw,
      normalized: "+254",
      message: "Enter 9 digits after +254 (e.g. +254 712 345 678)",
      status: "idle",
    };
  }

  // Remove spaces, hyphens, brackets
  const cleanDigits = raw.replace(/\D/g, "");

  // Normalize to 9-digit local subscriber part (after 254)
  let subDigits = "";
  if (cleanDigits.startsWith("254")) {
    subDigits = cleanDigits.slice(3);
  } else if (cleanDigits.startsWith("0")) {
    subDigits = cleanDigits.slice(1);
  } else if (raw.startsWith("+") && !cleanDigits.startsWith("254")) {
    // Non-Kenyan international number
    const isValid = cleanDigits.length >= 8 && cleanDigits.length <= 15;
    return {
      isValid,
      isIncomplete: cleanDigits.length < 8,
      network: "International",
      formatted: raw,
      normalized: `+${cleanDigits}`,
      message: isValid ? "Valid international number" : "Incomplete international phone number",
      status: isValid ? "valid" : "invalid",
    };
  } else {
    subDigits = cleanDigits;
  }

  // Format as +254 XXX XXX XXX as user types
  let pretty = "+254";
  if (subDigits.length > 0) {
    pretty += " " + subDigits.slice(0, 3);
  }
  if (subDigits.length > 3) {
    pretty += " " + subDigits.slice(3, 6);
  }
  if (subDigits.length > 6) {
    pretty += " " + subDigits.slice(6, 9);
  }
  if (subDigits.length > 9) {
    pretty += subDigits.slice(9);
  }

  const normalized = `+254${subDigits}`;

  // Check prefix validity
  if (!subDigits.startsWith("7") && !subDigits.startsWith("1")) {
    if (subDigits.length >= 1) {
      return {
        isValid: false,
        isIncomplete: false,
        network: null,
        formatted: pretty,
        normalized,
        message: "Kenyan mobile numbers start with 7 or 1 (e.g. +254 7xx or +254 1xx)",
        status: "invalid",
      };
    }
  }

  // Carrier detection
  let network: string | null = null;
  const prefix2 = subDigits.slice(0, 2);
  const prefix3 = subDigits.slice(0, 3);
  const prefix4 = subDigits.slice(0, 4);

  // Safaricom prefixes
  // 0700-0709, 0710-0719, 0720-0729, 0740-0743, 0745, 0746, 0748, 0757-0759, 0768, 0769, 0790-0799, 0110-0115
  const isSafaricom =
    ["70", "71", "72", "79"].includes(prefix2) ||
    ["740", "741", "742", "743", "745", "746", "748", "757", "758", "759", "768", "769"].includes(prefix3) ||
    ["110", "111", "112", "113", "114", "115"].includes(prefix3);

  // Airtel prefixes
  // 0730-0739, 0750-0756, 0785-0789, 0100-0106
  const isAirtel =
    ["73", "78"].includes(prefix2) ||
    ["750", "751", "752", "753", "754", "755", "756"].includes(prefix3) ||
    ["100", "101", "102", "103", "104", "105", "106"].includes(prefix3);

  // Telkom
  const isTelkom = ["77"].includes(prefix2);

  // Faiba
  const isFaiba = ["747"].includes(prefix3);

  // Equitel
  const isEquitel = ["763", "764", "765", "766"].includes(prefix3);

  if (isSafaricom) network = "Safaricom";
  else if (isAirtel) network = "Airtel";
  else if (isTelkom) network = "Telkom";
  else if (isFaiba) network = "Faiba 4G";
  else if (isEquitel) network = "Equitel";
  else if (subDigits.startsWith("7") || subDigits.startsWith("1")) network = "Kenya Mobile";

  if (subDigits.length < 9) {
    const remaining = 9 - subDigits.length;
    return {
      isValid: false,
      isIncomplete: true,
      network,
      formatted: pretty,
      normalized,
      message: `${remaining} more digit${remaining > 1 ? "s" : ""} needed${network ? ` (${network})` : ""}`,
      status: "incomplete",
    };
  }

  if (subDigits.length === 9) {
    return {
      isValid: true,
      isIncomplete: false,
      network,
      formatted: pretty,
      normalized,
      message: network ? `Valid ${network} number` : "Valid Kenyan mobile number",
      status: "valid",
    };
  }

  // More than 9 digits
  return {
    isValid: false,
    isIncomplete: false,
    network,
    formatted: pretty,
    normalized,
    message: "Too many digits for a Kenyan mobile number (max 9 digits after +254)",
    status: "invalid",
  };
}
