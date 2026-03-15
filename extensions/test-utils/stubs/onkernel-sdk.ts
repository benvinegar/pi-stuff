type Session = {
  session_id: string;
  stealth?: boolean;
  headless?: boolean;
  browser_live_view_url?: string;
  created_at?: string;
  timeout_seconds?: number;
  profile?: { name?: string } | null;
  url?: string;
  page_url?: string;
  current_url?: string;
};

type PlaywrightResult = {
  success: boolean;
  result?: unknown;
  stdout?: string;
  stderr?: string;
  error?: string;
};

type KernelCreateParams = {
  stealth?: boolean;
  headless?: boolean;
  timeout_seconds?: number;
  profile?: { name?: string };
};

type KernelMouseParams = {
  x?: number;
  y?: number;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
};

const state: {
  sessions: Session[];
  deleted: string[];
  playwrightResult: PlaywrightResult;
  mousePosition: { x: number; y: number };
  createCount: number;
} = {
  sessions: [],
  deleted: [],
  playwrightResult: { success: true, result: "ok" },
  mousePosition: { x: 0, y: 0 },
  createCount: 0,
};

export function __resetKernelMock() {
  state.sessions = [];
  state.deleted = [];
  state.playwrightResult = { success: true, result: "ok" };
  state.mousePosition = { x: 0, y: 0 };
  state.createCount = 0;
}

export function __setKernelSessions(sessions: Session[]) {
  state.sessions = [...sessions];
}

export function __setPlaywrightResult(result: PlaywrightResult) {
  state.playwrightResult = result;
}

export function __getDeletedSessionIds() {
  return [...state.deleted];
}

class Kernel {
  apiKey: string;

  constructor({ apiKey }: { apiKey: string }) {
    this.apiKey = apiKey;
  }

  browsers = {
    create: async (params: KernelCreateParams) => {
      state.createCount += 1;
      const session: Session = {
        session_id: `test-session-${state.createCount}`,
        stealth: params?.stealth,
        headless: params?.headless,
        timeout_seconds: params?.timeout_seconds,
        profile: params?.profile ?? null,
        created_at: new Date().toISOString(),
        browser_live_view_url: "https://kernel.example/live",
      };
      state.sessions.unshift(session);
      return session;
    },
    list: async function* () {
      for (const session of state.sessions) {
        yield session;
      }
    },
    retrieve: async (sid: string) => {
      const found = state.sessions.find((s) => s.session_id === sid);
      if (!found) throw new Error(`session not found: ${sid}`);
      return found;
    },
    deleteByID: async (sid: string) => {
      state.deleted.push(sid);
      state.sessions = state.sessions.filter((s) => s.session_id !== sid);
    },
    playwright: {
      execute: async (_sid: string, _params: unknown) => state.playwrightResult,
    },
    computer: {
      captureScreenshot: async (_sid: string) => new Response(new Uint8Array([137, 80, 78, 71])),
      clickMouse: async (_sid: string, _params: unknown) => {},
      typeText: async (_sid: string, _params: unknown) => {},
      pressKey: async (_sid: string, _params: unknown) => {},
      scroll: async (_sid: string, _params: unknown) => {},
      moveMouse: async (_sid: string, params: KernelMouseParams) => {
        state.mousePosition = { x: params?.x ?? 0, y: params?.y ?? 0 };
      },
      dragMouse: async (_sid: string, params: KernelMouseParams) => {
        state.mousePosition = { x: params?.end_x ?? 0, y: params?.end_y ?? 0 };
      },
      getMousePosition: async (_sid: string) => state.mousePosition,
    },
  };
}

export default Kernel;
