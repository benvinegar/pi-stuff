export type Component = {
  invalidate?: () => void;
  handleInput?: (data: string) => void;
  render?: (width: number) => string[];
};

export type TUI = {
  terminal: { columns: number; rows: number };
  requestRender: () => void;
};

const KEY_ALIASES: Record<string, string[]> = {
  escape: ["\u001b"],
  enter: ["\r", "\n"],
  return: ["\r", "\n"],
  tab: ["\t"],
  up: ["\u001b[A"],
  down: ["\u001b[B"],
  right: ["\u001b[C"],
  left: ["\u001b[D"],
  space: [" "],
  backspace: ["\b", "\u007f"],
  delete: ["\u001b[3~"],
  "ctrl+s": [String.fromCharCode(19)],
  "ctrl+t": [String.fromCharCode(20)],
  "ctrl+x": [String.fromCharCode(24)],
  "ctrl+y": [String.fromCharCode(25)],
  "ctrl+z": [String.fromCharCode(26)],
  "ctrl+shift+z": [String.fromCharCode(26)],
};

export function matchesKey(data: string, key: string): boolean {
  const options = KEY_ALIASES[key];
  if (!options) return false;
  return options.includes(data);
}

export function visibleWidth(value: string): number {
  return Array.from(value).length;
}

export function truncateToWidth(value: string, width: number, ellipsis = ""): string {
  if (width <= 0) return "";

  const chars = Array.from(value);
  if (chars.length <= width) return value;

  const suffix = Array.from(ellipsis);
  if (suffix.length >= width) {
    return suffix.slice(0, width).join("");
  }

  const head = chars.slice(0, width - suffix.length).join("");
  return `${head}${ellipsis}`;
}
