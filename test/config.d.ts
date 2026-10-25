import "vitest";

declare module "vitest" {
  export interface ProvidedContext { segmentMigration: string[] }
}
