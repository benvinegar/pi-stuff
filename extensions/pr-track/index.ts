import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionCommandContext,
	ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

type CiStatus = "pass" | "fail" | "pending" | "none" | "unknown";
type ReviewStatus = "approved" | "changes" | "pending" | "unknown";
type MergeStatus = "merged" | "open" | "closed" | "draft" | "unknown";

type CiProgress = {
	total: number;
	passed: number;
	failed: number;
	pending: number;
	status: CiStatus;
};

type PrRecord = {
	number: number;
	url: string;
	title: string;
	headRefName?: string;
	state?: string;
	isDraft?: boolean;
	mergedAt?: string | null;
	reviewDecision?: string;
	ci: CiStatus;
	ciProgress?: CiProgress;
	review: ReviewStatus;
	merge: MergeStatus;
	lastCheckedAt?: string;
	error?: string;
};

type TrackerState = {
	prs: PrRecord[];
};

type GhPrView = {
	number: number;
	title: string;
	url: string;
	headRefName?: string;
	state?: string;
	isDraft?: boolean;
	mergedAt?: string | null;
	reviewDecision?: string;
	statusCheckRollup?: Array<{ status?: string; conclusion?: string | null }>;
};

const STATE_ENTRY = "pr-tracker-state";
const REFRESH_COOLDOWN_MS = 30_000;
const MAX_TRACKED_PRS = 12;
const REFRESH_CONCURRENCY = 4;

const PR_URL_REGEX = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/g;

function shortTitle(title: string, max = 40): string {
	if (title.length <= max) return title;
	return `${title.slice(0, max - 3)}...`;
}

function ciProgressFromChecks(checks?: GhPrView["statusCheckRollup"]): CiProgress {
	if (!checks || checks.length === 0) {
		return { total: 0, passed: 0, failed: 0, pending: 0, status: "none" };
	}

	let passed = 0;
	let failed = 0;
	let pending = 0;

	for (const check of checks) {
		const status = (check.status || "").toUpperCase();
		const conclusion = (check.conclusion || "").toUpperCase();

		// Check runs use `status=COMPLETED`; status contexts (e.g. Vercel) often have
		// no status but do have a terminal conclusion/state.
		const isCompleted = status === "COMPLETED" || (!status && Boolean(conclusion));
		if (!isCompleted) {
			pending += 1;
			continue;
		}

		if (["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"].includes(conclusion)) {
			failed += 1;
			continue;
		}

		if (!conclusion) {
			pending += 1;
			continue;
		}

		if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) {
			passed += 1;
			continue;
		}

		failed += 1;
	}

	const total = passed + failed + pending;
	const status: CiStatus = failed > 0 ? "fail" : pending > 0 ? "pending" : "pass";
	return { total, passed, failed, pending, status };
}

function ciProgressFromRecord(pr: PrRecord): CiProgress {
	if (pr.ciProgress) return pr.ciProgress;
	switch (pr.ci) {
		case "pass":
			return { total: 1, passed: 1, failed: 0, pending: 0, status: "pass" };
		case "fail":
			return { total: 1, passed: 0, failed: 1, pending: 0, status: "fail" };
		case "pending":
			return { total: 1, passed: 0, failed: 0, pending: 1, status: "pending" };
		case "none":
			return { total: 0, passed: 0, failed: 0, pending: 0, status: "none" };
		default:
			return { total: 0, passed: 0, failed: 0, pending: 0, status: "unknown" };
	}
}

function reviewFromDecision(decision?: string, merge?: MergeStatus): ReviewStatus {
	if (merge === "merged") return "approved";
	const value = (decision || "").toUpperCase();
	if (value === "APPROVED") return "approved";
	if (value === "CHANGES_REQUESTED") return "changes";
	if (value === "REVIEW_REQUIRED") return "pending";
	return "unknown";
}

