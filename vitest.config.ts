import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@convex": path.resolve(__dirname, "./convex"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Default is node. Convex tests opt into edge-runtime with a
    // `@vitest-environment edge-runtime` docblock.
    environment: "node",
    server: { deps: { inline: ["convex-test"] } },
  },
});
