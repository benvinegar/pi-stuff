import { describe, expect, it } from "vitest";
import prTrackExtension from "../extensions/pr-track/index";
import { createMockContext, createMockPi } from "./helpers/mock-pi";

function ghPr(number: number, title = "Add cool thing") {
  return {
    number,
    title,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: "OPEN",
    mergedAt: null,
    isDraft: false,
    reviewDecision: "REVIEW_REQUIRED",
    headRefName: `feature/${number}`,
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
  };
}

describe("pr-track extension", () => {
  it("registers expected commands", () => {
    const mock = createMockPi();
    prTrackExtension(mock.api as any);

    expect([...mock.commands.keys()].sort()).toEqual(
      ["pr-list", "pr-open", "pr-refresh", "pr-track", "pr-untrack"].sort(),
    );
  });

  it("tracks a PR and lists it", async () => {
    const mock = createMockPi({
      execImpl: async (_cmd, args) => {
        if (args[0] === "pr" && args[1] === "view") {
          return { code: 0, stdout: JSON.stringify(ghPr(42, "Ship tracker tests")), stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const { ctx, notifications } = createMockContext();
    prTrackExtension(mock.api as any);

    await mock.commands.get("pr-track")?.handler("42", ctx as any);
    await mock.commands.get("pr-list")?.handler("", ctx as any);

    expect(notifications.some((n) => n.message.includes("Tracking PR #42"))).toBe(true);
    expect(mock.sentMessages.at(-1)?.content).toContain("#42 Ship tracker tests");
    expect(mock.sentMessages.at(-1)?.content).toContain("CI:green");
  });

  it("detects PR creation from gh output and auto-tracks via tool_result", async () => {
    const mock = createMockPi({
      execImpl: async (_cmd, args) => {
        if (args[0] === "pr" && args[1] === "view") {
          return { code: 0, stdout: JSON.stringify(ghPr(77, "Auto tracked")), stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const { ctx } = createMockContext();
    prTrackExtension(mock.api as any);

    await mock.emit(
      "tool_result",
      {
        toolName: "bash",
        isError: false,
        input: { command: "gh pr create" },
        content: [{ type: "text", text: "Created https://github.com/acme/repo/pull/77" }],
      },
      ctx,
    );

    await mock.commands.get("pr-list")?.handler("", ctx as any);
    expect(mock.sentMessages.at(-1)?.content).toContain("#77 Auto tracked");
  });
});
