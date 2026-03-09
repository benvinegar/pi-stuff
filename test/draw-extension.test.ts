import { describe, expect, it, vi } from "vitest";
import drawExtension from "../extensions/draw/index";
import { createMockPi } from "./helpers/mock-pi";

describe("draw extension", () => {
  it("registers /draw command", () => {
    const mock = createMockPi();
    drawExtension(mock.api as any);

    expect([...mock.commands.keys()]).toEqual(["draw"]);
  });

  it("inserts fenced drawing into the editor", async () => {
    const mock = createMockPi();
    drawExtension(mock.api as any);

    const notifications: Array<{ message: string; level: string }> = [];
    const pasted: string[] = [];
    let editor = "My prompt";

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as any);
    try {
      await mock.commands.get("draw")?.handler("", {
        hasUI: true,
        ui: {
          custom: async () => "##\n##",
          getEditorText: () => editor,
          pasteToEditor: (text: string) => {
            pasted.push(text);
            editor += text;
          },
          notify: (message: string, level: string) => notifications.push({ message, level }),
        },
      });
    } finally {
      writeSpy.mockRestore();
    }

    expect(pasted).toHaveLength(1);
    expect(pasted[0]).toContain("```text");
    expect(pasted[0]).toContain("##\n##");
    expect(notifications.at(-1)?.message).toContain("Inserted drawing into editor");
  });

  it("notifies when drawing is cancelled", async () => {
    const mock = createMockPi();
    drawExtension(mock.api as any);

    const notifications: Array<{ message: string; level: string }> = [];
    const pasted: string[] = [];

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as any);
    try {
      await mock.commands.get("draw")?.handler("", {
        hasUI: true,
        ui: {
          custom: async () => null,
          getEditorText: () => "",
          pasteToEditor: (text: string) => pasted.push(text),
          notify: (message: string, level: string) => notifications.push({ message, level }),
        },
      });
    } finally {
      writeSpy.mockRestore();
    }

    expect(pasted).toHaveLength(0);
    expect(notifications.at(-1)?.message).toContain("Drawing cancelled");
  });
});
