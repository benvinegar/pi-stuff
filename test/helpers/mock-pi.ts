type Command = {
  description: string;
  handler: (args: string, ctx: unknown) => Promise<void> | void;
};

type ExecResult = { code: number; stdout: string; stderr: string };
type EventHandler = (event: unknown, ctx: unknown) => Promise<void> | void;

export function createMockPi(options?: {
  execImpl?: (cmd: string, args: string[], opts?: Record<string, unknown>) => Promise<ExecResult>;
}) {
  const tools: any[] = [];
  const commands = new Map<string, Command>();
  const events = new Map<string, EventHandler[]>();
  const sentMessages: any[] = [];
  const customEntries: any[] = [];

  return {
    tools,
    commands,
    events,
    sentMessages,
    customEntries,
    api: {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: (name: string, command: Command) => commands.set(name, command),
      on: (eventName: string, handler: EventHandler) => {
        const list = events.get(eventName) ?? [];
        list.push(handler);
        events.set(eventName, list);
      },
      appendEntry: (_type: string, data: any) => customEntries.push(data),
      sendMessage: (message: any) => sentMessages.push(message),
      exec: async (cmd: string, args: string[], opts?: Record<string, unknown>) => {
        if (options?.execImpl) return options.execImpl(cmd, args, opts);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    async emit(eventName: string, event: unknown, ctx: unknown) {
      const handlers = events.get(eventName) ?? [];
      for (const handler of handlers) {
        await handler(event, ctx);
      }
    },
  };
}

export function createMockContext(entries: unknown[] = []) {
  const notifications: Array<{ message: string; level: string }> = [];
  const widgets: Array<{ id: string; lines: string[] | undefined }> = [];
  const statuses: Array<{ id: string; message: string | undefined }> = [];

  return {
    notifications,
    widgets,
    statuses,
    ctx: {
      hasUI: true,
      ui: {
        notify: (message: string, level: string) => notifications.push({ message, level }),
        setWidget: (id: string, lines: string[] | undefined) => widgets.push({ id, lines }),
        setStatus: (id: string, message: string | undefined) => statuses.push({ id, message }),
        select: async () => "",
        theme: {
          fg: (_token: string, value: string) => value,
        },
      },
      sessionManager: {
        getEntries: () => entries,
      },
    },
  };
}
