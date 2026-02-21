import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@mariozechner/pi-coding-agent": resolve(rootDir, "test/stubs/pi-coding-agent.ts"),
      "@mariozechner/pi-ai": resolve(rootDir, "test/stubs/pi-ai.ts"),
      "@sinclair/typebox": resolve(rootDir, "test/stubs/typebox.ts"),
      "@onkernel/sdk": resolve(rootDir, "test/stubs/onkernel-sdk.ts"),
    },
  },
});
