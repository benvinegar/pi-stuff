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
      "@mariozechner/pi-coding-agent": resolve(
        rootDir,
        "extensions/test-utils/stubs/pi-coding-agent.ts",
      ),
      "@mariozechner/pi-ai": resolve(rootDir, "extensions/test-utils/stubs/pi-ai.ts"),
      "@mariozechner/pi-tui": resolve(rootDir, "extensions/test-utils/stubs/pi-tui.ts"),
      "@sinclair/typebox": resolve(rootDir, "extensions/test-utils/stubs/typebox.ts"),
      "@onkernel/sdk": resolve(rootDir, "extensions/test-utils/stubs/onkernel-sdk.ts"),
    },
  },
});
