export const HEADER_APP_VERSION = "X-App-Version";
export const MIN_ACCESS_POLICY_APP_VERSION = "1.5.1";

/** App versions use three numeric components: major.minor.patch. */
export function parseAppVersion(value: string | undefined): number[] | null {
  if (value === undefined || !/^\d+\.\d+\.\d+$/.test(value)) {
    return null;
  }

  const parts = value.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isSupportedAppVersion(parts: number[]): boolean {
  const minimum = MIN_ACCESS_POLICY_APP_VERSION.split(".").map(Number);
  for (const [index, required] of minimum.entries()) {
    const actual = parts[index]!;
    if (actual !== required) return actual > required;
  }
  return true;
}
