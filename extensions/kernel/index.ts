/**
 * Kernel Browser Extension
 *
 * Provides tools for cloud browser automation via Kernel (kernel.sh).
 * Requires KERNEL_API_KEY environment variable.
 *
 * Tools:
 *   kernel_browser     - Create, list, inspect, delete, and prune cloud browser sessions
 *   kernel_playwright  - Execute Playwright code against a browser
 *   kernel_screenshot  - Capture a screenshot of the browser
 *   kernel_computer    - Low-level mouse/keyboard/scroll actions
 *
 * Commands:
 *   /kernel            - List active browser sessions and manage them
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import Kernel from "@onkernel/sdk";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getClient(): Kernel {
	const apiKey = process.env.KERNEL_API_KEY;
	if (!apiKey) {
		throw new Error(
			"KERNEL_API_KEY environment variable is not set. Get one at https://app.onkernel.com",
		);
	}
	return new Kernel({ apiKey });
}

// ---------------------------------------------------------------------------
// State — track the "active" browser so tools default to it
// ---------------------------------------------------------------------------

let activeBrowserId: string | undefined;
let activeLiveViewUrl: string | undefined;
let activeCreatedAt: string | undefined;
let activeTimeoutSeconds: number | undefined;
let activeProfileName: string | undefined;
let activeHostHint: string | undefined;
let busyOp: string | undefined;
let busySinceMs: number | undefined;
let lastOkMs: number | undefined;
let lastErrorMs: number | undefined;
let lastCtx: ExtensionContext | null = null;

function shortId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function formatAge(ms: number): string {
	const sec = Math.max(0, Math.floor(ms / 1000));
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h`;
	return `${Math.floor(hr / 24)}d`;
}

function parseDurationToMs(input?: string): number | null {
	if (!input?.trim()) return 24 * 60 * 60 * 1000;
	const raw = input.trim().toLowerCase();
	const m = raw.match(/^(\d+)(s|m|h|d)$/);
	if (!m) return null;
	const value = Number(m[1]);
	const unit = m[2];
	if (!Number.isFinite(value) || value <= 0) return null;
	switch (unit) {
		case "s":
			return value * 1000;
		case "m":
			return value * 60 * 1000;
		case "h":
			return value * 60 * 60 * 1000;
		case "d":
			return value * 24 * 60 * 60 * 1000;
		default:
			return null;
	}
}

function extractHost(url?: string): string | undefined {
	if (!url) return undefined;
	try {
		const parsed = new URL(url);
		return parsed.hostname || undefined;
	} catch {
		return undefined;
	}
}

function refreshActiveMeta(browser: {
	session_id?: string;
	created_at?: string;
	timeout_seconds?: number;
	profile?: { name?: string } | null;
	browser_live_view_url?: string;
	url?: string;
	page_url?: string;
	current_url?: string;
} | null | undefined): void {
	if (!browser) return;
	if (browser.created_at) activeCreatedAt = browser.created_at;
	if (browser.timeout_seconds) activeTimeoutSeconds = browser.timeout_seconds;
	if (browser.profile?.name) activeProfileName = browser.profile.name;
	activeLiveViewUrl = browser.browser_live_view_url ?? activeLiveViewUrl;
	activeHostHint =
		extractHost(browser.url) ??
		extractHost(browser.page_url) ??
		extractHost(browser.current_url) ??
		extractHost(browser.browser_live_view_url) ??
		activeHostHint;
}

function markBusy(op: string): void {
	busyOp = op;
	busySinceMs = Date.now();
}

function markOk(): void {
	lastOkMs = Date.now();
	lastErrorMs = undefined;
	busyOp = undefined;
	busySinceMs = undefined;
}

function markError(): void {
	lastErrorMs = Date.now();
	busyOp = undefined;
	busySinceMs = undefined;
}

function formatBrowser(b: {
	session_id: string;
	stealth?: boolean;
	headless?: boolean;
	browser_live_view_url?: string;
	created_at?: string;
	timeout_seconds?: number;
	profile?: { name?: string } | null;
}): string {
	const parts = [`id: ${b.session_id}`];
	if (b.stealth) parts.push("stealth");
	if (b.headless) parts.push("headless");
	if (b.profile?.name) parts.push(`profile: ${b.profile.name}`);
	if (b.browser_live_view_url) parts.push(`live: ${b.browser_live_view_url}`);
	if (b.timeout_seconds) parts.push(`timeout: ${b.timeout_seconds}s`);
	if (b.created_at) parts.push(`created: ${b.created_at}`);
	return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// -------------------------------------------------------------------
	// kernel_browser — create / list / get / delete / prune
	// -------------------------------------------------------------------

	pi.registerTool({
		name: "kernel_browser",
		label: "Kernel Browser",
		description:
			"Manage Kernel cloud browsers. Actions: create (launch a new browser), list (show active sessions), get (get session info), delete (terminate a session), prune (bulk-delete stale sessions). After creating a browser, use kernel_playwright to automate it.",
		parameters: Type.Object({
			action: StringEnum(["create", "list", "get", "delete", "prune"] as const, {
				description: "Action to perform",
			}),
			session_id: Type.Optional(
				Type.String({ description: "Browser session ID (for get/delete). Omit to use the active browser." }),
			),
			stealth: Type.Optional(
				Type.Boolean({ description: "Enable stealth mode (default true)" }),
			),
			headless: Type.Optional(
				Type.Boolean({ description: "Headless mode — no live view (default false)" }),
			),
			timeout_seconds: Type.Optional(
				Type.Number({ description: "Inactivity timeout in seconds (default 300)" }),
			),
			profile: Type.Optional(
				Type.String({ description: "Profile name to load (for create)" }),
			),
			older_than: Type.Optional(
				Type.String({ description: "Prune sessions older than this duration (e.g. 30m, 2h, 1d)" }),
			),
			exclude_active: Type.Optional(
				Type.Boolean({ description: "When pruning, keep the active session (default true)" }),
			),
			dry_run: Type.Optional(
				Type.Boolean({ description: "When pruning, report what would be deleted without deleting (default true)" }),
			),
			limit: Type.Optional(
				Type.Number({ description: "Maximum sessions to delete/report in one prune call (default 20)" }),
			),
		}),
		async execute(_id, params, signal) {
			const client = getClient();
			markBusy(`browser:${params.action}`);
			if (lastCtx) updateWidget(lastCtx);

			try {
				switch (params.action) {
				case "create": {
					const createParams: Record<string, unknown> = {
						stealth: params.stealth ?? true,
						headless: params.headless ?? false,
					};
					if (params.timeout_seconds) createParams.timeout_seconds = params.timeout_seconds;
					if (params.profile) createParams.profile = { name: params.profile };

					const browser = await client.browsers.create(createParams as any);
					activeBrowserId = browser.session_id;
					refreshActiveMeta(browser);
					markOk();
					if (lastCtx) updateWidget(lastCtx);

					return {
						content: [
							{
								type: "text",
								text: `Browser created and set as active.\n${formatBrowser(browser)}`,
							},
						],
						details: { browser },
					};
				}

				case "list": {
					const browsers: any[] = [];
					for await (const b of client.browsers.list()) {
						browsers.push(b);
					}
					if (browsers.length === 0) {
						markOk();
						if (lastCtx) updateWidget(lastCtx);
						return { content: [{ type: "text", text: "No active browser sessions." }] };
					}
					const active = browsers.find((b) => b.session_id === activeBrowserId);
					if (active) refreshActiveMeta(active);
					markOk();
					if (lastCtx) updateWidget(lastCtx);
					const lines = browsers.map(
						(b, i) =>
							`${b.session_id === activeBrowserId ? "→ " : "  "}${i + 1}. ${formatBrowser(b)}`,
					);
					return {
						content: [
							{
								type: "text",
								text: `${browsers.length} browser session(s):\n${lines.join("\n")}`,
							},
						],
						details: { browsers },
					};
				}

				case "get": {
					const sid = params.session_id ?? activeBrowserId;
					if (!sid) {
						markOk();
						if (lastCtx) updateWidget(lastCtx);
						return {
							content: [{ type: "text", text: "No session_id provided and no active browser." }],
							isError: true,
						};
					}
					const browser = await client.browsers.retrieve(sid);
					if (sid === activeBrowserId) refreshActiveMeta(browser);
					markOk();
					if (lastCtx) updateWidget(lastCtx);
					return {
						content: [{ type: "text", text: formatBrowser(browser) }],
						details: { browser },
					};
				}

				case "delete": {
					const sid = params.session_id ?? activeBrowserId;
					if (!sid) {
						markOk();
						if (lastCtx) updateWidget(lastCtx);
						return {
							content: [{ type: "text", text: "No session_id provided and no active browser." }],
							isError: true,
						};
					}
					await client.browsers.deleteByID(sid);
					if (sid === activeBrowserId) {
						activeBrowserId = undefined;
						activeLiveViewUrl = undefined;
						activeCreatedAt = undefined;
						activeTimeoutSeconds = undefined;
						activeProfileName = undefined;
						activeHostHint = undefined;
					}
					markOk();
					if (lastCtx) updateWidget(lastCtx);
					return {
						content: [{ type: "text", text: `Browser ${sid} deleted.` }],
					};
				}

				case "prune": {
					const olderThanMs = parseDurationToMs(params.older_than);
					if (olderThanMs == null) {
						markOk();
						if (lastCtx) updateWidget(lastCtx);
						return {
							content: [{ type: "text", text: "Invalid older_than duration. Use formats like 30m, 2h, 1d." }],
							isError: true,
						};
					}
					const dryRun = params.dry_run ?? true;
					const excludeActive = params.exclude_active ?? true;
					const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 20)));
					const now = Date.now();

					const all: any[] = [];
					for await (const b of client.browsers.list()) all.push(b);

					const matches = all.filter((b) => {
						if (excludeActive && activeBrowserId && b.session_id === activeBrowserId) return false;
						if (!b.created_at) return false;
						const ageMs = now - new Date(b.created_at).getTime();
						return Number.isFinite(ageMs) && ageMs >= olderThanMs;
					});

					const candidates = matches.slice(0, limit);
					const skippedCount = Math.max(0, matches.length - candidates.length);

					if (!dryRun) {
						for (const b of candidates) {
							await client.browsers.deleteByID(b.session_id);
							if (b.session_id === activeBrowserId) {
								activeBrowserId = undefined;
								activeLiveViewUrl = undefined;
								activeCreatedAt = undefined;
								activeTimeoutSeconds = undefined;
								activeProfileName = undefined;
								activeHostHint = undefined;
							}
						}
					}

					markOk();
					if (lastCtx) updateWidget(lastCtx);
					const header = dryRun
						? `Prune dry-run: ${candidates.length} session(s) would be deleted.`
						: `Prune complete: deleted ${candidates.length} session(s).`;
					const lines = candidates.map((b) => `- ${formatBrowser(b)}`);
					const suffix = skippedCount > 0 ? `\n${skippedCount} additional matching session(s) skipped by limit=${limit}.` : "";
					return {
						content: [
							{
								type: "text",
								text: `${header}\n${lines.length ? lines.join("\n") : "- none"}${suffix}`,
							},
						],
						details: {
							dry_run: dryRun,
							exclude_active: excludeActive,
							older_than: params.older_than ?? "24h",
							limit,
							matched: matches.length,
							deleted: dryRun ? 0 : candidates.length,
							would_delete: dryRun ? candidates.length : 0,
							skipped: skippedCount,
							sessions: candidates,
						},
					};
				}

				default:
					markOk();
					if (lastCtx) updateWidget(lastCtx);
					return { content: [{ type: "text", text: `Unknown action: ${params.action}` }], isError: true };
			}
			} catch (error) {
				markError();
				if (lastCtx) updateWidget(lastCtx);
				throw error;
			}
		},
	});

	// -------------------------------------------------------------------
	// kernel_playwright — execute Playwright code
	// -------------------------------------------------------------------

	pi.registerTool({
		name: "kernel_playwright",
		label: "Kernel Playwright",
		description:
			'Execute Playwright TypeScript code against a Kernel browser. The code runs server-side with access to `page`, `context`, and `browser` variables. Use `return` to send a value back. Example: `await page.goto("https://example.com"); return await page.title();`',
		parameters: Type.Object({
			code: Type.String({ description: "Playwright TypeScript code to execute" }),
			session_id: Type.Optional(
				Type.String({ description: "Browser session ID. Omit to use the active browser." }),
			),
			timeout_sec: Type.Optional(
				Type.Number({ description: "Execution timeout in seconds (default 60)" }),
			),
		}),
		async execute(_id, params, signal) {
			const client = getClient();
			const sid = params.session_id ?? activeBrowserId;
			if (!sid) {
				markOk();
				if (lastCtx) updateWidget(lastCtx);
				return {
					content: [
						{
							type: "text",
							text: "No browser session. Create one first with kernel_browser (action: create).",
						},
					],
					isError: true,
				};
			}

			markBusy("playwright");
			if (lastCtx) updateWidget(lastCtx);
			try {
				const execParams: any = { code: params.code };
				if (params.timeout_sec) execParams.timeout_sec = params.timeout_sec;

				const result = await client.browsers.playwright.execute(sid, execParams);

				if (!result.success) {
					markError();
					if (lastCtx) updateWidget(lastCtx);
					const errMsg = [result.error, result.stderr].filter(Boolean).join("\n");
					return {
						content: [{ type: "text", text: `Playwright execution failed:\n${errMsg}` }],
						details: { result },
						isError: true,
					};
				}

				if (typeof result.result === "string") {
					const maybeHost = extractHost(result.result);
					if (maybeHost) activeHostHint = maybeHost;
				}

				markOk();
				if (lastCtx) updateWidget(lastCtx);
				const parts: string[] = [];
				if (result.result !== undefined && result.result !== null) {
					parts.push(
						typeof result.result === "string"
							? result.result
							: JSON.stringify(result.result, null, 2),
					);
				}
				if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
				if (result.stderr) parts.push(`stderr:\n${result.stderr}`);

				return {
					content: [{ type: "text", text: parts.join("\n\n") || "Executed successfully (no output)." }],
					details: { result },
				};
			} catch (error) {
				markError();
				if (lastCtx) updateWidget(lastCtx);
				throw error;
			}
		},
	});

	// -------------------------------------------------------------------
	// kernel_screenshot — capture screenshot
	// -------------------------------------------------------------------

	pi.registerTool({
		name: "kernel_screenshot",
		label: "Kernel Screenshot",
		description:
			"Capture a screenshot of the current browser page. Returns the image for visual inspection.",
		parameters: Type.Object({
			session_id: Type.Optional(
				Type.String({ description: "Browser session ID. Omit to use the active browser." }),
			),
		}),
		async execute(_id, params, signal) {
			const client = getClient();
			const sid = params.session_id ?? activeBrowserId;
			if (!sid) {
				markOk();
				if (lastCtx) updateWidget(lastCtx);
				return {
					content: [{ type: "text", text: "No browser session. Create one first." }],
					isError: true,
				};
			}

			markBusy("screenshot");
			if (lastCtx) updateWidget(lastCtx);
			try {
				const response = await client.browsers.computer.captureScreenshot(sid);
				const arrayBuf = await response.arrayBuffer();
				const base64 = Buffer.from(arrayBuf).toString("base64");
				markOk();
				if (lastCtx) updateWidget(lastCtx);

				return {
					content: [
						{
							type: "image",
							mimeType: "image/png",
							data: base64,
						} as any,
						{ type: "text", text: "Screenshot captured." },
					],
					details: { session_id: sid, size: arrayBuf.byteLength },
				};
			} catch (error) {
				markError();
				if (lastCtx) updateWidget(lastCtx);
				throw error;
			}
		},
	});

	// -------------------------------------------------------------------
	// kernel_computer — low-level mouse/keyboard
	// -------------------------------------------------------------------

	pi.registerTool({
		name: "kernel_computer",
		label: "Kernel Computer",
		description:
			"Perform low-level computer actions on a Kernel browser: click, type, press key, scroll, move mouse, drag, or get mouse position. Use kernel_screenshot to see the result.",
		parameters: Type.Object({
			action: StringEnum(
				["click", "type", "press_key", "scroll", "move_mouse", "drag", "get_mouse_position"] as const,
				{ description: "Computer action to perform" },
			),
			session_id: Type.Optional(
				Type.String({ description: "Browser session ID. Omit to use the active browser." }),
			),
			x: Type.Optional(Type.Number({ description: "X coordinate (for click, move, drag start)" })),
			y: Type.Optional(Type.Number({ description: "Y coordinate (for click, move, drag start)" })),
			end_x: Type.Optional(Type.Number({ description: "End X coordinate (for drag)" })),
			end_y: Type.Optional(Type.Number({ description: "End Y coordinate (for drag)" })),
			text: Type.Optional(Type.String({ description: "Text to type" })),
			key: Type.Optional(
				Type.String({ description: 'Key to press (e.g. "Enter", "Tab", "Escape", "a")' }),
			),
			button: Type.Optional(
				StringEnum(["left", "right", "middle"] as const, { description: "Mouse button (default left)" }),
			),
			scroll_x: Type.Optional(Type.Number({ description: "Horizontal scroll amount" })),
			scroll_y: Type.Optional(Type.Number({ description: "Vertical scroll amount" })),
		}),
		async execute(_id, params, signal) {
			const client = getClient();
			const sid = params.session_id ?? activeBrowserId;
			if (!sid) {
				markOk();
				if (lastCtx) updateWidget(lastCtx);
				return {
					content: [{ type: "text", text: "No browser session. Create one first." }],
					isError: true,
				};
			}

			markBusy(`computer:${params.action}`);
			if (lastCtx) updateWidget(lastCtx);
			let failed = false;
			try {
				switch (params.action) {
					case "click": {
						if (params.x == null || params.y == null) {
							return { content: [{ type: "text", text: "click requires x and y" }], isError: true };
						}
						await client.browsers.computer.clickMouse(sid, {
							x: params.x,
							y: params.y,
							button: params.button ?? "left",
						});
						return { content: [{ type: "text", text: `Clicked at (${params.x}, ${params.y})` }] };
					}

					case "type": {
						if (!params.text) {
							return { content: [{ type: "text", text: "type requires text" }], isError: true };
						}
						await client.browsers.computer.typeText(sid, { text: params.text });
						return { content: [{ type: "text", text: `Typed: "${params.text}"` }] };
					}

					case "press_key": {
						if (!params.key) {
							return { content: [{ type: "text", text: "press_key requires key" }], isError: true };
						}
						await client.browsers.computer.pressKey(sid, { key: params.key });
						return { content: [{ type: "text", text: `Pressed key: ${params.key}` }] };
					}

					case "scroll": {
						await client.browsers.computer.scroll(sid, {
							x: params.x ?? 0,
							y: params.y ?? 0,
							scroll_x: params.scroll_x ?? 0,
							scroll_y: params.scroll_y ?? 0,
						});
						return {
							content: [
								{
									type: "text",
									text: `Scrolled (${params.scroll_x ?? 0}, ${params.scroll_y ?? 0}) at (${params.x ?? 0}, ${params.y ?? 0})`,
								},
							],
						};
					}

					case "move_mouse": {
						if (params.x == null || params.y == null) {
							return { content: [{ type: "text", text: "move_mouse requires x and y" }], isError: true };
						}
						await client.browsers.computer.moveMouse(sid, { x: params.x, y: params.y });
						return { content: [{ type: "text", text: `Moved mouse to (${params.x}, ${params.y})` }] };
					}

					case "drag": {
						if (params.x == null || params.y == null || params.end_x == null || params.end_y == null) {
							return {
								content: [{ type: "text", text: "drag requires x, y, end_x, end_y" }],
								isError: true,
							};
						}
						await client.browsers.computer.dragMouse(sid, {
							start_x: params.x,
							start_y: params.y,
							end_x: params.end_x,
							end_y: params.end_y,
						});
						return {
							content: [
								{
									type: "text",
									text: `Dragged from (${params.x}, ${params.y}) to (${params.end_x}, ${params.end_y})`,
								},
							],
						};
					}

					case "get_mouse_position": {
						const pos = await client.browsers.computer.getMousePosition(sid);
						return { content: [{ type: "text", text: `Mouse at (${pos.x}, ${pos.y})` }] };
					}

					default:
						return { content: [{ type: "text", text: `Unknown action: ${params.action}` }], isError: true };
				}
			} catch (error) {
				failed = true;
				markError();
				if (lastCtx) updateWidget(lastCtx);
				throw error;
			} finally {
				if (!failed) {
					markOk();
					if (lastCtx) updateWidget(lastCtx);
				}
			}
		},
	});

	// -------------------------------------------------------------------
	// /kernel command — interactive session management
	// -------------------------------------------------------------------

	pi.registerCommand("kernel", {
		description: "List and manage Kernel browser sessions",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			if (!process.env.KERNEL_API_KEY) {
				ctx.ui.notify("KERNEL_API_KEY not set", "error");
				return;
			}

			const client = getClient();
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const cmd = (tokens[0] ?? "list").toLowerCase();

			const helpText = [
				"Kernel session commands:",
				"  /kernel                             List sessions and pick active",
				"  /kernel create                      Create session (stealth+gui)",
				"  /kernel get [sessionId|active]      Show one session",
				"  /kernel delete [sessionId|active]   Delete one session",
				"  /kernel prune [flags]               Prune stale sessions",
				"Flags for prune:",
				"  --older-than=30m|2h|1d  --dry-run=true|false",
				"  --exclude-active=true|false  --limit=20",
			].join("\n");

			const parseBool = (v?: string): boolean | null => {
				if (v == null) return null;
				const x = v.toLowerCase();
				if (x === "true" || x === "1" || x === "yes") return true;
				if (x === "false" || x === "0" || x === "no") return false;
				return null;
			};

			try {
				if (cmd === "help" || cmd === "--help" || cmd === "-h") {
					ctx.ui.notify(helpText, "info");
					return;
				}

				if (cmd === "create") {
					markBusy("browser:create");
					updateWidget(ctx);
					const browser = await client.browsers.create({ stealth: true, headless: false } as any);
					activeBrowserId = browser.session_id;
					refreshActiveMeta(browser);
					markOk();
					updateWidget(ctx);
					ctx.ui.notify(`Kernel browser created: ${activeBrowserId}`, "info");
					return;
				}

				if (cmd === "get") {
					const sidArg = tokens[1];
					const sid = !sidArg || sidArg === "active" ? activeBrowserId : sidArg;
					if (!sid) {
						ctx.ui.notify("No session_id provided and no active browser.", "error");
						return;
					}
					markBusy("browser:get");
					updateWidget(ctx);
					const browser = await client.browsers.retrieve(sid);
					if (sid === activeBrowserId) refreshActiveMeta(browser);
					markOk();
					updateWidget(ctx);
					ctx.ui.notify(formatBrowser(browser), "info");
					return;
				}

				if (cmd === "delete") {
					const sidArg = tokens[1];
					const sid = !sidArg || sidArg === "active" ? activeBrowserId : sidArg;
					if (!sid) {
						ctx.ui.notify("No session_id provided and no active browser.", "error");
						return;
					}
					markBusy("browser:delete");
					updateWidget(ctx);
					await client.browsers.deleteByID(sid);
					if (sid === activeBrowserId) {
						activeBrowserId = undefined;
						activeLiveViewUrl = undefined;
						activeCreatedAt = undefined;
						activeTimeoutSeconds = undefined;
						activeProfileName = undefined;
						activeHostHint = undefined;
					}
					markOk();
					updateWidget(ctx);
					ctx.ui.notify(`Browser ${sid} deleted.`, "info");
					return;
				}

				if (cmd === "prune") {
					let olderThan = "24h";
					let dryRun = true;
					let excludeActive = true;
					let limit = 20;
					for (const token of tokens.slice(1)) {
						if (token.startsWith("--older-than=")) {
							olderThan = token.slice("--older-than=".length);
						} else if (token.startsWith("--dry-run=")) {
							const parsed = parseBool(token.slice("--dry-run=".length));
							if (parsed == null) {
								ctx.ui.notify("Invalid --dry-run value (use true|false)", "error");
								return;
							}
							dryRun = parsed;
						} else if (token.startsWith("--exclude-active=")) {
							const parsed = parseBool(token.slice("--exclude-active=".length));
							if (parsed == null) {
								ctx.ui.notify("Invalid --exclude-active value (use true|false)", "error");
								return;
							}
							excludeActive = parsed;
						} else if (token.startsWith("--limit=")) {
							const value = Number(token.slice("--limit=".length));
							if (!Number.isFinite(value) || value <= 0) {
								ctx.ui.notify("Invalid --limit value (must be > 0)", "error");
								return;
							}
							limit = Math.max(1, Math.min(200, Math.floor(value)));
						} else {
							ctx.ui.notify(`Unknown prune flag: ${token}`, "error");
							return;
						}
					}

					const olderThanMs = parseDurationToMs(olderThan);
					if (olderThanMs == null) {
						ctx.ui.notify("Invalid --older-than value. Use 30m, 2h, or 1d style.", "error");
						return;
					}

					markBusy("browser:prune");
					updateWidget(ctx);
					const now = Date.now();
					const all: any[] = [];
					for await (const b of client.browsers.list()) all.push(b);
					const matches = all.filter((b) => {
						if (excludeActive && activeBrowserId && b.session_id === activeBrowserId) return false;
						if (!b.created_at) return false;
						const ageMs = now - new Date(b.created_at).getTime();
						return Number.isFinite(ageMs) && ageMs >= olderThanMs;
					});
					const candidates = matches.slice(0, limit);
					const skipped = Math.max(0, matches.length - candidates.length);

					if (!dryRun) {
						for (const b of candidates) {
							await client.browsers.deleteByID(b.session_id);
							if (b.session_id === activeBrowserId) {
								activeBrowserId = undefined;
								activeLiveViewUrl = undefined;
								activeCreatedAt = undefined;
								activeTimeoutSeconds = undefined;
								activeProfileName = undefined;
								activeHostHint = undefined;
							}
						}
					}

					markOk();
					updateWidget(ctx);
					ctx.ui.notify(
						`${dryRun ? "Prune dry-run" : "Prune complete"}: ${candidates.length} ${dryRun ? "would be deleted" : "deleted"}` +
							(skipped > 0 ? ` (${skipped} more matched; limit=${limit})` : ""),
						"info",
					);
					return;
				}

				if (cmd !== "list") {
					ctx.ui.notify(`Unknown kernel command: ${cmd}\n\n${helpText}`, "error");
					return;
				}

				markBusy("browser:list");
				updateWidget(ctx);
				const browsers: any[] = [];
				for await (const b of client.browsers.list()) {
					browsers.push(b);
				}

				if (browsers.length === 0) {
					const createLabel = "Create browser (stealth+gui)";
					const cancelLabel = "Cancel";
					const choice = await ctx.ui.select("No active Kernel browsers", [createLabel, cancelLabel]);
					if (choice === createLabel) {
						markBusy("browser:create");
						updateWidget(ctx);
						const browser = await client.browsers.create({ stealth: true, headless: false } as any);
						activeBrowserId = browser.session_id;
						refreshActiveMeta(browser);
						ctx.ui.notify(`Kernel browser created: ${activeBrowserId}`, "info");
					} else {
						ctx.ui.notify("No active Kernel browser sessions", "info");
					}
					markOk();
					updateWidget(ctx);
					return;
				}

				const items = browsers.map((b) => {
					const details = [
						b.stealth ? "stealth" : "",
						b.headless ? "headless" : "gui",
						b.profile?.name ? `profile:${b.profile.name}` : "",
					]
						.filter(Boolean)
						.join(", ");
					return `${b.session_id === activeBrowserId ? "●" : "○"} ${b.session_id}${details ? ` (${details})` : ""}`;
				});

				const selectedLabel = await ctx.ui.select("Kernel Browsers (select to set active):", items);
				if (selectedLabel) {
					const selected = selectedLabel.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
					if (selected) {
						activeBrowserId = selected;
						const match = browsers.find((b: any) => b.session_id === selected);
						refreshActiveMeta(match);
						ctx.ui.notify(`Active browser: ${selected}`, "info");
					}
				}
				markOk();
				updateWidget(ctx);
			} catch (err: any) {
				markError();
				updateWidget(ctx);
				ctx.ui.notify(`Kernel error: ${err.message}`, "error");
			}
		},
	});

	// -------------------------------------------------------------------
	// Status widget — show active browser
	// -------------------------------------------------------------------

	function updateWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;

		if (!activeBrowserId) {
			ctx.ui.setStatus("kernel", ctx.ui.theme.fg("dim", "Kernel: none · run /kernel or kernel_browser create"));
			return;
		}

		const id = shortId(activeBrowserId);
		const alias = activeProfileName?.trim();
		const label = alias ? `${alias} (${id})` : id;

		if (busyOp && busySinceMs) {
			const busyFor = formatAge(Date.now() - busySinceMs);
			ctx.ui.setStatus("kernel", ctx.ui.theme.fg("warning", `Kernel: ${label} · busy (${busyOp} ${busyFor})`));
			return;
		}

		if (lastErrorMs && (!lastOkMs || lastErrorMs > lastOkMs)) {
			const okText = lastOkMs ? `last ok ${formatAge(Date.now() - lastOkMs)} ago` : "no successful call yet";
			ctx.ui.setStatus("kernel", ctx.ui.theme.fg("error", `Kernel: ${label} · ${okText} · state=stale (retry /kernel)`));
			return;
		}

		const parts = [`Kernel: ${label}`];
		if (activeHostHint) parts.push(activeHostHint);
		if (activeCreatedAt) {
			const ageMs = Date.now() - new Date(activeCreatedAt).getTime();
			if (Number.isFinite(ageMs) && ageMs >= 0) parts.push(`age ${formatAge(ageMs)}`);
		}
		if (activeTimeoutSeconds) parts.push(`timeout ${activeTimeoutSeconds}s`);

		ctx.ui.setStatus("kernel", ctx.ui.theme.fg("accent", parts.join(" · ")));
	}

	// -------------------------------------------------------------------
	// Cleanup on shutdown
	// -------------------------------------------------------------------

	pi.on("session_shutdown", async () => {
		// Don't auto-delete browsers on shutdown — they may be long-lived
		// Just clear local state
		activeBrowserId = undefined;
		activeLiveViewUrl = undefined;
		activeCreatedAt = undefined;
		activeTimeoutSeconds = undefined;
		activeProfileName = undefined;
		activeHostHint = undefined;
		busyOp = undefined;
		busySinceMs = undefined;
		lastCtx = null;
	});

	// -------------------------------------------------------------------
	// Restore state on session start (from tool results in history)
	// -------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		for (const entry of ctx.sessionManager.getEntries()) {
			const e = entry as any;
			if (e.type === "message" && e.message?.role === "toolResult") {
				if (e.message.toolName === "kernel_browser" && e.message.details?.browser?.session_id) {
					activeBrowserId = e.message.details.browser.session_id;
					refreshActiveMeta(e.message.details.browser);
				}
			}
		}
		updateWidget(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		lastCtx = ctx;
		updateWidget(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		lastCtx = ctx;
		updateWidget(ctx);
	});
}
