export function StringEnum(values: readonly string[], options: Record<string, unknown> = {}) {
  return { type: "string", enum: [...values], ...options };
}

export type Api = unknown;

export type Model<T = Api> = {
  provider: string;
  id: string;
  api?: T;
};

export type UserMessage = {
  role: "user" | "assistant" | "system";
  content: Array<{ type: string; text?: string }>;
  timestamp: number;
};

let mockedText = "TL;DR: mocked summary";
let mockedStopReason = "stop";

export function __setCompleteResponse(text: string, stopReason = "stop") {
  mockedText = text;
  mockedStopReason = stopReason;
}

export async function complete(
  _model: Model<Api>,
  _input: { systemPrompt: string; messages: UserMessage[] },
  _opts: { apiKey?: string; signal?: AbortSignal },
) {
  return {
    stopReason: mockedStopReason,
    content: [{ type: "text", text: mockedText }],
  };
}
