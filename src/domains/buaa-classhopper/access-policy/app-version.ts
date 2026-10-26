import { versionNumberSchema } from "../../../features/versions/schema";

export const HEADER_APP_VERSION = "X-App-Version";

export function parseAppVersion(value: string | undefined): string | null {
  const parsed = versionNumberSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
