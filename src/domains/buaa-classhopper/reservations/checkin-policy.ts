export const MAX_RESERVATIONS_PER_USER = 10;
export const RESERVATION_WINDOW_MS = 30 * 24 * 60 * 60_000;
export const CHECKIN_TIMEOUT_SECONDS = 60;
export const MAX_CHECKIN_RETRIES = 6;

function randomJitter(): number {
  const range = 10001;
  const ceiling = Math.floor(2 ** 32 / range) * range;
  let value: number;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]!; } while (value >= ceiling);
  return value % range - 5000;
}

export function scheduledTime(classBeginTime: string): string {
  return new Date(Date.parse(classBeginTime) - 8 * 60_000 + randomJitter()).toISOString();
}
