import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  const isLocalRuntime = command === "serve" || mode === "preview";
  return {
    root: "web",
    base: "/",
    resolve: { alias: { "@": resolve(import.meta.dirname, "web/src") } },
    plugins: [
      react(),
      tailwindcss(),
      cloudflare({
        configPath: resolve(import.meta.dirname, "wrangler.jsonc"),
        persistState: {
          path: resolve(import.meta.dirname, ".wrangler/state"),
        },
        config: (workerConfig) => ({
          vars: {
            ...workerConfig.vars,
            ...(isLocalRuntime ? { ENVIRONMENT: "development" } : {}),
            ACCESS_BYPASS_LOCAL: isLocalRuntime ? "true" : "false",
          },
        }),
      }),
    ],
    build: {
      assetsDir: "admin/assets",
      rollupOptions: {
        input: resolve(
          import.meta.dirname,
          "web/admin/index.html",
        ),
      },
    },
  };
});
