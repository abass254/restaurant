const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Random, human-friendly temporary password (no 0/O/1/l/I). */
export function generateTempPassword(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length]).join(
    "",
  );
}