function mergeFromState(pr: GhPrView): MergeStatus {
	if (pr.mergedAt || (pr.state || "").toUpperCase() === "MERGED") return "merged";
	if (pr.isDraft) return "draft";
	const state = (pr.state || "").toUpperCase();
	if (state === "OPEN") return "open";
	if (state === "CLOSED") return "closed";
	return "unknown";
}

function normalizePr(data: GhPrView): PrRecord {
	const merge = mergeFromState(data);
	const ciProgress = ciProgressFromChecks(data.statusCheckRollup);
	return {
		number: data.number,
		url: data.url,
		title: data.title,
		headRefName: data.headRefName,
		state: data.state,
		isDraft: data.isDraft,
		mergedAt: data.mergedAt,
		reviewDecision: data.reviewDecision,
		ci: ciProgress.status,
		ciProgress,
		review: reviewFromDecision(data.reviewDecision, merge),
		merge,
		lastCheckedAt: new Date().toISOString(),
	};
}

function extractPrRefsFromText(text: string): Array<string> {
	const refs = new Set<string>();
	for (const match of text.matchAll(PR_URL_REGEX)) {
		refs.add(match[0]);
	}
	return [...refs];
}

function extractTextContent(content: ToolResultEvent["content"]): string {
	return content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

function renderWidget(ctx: ExtensionContext, prs: PrRecord[]): void {
	if (!ctx.hasUI || prs.length === 0) {
		ctx.ui.setWidget("pr-tracker", undefined, { placement: "belowEditor" });
		ctx.ui.setStatus("pr-tracker", undefined);
		return;
	}

	const t = ctx.ui.theme;
	const header = t.fg("accent", `PR Tracker (${prs.length})`);

	const ciBadge = (pr: PrRecord) => {
		const progress = ciProgressFromRecord(pr);
		const width = 7;

		if (progress.total === 0) {
			return `${t.fg("dim", "CI:[-------]")} ${t.fg("dim", "no checks")}`;
		}

		let passSlots = Math.floor((progress.passed / progress.total) * width);
		let failSlots = Math.floor((progress.failed / progress.total) * width);
		let pendingSlots = Math.floor((progress.pending / progress.total) * width);

		const fractions = [
			{ key: "pass", frac: (progress.passed / progress.total) * width - passSlots },
			{ key: "fail", frac: (progress.failed / progress.total) * width - failSlots },
			{ key: "pending", frac: (progress.pending / progress.total) * width - pendingSlots },
		].sort((a, b) => b.frac - a.frac) as Array<{ key: "pass" | "fail" | "pending"; frac: number }>;

		let used = passSlots + failSlots + pendingSlots;
		for (const item of fractions) {
			if (used >= width) break;
			if (item.key === "pass") passSlots += 1;
			if (item.key === "fail") failSlots += 1;
			if (item.key === "pending") pendingSlots += 1;
			used += 1;
		}

		const borrowSlot = (target: "pass" | "fail" | "pending") => {
			if (target === "fail" && progress.failed > 0 && failSlots === 0) {
				if (pendingSlots > 1) pendingSlots -= 1;
				else if (passSlots > 1) passSlots -= 1;
				else if (pendingSlots > 0) pendingSlots -= 1;
				else if (passSlots > 0) passSlots -= 1;
				failSlots += 1;
			}
			if (target === "pending" && progress.pending > 0 && pendingSlots === 0) {
				if (passSlots > 1) passSlots -= 1;
				else if (failSlots > 1) failSlots -= 1;
				else if (passSlots > 0) passSlots -= 1;
				else if (failSlots > 0) failSlots -= 1;
				pendingSlots += 1;
			}
			if (target === "pass" && progress.passed > 0 && passSlots === 0) {
				if (pendingSlots > 1) pendingSlots -= 1;
				else if (failSlots > 1) failSlots -= 1;
				else if (pendingSlots > 0) pendingSlots -= 1;
				else if (failSlots > 0) failSlots -= 1;
				passSlots += 1;
			}
		};

		borrowSlot("fail");
		borrowSlot("pending");
		borrowSlot("pass");

		while (passSlots + failSlots + pendingSlots > width) {
			if (pendingSlots > 1) pendingSlots -= 1;
			else if (passSlots > 1) passSlots -= 1;
			else if (failSlots > 1) failSlots -= 1;
			else break;
		}
		while (passSlots + failSlots + pendingSlots < width) {
			if (progress.pending > 0) pendingSlots += 1;
			else if (progress.passed > 0) passSlots += 1;
			else failSlots += 1;
		}

		const bar = `${t.fg("dim", "CI:[")}${t.fg("success", "=".repeat(passSlots))}${t.fg("error", "!".repeat(failSlots))}${t.fg("warning", "~".repeat(pendingSlots))}${t.fg("dim", "]")}`;

		if (progress.failed > 0) {
			const detail = `${progress.passed}/${progress.total} +${progress.failed} fail${progress.failed === 1 ? "" : "s"}${progress.pending > 0 ? ` (${progress.pending} waiting)` : ""}`;
			return `${bar} ${t.fg("error", detail)}`;
		}
		if (progress.pending > 0) {
			return `${bar} ${t.fg("warning", `${progress.passed}/${progress.total} waiting (${progress.pending})`)}`;
		}
		return `${bar} ${t.fg("success", `${progress.passed}/${progress.total} pass`)}`;
	};

	const reviewBadge = (review: ReviewStatus) => {
		switch (review) {
			case "approved":
				return t.fg("success", "RV:✓");
			case "changes":
				return t.fg("error", "RV:✗");
			case "pending":
				return t.fg("warning", "RV:…");
			default:
				return t.fg("dim", "RV:?");
		}
	};

	const mergeBadge = (merge: MergeStatus) => {
		switch (merge) {
			case "merged":
				return t.fg("success", "MG:✓");
			case "open":
				return t.fg("accent", "MG:○");
			case "closed":
				return t.fg("dim", "MG:×");
			case "draft":
				return t.fg("warning", "MG:D");
			default:
				return t.fg("dim", "MG:?");
		}
	};

	const lines = [header];
	for (const pr of prs.slice(0, MAX_TRACKED_PRS)) {
		const prRef = t.fg("accent", `#${pr.number}`);
		const title = pr.merge === "merged"
			? t.fg("muted", shortTitle(pr.title))
			: t.fg("text", shortTitle(pr.title));
		lines.push(`${prRef} ${title}  ${ciBadge(pr)} ${reviewBadge(pr.review)} ${mergeBadge(pr.merge)}`);
	}

	ctx.ui.setWidget("pr-tracker", lines, { placement: "belowEditor" });

	const openCount = prs.filter((p) => p.merge === "open" || p.merge === "draft").length;
	const failing = prs.filter((p) => p.ci === "fail").length;
	ctx.ui.setStatus(
		"pr-tracker",
		t.fg("dim", `prs ${prs.length} · open ${openCount}${failing > 0 ? ` · failing ${failing}` : ""}`),
	);
}

function persistState(pi: ExtensionAPI, prs: PrRecord[]): void {
	pi.appendEntry<TrackerState>(STATE_ENTRY, { prs });
}

function restoreState(ctx: ExtensionContext): PrRecord[] {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type: string; customType?: string; data?: TrackerState };
		if (entry.type === "custom" && entry.customType === STATE_ENTRY && entry.data?.prs) {
			return entry.data.prs;
		}
	}
	return [];
}

