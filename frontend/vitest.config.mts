import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      PGLITE_DIR: "memory",
      GEMINI_API_KEY: "test-key",
      ANTHROPIC_API_KEY: "",
      NEAR_NETWORK: "testnet",
      NEAR_TREASURY_ACCOUNT_ID: "treasury.testnet",
      OPERATOR_ACCOUNT_IDS: "operator.testnet",
    },
  },
});
