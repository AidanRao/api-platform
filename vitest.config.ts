import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    provide: { segmentMigration: migrations.filter((m) => ["0007_app_versions.sql", "0008_version_package_info.sql"].includes(m.name)).flatMap((m) => m.queries) },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
