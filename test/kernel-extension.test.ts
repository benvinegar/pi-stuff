import { beforeEach, describe, expect, it } from "vitest";
import kernelExtension from "../extensions/kernel/index";
import { createMockPi } from "./helpers/mock-pi";
import {
  __getDeletedSessionIds,
  __resetKernelMock,
  __setKernelSessions,
  __setPlaywrightResult,
} from "./stubs/onkernel-sdk";

describe("kernel extension", () => {
  beforeEach(() => {
    process.env.KERNEL_API_KEY = "test-key";
    __resetKernelMock();
  });

  it("registers kernel tools and command", () => {
    const mock = createMockPi();
    kernelExtension(mock.api as any);

    const toolNames = mock.tools.map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "kernel_browser",
        "kernel_playwright",
        "kernel_screenshot",
        "kernel_computer",
      ]),
    );
    expect(mock.commands.has("kernel")).toBe(true);
  });

  it("creates browser and uses active session for playwright", async () => {
    const mock = createMockPi();
    kernelExtension(mock.api as any);

    const browserTool = mock.tools.find((t) => t.name === "kernel_browser");
    const playwrightTool = mock.tools.find((t) => t.name === "kernel_playwright");

    const createResult = await browserTool.execute(
      "id",
      { action: "create" },
      new AbortController().signal,
    );
    expect(createResult.content[0].text).toContain("Browser created and set as active");

    __setPlaywrightResult({ success: true, result: "navigated" });
    const execResult = await playwrightTool.execute(
      "id",
      { code: "return 'navigated'" },
      new AbortController().signal,
    );
    expect(execResult.content[0].text).toContain("navigated");
  });

  it("prunes stale sessions in non-dry-run mode", async () => {
    const mock = createMockPi();
    kernelExtension(mock.api as any);

    const browserTool = mock.tools.find((t) => t.name === "kernel_browser");
    __setKernelSessions([
      {
        session_id: "old-1",
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        session_id: "recent-1",
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      },
    ]);

    const result = await browserTool.execute(
      "id",
      { action: "prune", older_than: "1d", dry_run: false },
      new AbortController().signal,
    );

    expect(result.content[0].text).toContain("deleted 1 session(s)");
    expect(__getDeletedSessionIds()).toEqual(["old-1"]);
  });
});