async function fetchPr(pi: ExtensionAPI, ref: string): Promise<PrRecord> {
	const fields = [
		"number",
		"title",
		"url",
		"state",
		"mergedAt",
		"isDraft",
		"reviewDecision",
		"statusCheckRollup",
		"headRefName",
	].join(",");

	const args = ["pr", "view"];
	if (ref.trim()) args.push(ref.trim());
	args.push("--json", fields);

	const result = await pi.exec("gh", args, { timeout: 20_000 });
	if (result.code !== 0 || !result.stdout) {
		throw new Error(result.stderr || result.stdout || `gh pr view failed (${result.code})`);
	}

	const parsed = JSON.parse(result.stdout) as GhPrView;
	return normalizePr(parsed);
}

function upsertPr(prs: PrRecord[], next: PrRecord): PrRecord[] {
	const without = prs.filter((p) => p.number !== next.number);
	return [next, ...without].slice(0, MAX_TRACKED_PRS);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
	if (items.length === 0) return [];

	const results: R[] = new Array(items.length);
	let cursor = 0;

	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (true) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) break;
			results[index] = await worker(items[index]);
		}
	});

	await Promise.all(runners);
	return results;
}

export default function prTrackerExtension(pi: ExtensionAPI): void {
	let trackedPrs: PrRecord[] = [];
	let lastRefreshAt = 0;
	let refreshInFlight = false;

	const syncUi = (ctx: ExtensionContext) => {
		renderWidget(ctx, trackedPrs);
	};

	const updateTrackedPr = async (ctx: ExtensionContext, ref: string, quiet = true) => {
		try {
			const pr = await fetchPr(pi, ref);
			trackedPrs = upsertPr(trackedPrs, pr);
			persistState(pi, trackedPrs);
			syncUi(ctx);
			if (!quiet) ctx.ui.notify(`Tracking PR #${pr.number}: ${pr.title}`, "info");
		} catch (error) {
			if (!quiet) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to track PR (${ref}): ${message}`, "error");
			}
		}
	};

	const openPr = async (ctx: ExtensionContext, ref: string, quiet = true) => {
		try {
			const pr = await fetchPr(pi, ref);
			pi.sendMessage({
				customType: "pr-tracker-open",
				content: `${pr.url}`,
				display: true,
			});
			if (!quiet) ctx.ui.notify(`Posted PR #${pr.number} URL`, "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!quiet) ctx.ui.notify(`Failed to resolve PR URL (${ref || "current"}): ${message}`, "error");
		}
	};

	const refreshAll = async (ctx: ExtensionContext, quiet = true) => {
		if (refreshInFlight) return;
		if (trackedPrs.length === 0) return;
		if (quiet && Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS) return;

		refreshInFlight = true;
		try {
			const refreshed = await mapWithConcurrency(trackedPrs, REFRESH_CONCURRENCY, async (pr) => {
				try {
					return await fetchPr(pi, String(pr.number));
				} catch (error) {
					return {
						...pr,
						lastCheckedAt: new Date().toISOString(),
						error: error instanceof Error ? error.message : String(error),
					};
				}
			});
			trackedPrs = refreshed;
			lastRefreshAt = Date.now();
			persistState(pi, trackedPrs);
			syncUi(ctx);
			if (!quiet) ctx.ui.notify(`Refreshed ${trackedPrs.length} tracked PR(s)`, "info");
		} finally {
			refreshInFlight = false;
		}
	};

	const restoreAndRender = async (ctx: ExtensionContext) => {
		trackedPrs = restoreState(ctx);
		syncUi(ctx);
		await refreshAll(ctx, true);
	};

	pi.on("session_start", async (_event, ctx) => {
		await restoreAndRender(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await restoreAndRender(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		await restoreAndRender(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await restoreAndRender(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refreshAll(ctx, true);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!isBashToolResult(event) || event.isError) return;

		const command = (event.input.command || "").trim();
		const output = extractTextContent(event.content);

		if (/\bgh\s+pr\s+create\b/.test(command)) {
			const refs = extractPrRefsFromText(output);
			for (const ref of refs) {
				await updateTrackedPr(ctx, ref, false);
			}
			if (refs.length === 0) {
				ctx.ui.notify("PR created but URL not detected in output. Run /pr-track to add it.", "warning");
			}
			return;
		}

		if (/\bgh\s+pr\s+(merge|close|reopen|ready|review)\b/.test(command) && trackedPrs.length > 0) {
			await refreshAll(ctx, true);
		}
	});

	pi.registerCommand("pr-refresh", {
		description: "Refresh status for PRs tracked by this session",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			await refreshAll(ctx, false);
		},
	});

	pi.registerCommand("pr-track", {
		description: "Track a PR by number, or the current branch PR when omitted",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const value = args.trim();
			if (!value) {
				await updateTrackedPr(ctx, "", false);
				return;
			}

			const num = Number(value);
			if (!Number.isInteger(num) || num <= 0) {
				ctx.ui.notify("Usage: /pr-track <number?>", "warning");
				return;
			}

			await updateTrackedPr(ctx, String(num), false);
		},
	});

	pi.registerCommand("pr-open", {
		description: "Print a PR GitHub URL (number, latest tracked, or current branch)",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const value = args.trim();
			if (value) {
				const num = Number(value);
				if (!Number.isInteger(num) || num <= 0) {
					ctx.ui.notify("Usage: /pr-open <number?>", "warning");
					return;
				}
				await openPr(ctx, String(num), false);
				return;
			}

			if (trackedPrs.length > 0) {
				await openPr(ctx, String(trackedPrs[0].number), false);
				return;
			}

			await openPr(ctx, "", false);
		},
	});

	pi.registerCommand("pr-list", {
		description: "Show tracked PRs and their CI/review/merge status",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (trackedPrs.length === 0) {
				ctx.ui.notify("No PRs tracked in this session yet", "info");
				return;
			}

			const ciText = (ci: CiStatus) => {
				switch (ci) {
					case "pass":
						return "CI:green";
					case "fail":
						return "CI:red";
					case "pending":
						return "CI:pending";
					case "none":
						return "CI:none";
					default:
						return "CI:?";
				}
			};

			const reviewText = (review: ReviewStatus) => {
				switch (review) {
					case "approved":
						return "review:approved";
					case "changes":
						return "review:changes-requested";
					case "pending":
						return "review:pending";
					default:
						return "review:?";
				}
			};

			const mergeText = (merge: MergeStatus) => {
				switch (merge) {
					case "merged":
						return "merge:merged";
					case "open":
						return "merge:open";
					case "closed":
						return "merge:closed";
					case "draft":
						return "merge:draft";
					default:
						return "merge:?";
				}
			};

			const lines: string[] = ["Tracked PRs:"];
			for (const pr of trackedPrs) {
				lines.push(
					`#${pr.number} ${pr.title}`,
					`  ${ciText(pr.ci)} · ${reviewText(pr.review)} · ${mergeText(pr.merge)}`,
					`  ${pr.url}`,
				);
			}

			pi.sendMessage({
				customType: "pr-tracker-list",
				content: lines.join("\n"),
				display: true,
			});
			ctx.ui.notify(`Listed ${trackedPrs.length} tracked PR(s)`, "info");
		},
	});

	pi.registerCommand("pr-untrack", {
		description: "Stop tracking a PR by number, or 'all'",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const value = args.trim();
			if (!value) {
				ctx.ui.notify("Usage: /pr-untrack <number|all>", "warning");
				return;
			}

			if (value === "all") {
				trackedPrs = [];
				persistState(pi, trackedPrs);
				syncUi(ctx);
				ctx.ui.notify("Cleared tracked PR list", "info");
				return;
			}

			const num = Number(value);
			if (!Number.isFinite(num)) {
				ctx.ui.notify("Usage: /pr-untrack <number|all>", "warning");
				return;
			}

			const before = trackedPrs.length;
			trackedPrs = trackedPrs.filter((p) => p.number !== num);
			if (trackedPrs.length === before) {
				ctx.ui.notify(`PR #${num} is not tracked`, "warning");
				return;
			}

			persistState(pi, trackedPrs);
			syncUi(ctx);
			ctx.ui.notify(`Untracked PR #${num}`, "info");
		},
	});
}
