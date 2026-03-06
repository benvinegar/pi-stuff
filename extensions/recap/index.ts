import { complete, type Api, type Model, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type SessionEntry = {
	type?: string;
	timestamp?: string | number;
	message?: {
		role?: string;
		content?: unknown;
		timestamp?: string | number;
		isError?: boolean;
		toolName?: string;
		toolCallId?: string;
	};
};

type ToolCallMeta = {
	id?: string;
	name?: string;
	arguments?: unknown;
};

type BuiltRecap = {
	deterministic: string;
	llmContext: string;
};

const MAX_RECENT_DEFAULT = 3;
const MAX_FILES_DEFAULT = 8;

const FAST_CODEX_MODEL_ID = "gpt-5.1-codex-mini";
const FAST_HAIKU_MODEL_ID = "claude-haiku-4-5";

const LLM_RECAP_SYSTEM_PROMPT = `You summarize coding-session activity for engineers.

Output rules:
- Return exactly one concise, human-readable sentence.
- Start with "TL;DR: ".
- Keep it under 35 words.
- Mention what was accomplished and the most important next step.
- Plain text only; no bullets, no markdown, no line breaks.`;

const squeeze = (text: string): string => text.replace(/\s+/g, " ").trim();

const truncate = (text: string, max: number): string => {
	const compact = squeeze(text);
	if (compact.length <= max) return compact;
	return `${compact.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

const parseTimestamp = (value: unknown): number | null => {
	if (typeof value === "number" && Number.isFinite(value)) {
		// Heuristic: 10-digit unix seconds vs 13-digit ms.
		return value < 10_000_000_000 ? value * 1000 : value;
	}
	if (typeof value === "string") {
		const fromDate = Date.parse(value);
		if (Number.isFinite(fromDate)) return fromDate;
		const asNumber = Number(value);
		if (Number.isFinite(asNumber)) {
			return asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber;
		}
	}
	return null;
};

const formatDuration = (ms: number): string => {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	const parts: string[] = [];
	if (days) parts.push(`${days}d`);
	if (hours) parts.push(`${hours}h`);
	if (minutes) parts.push(`${minutes}m`);
	if (!parts.length) parts.push(`${seconds}s`);
	return parts.slice(0, 2).join(" ");
};

const extractText = (content: unknown): string => {
	if (typeof content === "string") return squeeze(content);
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const maybeBlock = block as { type?: unknown; text?: unknown };
		if (maybeBlock.type === "text" && typeof maybeBlock.text === "string") {
			parts.push(maybeBlock.text);
		}
	}

	return squeeze(parts.join(" "));
};

const extractToolCalls = (content: unknown): ToolCallMeta[] => {
	if (!Array.isArray(content)) return [];

	const calls: ToolCallMeta[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const maybeBlock = block as {
			type?: unknown;
			id?: unknown;
			name?: unknown;
			arguments?: unknown;
		};
		if (maybeBlock.type !== "toolCall") continue;
		calls.push({
			id: typeof maybeBlock.id === "string" ? maybeBlock.id : undefined,
			name: typeof maybeBlock.name === "string" ? maybeBlock.name : undefined,
			arguments: maybeBlock.arguments,
		});
	}

	return calls;
};

const extractPathFromToolCall = (toolName: string | undefined, args: unknown): string | undefined => {
	if (!toolName) return undefined;
	if (!["read", "edit", "write"].includes(toolName)) return undefined;
	if (!args || typeof args !== "object") return undefined;

	const path = (args as { path?: unknown }).path;
	if (typeof path !== "string" || !path.trim()) return undefined;
	return path;
};

const shortPath = (path: string): string => {
	const home = process.env.HOME;
	if (!home) return path;
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

const uniqueRecent = (items: string[]): string[] => {
	const seen = new Set<string>();
	const out: string[] = [];

	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i]!;
		if (seen.has(item)) continue;
		seen.add(item);
		out.push(item);
	}

	return out;
};

const topCounts = (counts: Map<string, number>, limit: number): string => {
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	if (!sorted.length) return "none";
	return sorted
		.slice(0, limit)
		.map(([name, n]) => `${name}×${n}`)
		.join(", ");
};

function buildRecap(branch: SessionEntry[], args: string | undefined): BuiltRecap {
	if (!branch.length) {
		return {
			deterministic: "Session recap: no entries yet.",
			llmContext: "No session entries found.",
		};
	}

	const full = /\b(full|long|all)\b/i.test(args || "");
	const recentLimit = full ? 5 : MAX_RECENT_DEFAULT;
	const fileLimit = full ? 16 : MAX_FILES_DEFAULT;

	let firstTs: number | null = null;
	let lastTs: number | null = null;

	const userPrompts: string[] = [];
	const assistantSummaries: string[] = [];
	const toolCalls = new Map<string, number>();
	const toolErrors = new Map<string, number>();
	const touchedRead: string[] = [];
	const touchedChanged: string[] = [];
	const toolCallById = new Map<string, { name?: string; path?: string }>();

	for (const entry of branch) {
		const ts = parseTimestamp(entry.timestamp) ?? parseTimestamp(entry.message?.timestamp);
		if (ts !== null) {
			if (firstTs === null || ts < firstTs) firstTs = ts;
			if (lastTs === null || ts > lastTs) lastTs = ts;
		}

		if (entry.type !== "message" || !entry.message) continue;

		const msg = entry.message;
		if (msg.role === "user") {
			const text = extractText(msg.content);
			if (text) userPrompts.push(text);
			continue;
		}

		if (msg.role === "assistant") {
			const text = extractText(msg.content);
			if (text) assistantSummaries.push(text);

			for (const call of extractToolCalls(msg.content)) {
				const name = call.name || "unknown";
				toolCalls.set(name, (toolCalls.get(name) ?? 0) + 1);

				const path = extractPathFromToolCall(call.name, call.arguments);
				if (path) {
					if (name === "read") touchedRead.push(path);
					if (name === "edit" || name === "write") touchedChanged.push(path);
				}

				if (call.id) {
					toolCallById.set(call.id, { name: call.name, path });
				}
			}
			continue;
		}

		if (msg.role === "toolResult" && msg.isError) {
			const byName = msg.toolName;
			let name = typeof byName === "string" ? byName : undefined;
			if (!name && typeof msg.toolCallId === "string") {
				name = toolCallById.get(msg.toolCallId)?.name;
			}
			const key = name || "unknown";
			toolErrors.set(key, (toolErrors.get(key) ?? 0) + 1);
		}
	}

	const changedFiles = uniqueRecent(touchedChanged);
	const readFiles = uniqueRecent(touchedRead);
	const totalToolCalls = [...toolCalls.values()].reduce((a, b) => a + b, 0);
	const durationText =
		firstTs !== null && lastTs !== null && lastTs >= firstTs ? formatDuration(lastTs - firstTs) : "n/a";

	const lines: string[] = [];
	lines.push("Session recap");
	lines.push("");
	lines.push(`- Duration: ${durationText}`);
	lines.push(`- Messages: ${userPrompts.length} user, ${assistantSummaries.length} assistant`);
	lines.push(`- Tool calls: ${totalToolCalls} (${topCounts(toolCalls, full ? 10 : 6)})`);
	lines.push(`- Files: ${changedFiles.length} changed, ${readFiles.length} read`);

	if (toolErrors.size > 0) {
		lines.push(`- Tool errors: ${topCounts(toolErrors, 6)}`);
	}

	const recentPrompts = userPrompts.slice(-recentLimit);
	if (recentPrompts.length > 0) {
		lines.push("");
		lines.push("Recent requests:");
		for (const prompt of recentPrompts) {
			lines.push(`- ${truncate(prompt, full ? 220 : 140)}`);
		}
	}

	const recentOutcomes = assistantSummaries.slice(-recentLimit);
	if (recentOutcomes.length > 0) {
		lines.push("");
		lines.push("Recent outcomes:");
		for (const outcome of recentOutcomes) {
			lines.push(`- ${truncate(outcome, full ? 220 : 140)}`);
		}
	}

	if (changedFiles.length > 0) {
		lines.push("");
		lines.push(`Changed files (${Math.min(fileLimit, changedFiles.length)} of ${changedFiles.length}):`);
		for (const path of changedFiles.slice(0, fileLimit)) {
			lines.push(`- ${shortPath(path)}`);
		}
	}

	if (readFiles.length > 0 && full) {
		lines.push("");
		lines.push(`Read files (${Math.min(fileLimit, readFiles.length)} of ${readFiles.length}):`);
		for (const path of readFiles.slice(0, fileLimit)) {
			lines.push(`- ${shortPath(path)}`);
		}
	}

	lines.push("");
	lines.push("Tip: /recap full for a longer recap · /recap raw to skip LLM.");

	const llmLines: string[] = [];
	llmLines.push(`Duration: ${durationText}`);
	llmLines.push(`Messages: user=${userPrompts.length}, assistant=${assistantSummaries.length}`);
	llmLines.push(`Tool calls: total=${totalToolCalls}; top=${topCounts(toolCalls, 8)}`);
	llmLines.push(`Files: changed=${changedFiles.length}, read=${readFiles.length}`);
	if (toolErrors.size > 0) {
		llmLines.push(`Tool errors: ${topCounts(toolErrors, 8)}`);
	}

	if (recentPrompts.length > 0) {
		llmLines.push("Recent user requests:");
		for (const prompt of recentPrompts) {
			llmLines.push(`- ${truncate(prompt, 220)}`);
		}
	}

	if (recentOutcomes.length > 0) {
		llmLines.push("Recent assistant outcomes:");
		for (const outcome of recentOutcomes) {
			llmLines.push(`- ${truncate(outcome, 220)}`);
		}
	}

	if (changedFiles.length > 0) {
		llmLines.push(`Changed files (${Math.min(12, changedFiles.length)} of ${changedFiles.length}):`);
		for (const path of changedFiles.slice(0, 12)) {
			llmLines.push(`- ${shortPath(path)}`);
		}
	}

	if (full && readFiles.length > 0) {
		llmLines.push(`Read files (${Math.min(8, readFiles.length)} of ${readFiles.length}):`);
		for (const path of readFiles.slice(0, 8)) {
			llmLines.push(`- ${shortPath(path)}`);
		}
	}

	return {
		deterministic: lines.join("\n"),
		llmContext: llmLines.join("\n"),
	};
}

async function selectFastModel(ctx: ExtensionContext): Promise<{ model: Model<Api>; apiKey: string } | null> {
	const candidates: Array<Model<Api> | undefined> = [
		ctx.modelRegistry.find("openai-codex", FAST_CODEX_MODEL_ID),
		ctx.modelRegistry.find("anthropic", FAST_HAIKU_MODEL_ID),
		ctx.model,
	];

	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate) continue;
		const label = `${candidate.provider}/${candidate.id}`;
		if (seen.has(label)) continue;
		seen.add(label);

		const apiKey = await ctx.modelRegistry.getApiKey(candidate);
		if (!apiKey) continue;
		return { model: candidate, apiKey };
	}

	return null;
}

async function generateLlmRecap(ctx: ExtensionContext, llmContext: string): Promise<string | null> {
	const selection = await selectFastModel(ctx);
	if (!selection) return null;

	const userMessage: UserMessage = {
		role: "user",
		content: [
			{
				type: "text",
				text: `Session snapshot:\n${llmContext}`,
			},
		],
		timestamp: Date.now(),
	};

	const response = await complete(
		selection.model,
		{ systemPrompt: LLM_RECAP_SYSTEM_PROMPT, messages: [userMessage] },
		{ apiKey: selection.apiKey },
	);

	if (response.stopReason === "aborted") return null;

	const raw = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
	const compact = squeeze(raw).replace(/^TL;DR:\s*/i, "");
	if (!compact) return null;

	const deBulleted = compact
		.replace(/^[-•]\s*/g, "")
		.replace(/\s+[-•]\s+/g, "; ");
	const clipped = deBulleted
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 35)
		.join(" ");
	const sentence = /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
	return `TL;DR: ${sentence}`;
}

export default function recapExtension(pi: ExtensionAPI) {
	pi.registerCommand("recap", {
		description: "Quick recap of this session + optional fast LLM recap",
		handler: async (args, ctx) => {
			const branch = ctx.sessionManager.getBranch() as SessionEntry[];
			const built = buildRecap(branch, args);
			const skipLlm = /\b(no-llm|raw)\b/i.test(args || "");

			let llmSummary: string | null = null;
			if (!skipLlm) {
				if (ctx.hasUI) {
					ctx.ui.setStatus("recap", "Generating LLM recap…");
				}
				try {
					llmSummary = await generateLlmRecap(ctx, built.llmContext);
				} catch {
					if (ctx.hasUI) {
						ctx.ui.notify("LLM recap unavailable; showing stats-only recap.", "warning");
					}
				} finally {
					if (ctx.hasUI) {
						ctx.ui.setStatus("recap", undefined);
					}
				}
			}

			const content = llmSummary ? `${llmSummary}\n\n${built.deterministic}` : built.deterministic;

			pi.sendMessage(
				{
					customType: "recap",
					content,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});
}
