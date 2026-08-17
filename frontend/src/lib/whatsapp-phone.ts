export type WhatsAppCountry = {
  iso: string;
  name: string;
  dial: string;
  example: string;
};

export const DEFAULT_WHATSAPP_COUNTRY = "KE";

/** Kenya first, then East Africa, then the rest A–Z. */
export const WHATSAPP_COUNTRIES: WhatsAppCountry[] = [
  { iso: "KE", name: "Kenya", dial: "254", example: "712345678" },
  { iso: "UG", name: "Uganda", dial: "256", example: "772123456" },
  { iso: "TZ", name: "Tanzania", dial: "255", example: "712345678" },
  { iso: "RW", name: "Rwanda", dial: "250", example: "788123456" },
  { iso: "BI", name: "Burundi", dial: "257", example: "79123456" },
  { iso: "ET", name: "Ethiopia", dial: "251", example: "911234567" },
  { iso: "SO", name: "Somalia", dial: "252", example: "615123456" },
  { iso: "SS", name: "South Sudan", dial: "211", example: "912345678" },
  { iso: "CD", name: "DR Congo", dial: "243", example: "812345678" },
  { iso: "SD", name: "Sudan", dial: "249", example: "911234567" },
  { iso: "AU", name: "Australia", dial: "61", example: "412345678" },
  { iso: "BD", name: "Bangladesh", dial: "880", example: "1712345678" },
  { iso: "BR", name: "Brazil", dial: "55", example: "11987654321" },
  { iso: "CA", name: "Canada", dial: "1", example: "4165550123" },
  { iso: "CN", name: "China", dial: "86", example: "13800138000" },
  { iso: "EG", name: "Egypt", dial: "20", example: "1001234567" },
  { iso: "FR", name: "France", dial: "33", example: "612345678" },
  { iso: "DE", name: "Germany", dial: "49", example: "15123456789" },
  { iso: "GH", name: "Ghana", dial: "233", example: "241234567" },
  { iso: "IN", name: "India", dial: "91", example: "9876543210" },
  { iso: "IT", name: "Italy", dial: "39", example: "3123456789" },
  { iso: "MW", name: "Malawi", dial: "265", example: "991234567" },
  { iso: "MY", name: "Malaysia", dial: "60", example: "123456789" },
  { iso: "NL", name: "Netherlands", dial: "31", example: "612345678" },
  { iso: "NG", name: "Nigeria", dial: "234", example: "8012345678" },
  { iso: "PK", name: "Pakistan", dial: "92", example: "3001234567" },
  { iso: "PH", name: "Philippines", dial: "63", example: "9171234567" },
  { iso: "QA", name: "Qatar", dial: "974", example: "33123456" },
  { iso: "SA", name: "Saudi Arabia", dial: "966", example: "512345678" },
  { iso: "ZA", name: "South Africa", dial: "27", example: "821234567" },
  { iso: "TR", name: "Turkey", dial: "90", example: "5012345678" },
  { iso: "AE", name: "United Arab Emirates", dial: "971", example: "501234567" },
  { iso: "GB", name: "United Kingdom", dial: "44", example: "7400123456" },
  { iso: "US", name: "United States", dial: "1", example: "2015550123" },
  { iso: "ZM", name: "Zambia", dial: "260", example: "971234567" },
  { iso: "ZW", name: "Zimbabwe", dial: "263", example: "712345678" },
];

const COUNTRY_BY_ISO = new Map(WHATSAPP_COUNTRIES.map((country) => [country.iso, country]));

const DIAL_MATCHERS = [...WHATSAPP_COUNTRIES].sort((a, b) => {
  if (b.dial.length !== a.dial.length) return b.dial.length - a.dial.length;
  if (a.iso === "US") return -1;
  if (b.iso === "US") return 1;
  return a.name.localeCompare(b.name);
});

export function whatsappCountryByIso(iso: string | null | undefined): WhatsAppCountry {
  return COUNTRY_BY_ISO.get((iso || "").toUpperCase()) ?? COUNTRY_BY_ISO.get(DEFAULT_WHATSAPP_COUNTRY)!;
}

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

function stripTrunkPrefix(national: string): string {
  return national.replace(/^0+/, "");
}

function matchCountryFromDigits(digits: string): WhatsAppCountry | null {
  return DIAL_MATCHERS.find((country) => digits.startsWith(country.dial)) ?? null;
}

export type ParsedWhatsAppPhone = {
  iso: string;
  national: string;
  international: boolean;
};

export function parseWhatsAppPhone(
  raw: string,
  fallbackIso = DEFAULT_WHATSAPP_COUNTRY,
): ParsedWhatsAppPhone {
  const trimmed = raw.trim();
  const fallback = whatsappCountryByIso(fallbackIso);
  if (!trimmed) {
    return { iso: fallback.iso, national: "", international: false };
  }

  let digits = digitsOnly(trimmed);
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  if (trimmed.startsWith("00") && digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (international) {
    const matched = matchCountryFromDigits(digits);
    if (matched) {
      return {
        iso: matched.iso,
        national: stripTrunkPrefix(digits.slice(matched.dial.length)),
        international: true,
      };
    }
    return { iso: fallback.iso, national: stripTrunkPrefix(digits), international: true };
  }

  if (digits.startsWith("254") && digits.length === 12) {
    return { iso: "KE", national: digits.slice(3), international: true };
  }

  if (
    digits.startsWith(fallback.dial) &&
    digits.length >= fallback.dial.length + 7 &&
    digits.length <= 15
  ) {
    return {
      iso: fallback.iso,
      national: stripTrunkPrefix(digits.slice(fallback.dial.length)),
      international: true,
    };
  }

  const national = stripTrunkPrefix(digits);
  return { iso: fallback.iso, national: national || digits, international: false };
}

/** E.164 digits for wa.me — country code + subscriber number, no + or leading 0. */
export function toWhatsAppMsisdn(raw: string, dialCode = "254"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let digits = digitsOnly(trimmed);
  if (!digits) return null;
  if (trimmed.startsWith("00") && digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  const code = digitsOnly(dialCode);
  if (!code) return null;

  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }

  if (digits.startsWith(code) && digits.length >= code.length + 7 && digits.length <= 15) {
    return digits;
  }

  const national = stripTrunkPrefix(digits);
  if (national.length < 7) return null;
  const msisdn = `${code}${national}`;
  return msisdn.length >= 8 && msisdn.length <= 15 ? msisdn : null;
}

export function formatWhatsAppDisplay(msisdn: string, dialCode: string): string {
  const national = msisdn.startsWith(dialCode) ? msisdn.slice(dialCode.length) : msisdn;
  const grouped = national.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
  return `+${dialCode}${grouped ? ` ${grouped}` : ""}`;
}
