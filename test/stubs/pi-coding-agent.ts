export type ToolResultEvent = {
  toolName?: string;
  isError?: boolean;
  input?: { command?: string };
  content: Array<{ type: string; text?: string }>;
};

export type ExtensionContext = {
  hasUI: boolean;
  ui: any;
  sessionManager: { getEntries: () => any[] };
};

export type ExtensionCommandContext = ExtensionContext;

export type ExtensionAPI = {
  registerTool: (tool: any) => void;
  registerCommand: (name: string, command: { description: string; handler: any }) => void;
  on: (eventName: string, handler: (...args: any[]) => any) => void;
  appendEntry: <T>(type: string, data: T) => void;
  sendMessage: (message: any) => void;
  exec: (
    cmd: string,
    args: string[],
    opts?: Record<string, unknown>,
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
};

export function isBashToolResult(event: {
  toolName?: string;
  input?: { command?: string };
}): boolean {
  return event?.toolName === "bash" || event?.input?.command != null;
}
