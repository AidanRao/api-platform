import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./web/src", import.meta.url).pathname } },
  test: {
    setupFiles: ["web/src/test-setup.ts"],
    environment: "jsdom",
    include: ["web/**/*.spec.{ts,tsx}"],
    restoreMocks: true,
  },
});
