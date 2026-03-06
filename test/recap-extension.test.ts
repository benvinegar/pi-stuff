import { __setCompleteResponse } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import recapExtension from "../extensions/recap/index";
import { createMockContext, createMockPi } from "./helpers/mock-pi";

function sampleBranch() {
  return [
    {
      type: "message",
      timestamp: "2026-03-01T00:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Set up tmux agent status tracking" }],
      },
    },
    {
      type: "message",
      timestamp: "2026-03-01T00:00:10.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Added scripts and updated tmux config." },
          {
            type: "toolCall",
            id: "call-1",
            name: "edit",
            arguments: { path: "/home/bentlegen/Projects/dotfiles/.tmux.conf" },
          },
        ],
      },
    },
  ];
}

describe("recap extension", () => {
  it("registers /recap command", () => {
    const mock = createMockPi();
    recapExtension(mock.api as any);
    expect([...mock.commands.keys()]).toEqual(["recap"]);
  });

  it("prepends fast LLM TL;DR by default", async () => {
    const mock = createMockPi();
    const { ctx } = createMockContext(sampleBranch());
    recapExtension(mock.api as any);

    __setCompleteResponse("- finished tmux/pr/recap updates - next commit and push");
    await mock.commands.get("recap")?.handler("", ctx as any);

    const content = String(mock.sentMessages.at(-1)?.content ?? "");
    expect(content.startsWith("TL;DR:")).toBe(true);
    expect(content).toContain("Session recap");
  });

  it("supports /recap raw to skip llm call", async () => {
    const mock = createMockPi();
    const { ctx } = createMockContext(sampleBranch());
    recapExtension(mock.api as any);

    await mock.commands.get("recap")?.handler("raw", ctx as any);
    const content = String(mock.sentMessages.at(-1)?.content ?? "");

    expect(content.startsWith("Session recap")).toBe(true);
    expect(content.includes("TL;DR:")).toBe(false);
  });
});
