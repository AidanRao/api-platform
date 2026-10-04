const base36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const randomLength = 10;

/** Generates an opaque, human-readable ID. The date is for display, not ordering or authorization. */
export function generatePublicId(prefix: string, date: Date = new Date(), timeZone = "UTC"): string {
  if (!/^[A-Z][A-Z0-9]{0,15}$/.test(prefix)) {
    throw new Error("ID prefix must be 1-16 uppercase letters or digits, starting with a letter");
  }
  if (Number.isNaN(date.getTime())) throw new Error("ID date must be valid");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  const day = `${value("year")}${value("month")}${value("day")}`;

  let suffix = "";
  const bytes = new Uint8Array(randomLength);
  while (suffix.length < randomLength) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 252 is divisible by 36; discarding higher values avoids modulo bias.
      if (byte < 252) suffix += base36[byte % 36];
      if (suffix.length === randomLength) break;
    }
  }
  return `${prefix}-${day}-${suffix}`;
}
