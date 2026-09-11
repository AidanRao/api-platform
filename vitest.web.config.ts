import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["web/**/*.spec.{ts,tsx}"],
    restoreMocks: true,
  },
});
