import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: repoRoot,
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(repoRoot, "apps/web"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    testTimeout: 20_000,
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "scripts/**/*.test.ts"
    ],
    exclude: ["**/.next/**", "**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});
