import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";

const ENABLE_MOUSE_TRACKING = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const DISABLE_MOUSE_TRACKING = "\x1b[?1000l\x1b[?1002l\x1b[?1006l";
const SGR_MOUSE_PATTERN = /^\x1b\[<(\d+);(\d+);(\d+)([mM])$/;
const BRUSHES = ["#", "*", "+", "-", "=", "x", "o", ".", "|", "/", "\\"] as const;
const MAX_HISTORY = 100;

type DrawMode = "freeform" | "line" | "text";
type StrokeMode = "draw" | "erase" | null;
type CanvasGrid = string[][];
type Point = { x: number; y: number };
type LineStart = { x: number; y: number; erase: boolean };

type ParsedMouseEvent = {
	button: number;
	x: number;
	y: number;
	down: boolean;
	motion: boolean;
	wheel: boolean;
};

let activeMouseCaptureCount = 0;

function beginMouseCapture(): void {
	if (activeMouseCaptureCount === 0) {
		process.stdout.write(ENABLE_MOUSE_TRACKING);
	}
	activeMouseCaptureCount += 1;
}

function endMouseCapture(): void {
	if (activeMouseCaptureCount <= 0) {
		activeMouseCaptureCount = 0;
		return;
	}

	activeMouseCaptureCount -= 1;
	if (activeMouseCaptureCount === 0) {
		process.stdout.write(DISABLE_MOUSE_TRACKING);
	}
}

function forceDisableMouseCapture(): void {
	if (activeMouseCaptureCount === 0) return;
	activeMouseCaptureCount = 0;
	process.stdout.write(DISABLE_MOUSE_TRACKING);
}

function parseMouseEvent(data: string): ParsedMouseEvent | undefined {
	const match = data.match(SGR_MOUSE_PATTERN);
	if (!match) return undefined;

	const rawCode = Number.parseInt(match[1] ?? "", 10);
	const x = Number.parseInt(match[2] ?? "", 10);
	const y = Number.parseInt(match[3] ?? "", 10);
	const suffix = match[4];
	if (!Number.isFinite(rawCode) || !Number.isFinite(x) || !Number.isFinite(y) || !suffix) {
		return undefined;
	}

	return {
		button: rawCode & 0b11,
		x,
		y,
		down: suffix === "M",
		motion: (rawCode & 0b100000) !== 0,
		wheel: (rawCode & 0b1000000) !== 0,
	};
}

function isPrintableInput(data: string): boolean {
	if (!data || data.startsWith("\x1b")) return false;
	const chars = Array.from(data);
	if (chars.length !== 1) return false;
	const code = chars[0]?.codePointAt(0);
	if (code === undefined) return false;
	return code >= 32 && code !== 127;
}

function normalizeCellCharacter(input: string): string {
	const clipped = truncateToWidth(input, 1, "");
	return clipped.length > 0 ? clipped : " ";
}

function padToWidth(content: string, width: number): string {
	const clipped = truncateToWidth(content, width, "");
	const current = visibleWidth(clipped);
	return clipped + " ".repeat(Math.max(0, width - current));
}

function createCanvas(width: number, height: number): CanvasGrid {
	return Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
}

function cloneCanvas(canvas: CanvasGrid): CanvasGrid {
	return canvas.map((row) => row.slice());
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

class DrawModal implements Component {
	private canvas: CanvasGrid = [];
	private canvasWidth = 0;
	private canvasHeight = 0;

	private readonly canvasTopRow = 4;
	private readonly canvasLeftCol = 1;

	private cursorX = 0;
	private cursorY = 0;

	private mode: DrawMode = "freeform";
	private brush = BRUSHES[0] as string;
	private brushIndex = 0;

	private activeStroke: StrokeMode = null;
	private lineStart: LineStart | null = null;
	private linePreviewEnd: Point | null = null;

	private undoStack: CanvasGrid[] = [];
	private redoStack: CanvasGrid[] = [];
	private status = "Freeform mode: left drag draws, right drag erases.";

	constructor(
		private readonly tui: TUI,
		private readonly theme: any,
		private readonly done: (value: string | null) => void,
	) {
		this.ensureCanvasSize(this.tui.terminal.columns, this.tui.terminal.rows);
	}

	invalidate(): void {}

	handleInput(data: string): void {
		const mouseEvent = parseMouseEvent(data);
		if (mouseEvent) {
			this.handleMouse(mouseEvent);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "escape")) {
			this.done(null);
			return;
		}

		if (matchesKey(data, "enter") || matchesKey(data, "return") || matchesKey(data, "ctrl+s")) {
			this.done(this.exportArt());
			return;
		}

		if (matchesKey(data, "ctrl+t") || matchesKey(data, "tab")) {
			this.cycleMode();
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "ctrl+z")) {
			this.undo();
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "ctrl+y") || matchesKey(data, "ctrl+shift+z")) {
			this.redo();
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "ctrl+x")) {
			this.clearCanvas();
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "up")) {
			this.moveCursor(0, -1);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "down")) {
			this.moveCursor(0, 1);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "left")) {
			this.moveCursor(-1, 0);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "right")) {
			this.moveCursor(1, 0);
			this.tui.requestRender();
			return;
		}

		if (this.mode !== "text") {
			if (data === "[") {
				this.cycleBrush(-1);
				this.tui.requestRender();
				return;
			}

			if (data === "]") {
				this.cycleBrush(1);
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "space")) {
				this.pushUndo();
				this.paintCell(this.cursorX, this.cursorY, this.brush);
				this.setStatus(`Stamped \"${this.brush}\" at ${this.cursorX + 1},${this.cursorY + 1}.`);
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "backspace") || matchesKey(data, "delete")) {
				this.pushUndo();
				this.paintCell(this.cursorX, this.cursorY, " ");
				this.setStatus(`Erased at ${this.cursorX + 1},${this.cursorY + 1}.`);
				this.tui.requestRender();
				return;
			}

			if (isPrintableInput(data)) {
				this.setBrush(data);
				this.tui.requestRender();
				return;
			}
		}

		if (this.mode === "text") {
			if (matchesKey(data, "backspace")) {
				this.backspace();
				this.tui.requestRender();
				return;
			}

			if (matchesKey(data, "delete")) {
				this.deleteAtCursor();
				this.tui.requestRender();
				return;
			}

			if (isPrintableInput(data)) {
				this.insertCharacter(data);
				this.tui.requestRender();
				return;
			}
		}
	}

	render(width: number): string[] {
		this.ensureCanvasSize(width, this.tui.terminal.rows);

		const innerWidth = Math.max(1, width - 2);
		const border = (text: string) => this.theme.fg("border", text);
		const row = (content: string): string => `${border("│")}${padToWidth(content, innerWidth)}${border("│")}`;

		const modeLabel = this.renderModeLabel();
		const brushLabel = this.theme.fg("accent", `\"${this.brush}\"`);
		const title = `${this.theme.bold("/draw")}  mode:${modeLabel}  brush:${brushLabel}`;
		const controls =
			"Enter save • Esc cancel • Ctrl+T mode(freeform/line/text) • Ctrl+Z undo • Ctrl+Y redo • Ctrl+X clear • [ ] brush";

		const previewPoints = this.getLinePreviewPoints();
		const lines: string[] = [];
		lines.push(`${border("╭")}${border("─".repeat(innerWidth))}${border("╮")}`);
		lines.push(row(title));
		lines.push(row(`${controls}  ${this.theme.fg("dim", this.status)}`));
		lines.push(`${border("├")}${border("─".repeat(innerWidth))}${border("┤")}`);

		for (let y = 0; y < this.canvasHeight; y += 1) {
			lines.push(row(this.renderCanvasRow(y, previewPoints)));
		}

		lines.push(`${border("╰")}${border("─".repeat(innerWidth))}${border("╯")}`);
		return lines;
	}

	private ensureCanvasSize(width: number, rows: number): void {
		const nextCanvasWidth = Math.max(1, width - 2);
		const nextCanvasHeight = Math.max(1, rows - 5);

		if (nextCanvasWidth === this.canvasWidth && nextCanvasHeight === this.canvasHeight) {
			return;
		}

		const nextCanvas = createCanvas(nextCanvasWidth, nextCanvasHeight);
		const copyHeight = Math.min(this.canvasHeight, nextCanvasHeight);
		const copyWidth = Math.min(this.canvasWidth, nextCanvasWidth);

		for (let y = 0; y < copyHeight; y += 1) {
			for (let x = 0; x < copyWidth; x += 1) {
				nextCanvas[y]![x] = this.canvas[y]![x] ?? " ";
			}
		}

		this.canvas = nextCanvas;
		this.canvasWidth = nextCanvasWidth;
		this.canvasHeight = nextCanvasHeight;
		this.cursorX = Math.max(0, Math.min(this.cursorX, this.canvasWidth - 1));
		this.cursorY = Math.max(0, Math.min(this.cursorY, this.canvasHeight - 1));
		this.activeStroke = null;
		this.lineStart = null;
		this.linePreviewEnd = null;
	}

	private handleMouse(event: ParsedMouseEvent): void {
		if (event.wheel) {
			if (this.mode !== "text") {
				this.cycleBrush(event.button === 0 ? 1 : -1);
			}
			return;
		}

		const localX = event.x - 1;
		const localY = event.y - 1;
		const canvasX = localX - this.canvasLeftCol;
		const canvasY = localY - this.canvasTopRow;
		const clampedX = clamp(canvasX, 0, this.canvasWidth - 1);
		const clampedY = clamp(canvasY, 0, this.canvasHeight - 1);
		const insideCanvas = this.isInsideCanvas(canvasX, canvasY);

		if (!event.down) {
			if (this.mode === "line" && this.lineStart) {
				const endX = insideCanvas ? canvasX : clampedX;
				const endY = insideCanvas ? canvasY : clampedY;
				const char = this.lineStart.erase ? " " : this.brush;
				this.drawLine(this.lineStart.x, this.lineStart.y, endX, endY, char);
				this.cursorX = endX;
				this.cursorY = endY;
				this.setStatus(
					this.lineStart.erase
						? `Erased line to ${endX + 1},${endY + 1}.`
						: `Drew line to ${endX + 1},${endY + 1}.`,
				);
			}

			this.activeStroke = null;
			this.lineStart = null;
			this.linePreviewEnd = null;
			return;
		}

		if (this.mode === "line" && this.lineStart && event.motion) {
			this.cursorX = clampedX;
			this.cursorY = clampedY;
			this.linePreviewEnd = { x: clampedX, y: clampedY };
			return;
		}

		if (!insideCanvas) return;

		this.cursorX = canvasX;
		this.cursorY = canvasY;

		if (this.mode === "text") {
			if (!event.motion && event.button === 2) {
				this.pushUndo();
				this.paintCell(canvasX, canvasY, " ");
				this.setStatus(`Erased at ${canvasX + 1},${canvasY + 1}.`);
			}
			return;
		}

		if (this.mode === "line") {
			if (!event.motion) {
				if (event.button === 0 || event.button === 2) {
					this.pushUndo();
					const erase = event.button === 2;
					this.lineStart = { x: canvasX, y: canvasY, erase };
					this.linePreviewEnd = { x: canvasX, y: canvasY };
					this.setStatus(
						erase
							? `Line erase start at ${canvasX + 1},${canvasY + 1}.`
							: `Line start at ${canvasX + 1},${canvasY + 1}.`,
					);
				}
				return;
			}

			if (this.lineStart) {
				this.linePreviewEnd = { x: canvasX, y: canvasY };
			}
			return;
		}

		if (!event.motion) {
			if (event.button === 0) {
				this.pushUndo();
				this.activeStroke = "draw";
				this.paintCell(canvasX, canvasY, this.brush);
				return;
			}

			if (event.button === 2) {
				this.pushUndo();
				this.activeStroke = "erase";
				this.paintCell(canvasX, canvasY, " ");
				return;
			}

			this.activeStroke = null;
			return;
		}

		if (this.activeStroke === "draw") {
			this.paintCell(canvasX, canvasY, this.brush);
		} else if (this.activeStroke === "erase") {
			this.paintCell(canvasX, canvasY, " ");
		}
	}

	private renderModeLabel(): string {
		switch (this.mode) {
			case "freeform":
				return this.theme.fg("accent", this.theme.bold("FREEFORM"));
			case "line":
				return this.theme.fg("warning", this.theme.bold("LINE"));
			case "text":
				return this.theme.fg("success", this.theme.bold("TEXT"));
		}
	}

	private getLinePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
		const points: Point[] = [];

		let currentX = x0;
		let currentY = y0;
		const deltaX = Math.abs(x1 - x0);
		const deltaY = Math.abs(y1 - y0);
		const stepX = x0 < x1 ? 1 : -1;
		const stepY = y0 < y1 ? 1 : -1;
		let err = deltaX - deltaY;

		while (true) {
			points.push({ x: currentX, y: currentY });
			if (currentX === x1 && currentY === y1) break;
			const twiceErr = err * 2;
			if (twiceErr > -deltaY) {
				err -= deltaY;
				currentX += stepX;
			}
			if (twiceErr < deltaX) {
				err += deltaX;
				currentY += stepY;
			}
		}

		return points;
	}

	private drawLine(x0: number, y0: number, x1: number, y1: number, char: string): void {
		const normalized = normalizeCellCharacter(char);
		for (const point of this.getLinePoints(x0, y0, x1, y1)) {
			this.paintCell(point.x, point.y, normalized);
		}
	}

	private getLinePreviewPoints(): Set<string> {
		const points = new Set<string>();
		if (this.mode !== "line" || !this.lineStart || !this.linePreviewEnd) return points;

		for (const point of this.getLinePoints(
			this.lineStart.x,
			this.lineStart.y,
			this.linePreviewEnd.x,
			this.linePreviewEnd.y,
		)) {
			points.add(`${point.x},${point.y}`);
		}

		return points;
	}

	private renderCanvasRow(y: number, previewPoints: Set<string>): string {
		let line = "";
		for (let x = 0; x < this.canvasWidth; x += 1) {
			const key = `${x},${y}`;
			const fromCanvas = this.canvas[y]![x] ?? " ";
			const previewChar =
				previewPoints.has(key) && this.mode === "line"
					? this.lineStart?.erase
						? " "
						: this.brush
					: fromCanvas;

			if (x === this.cursorX && y === this.cursorY) {
				line += `\x1b[7m${previewChar}\x1b[27m`;
			} else {
				line += previewChar;
			}
		}
		return line;
	}

	private isInsideCanvas(x: number, y: number): boolean {
		return x >= 0 && y >= 0 && x < this.canvasWidth && y < this.canvasHeight;
	}

	private paintCell(x: number, y: number, char: string): void {
		if (!this.isInsideCanvas(x, y)) return;
		this.canvas[y]![x] = normalizeCellCharacter(char);
	}

	private moveCursor(dx: number, dy: number): void {
		this.cursorX = Math.max(0, Math.min(this.canvasWidth - 1, this.cursorX + dx));
		this.cursorY = Math.max(0, Math.min(this.canvasHeight - 1, this.cursorY + dy));
		this.setStatus(`Cursor ${this.cursorX + 1},${this.cursorY + 1}.`);
	}

	private setBrush(char: string): void {
		this.brush = normalizeCellCharacter(char);
		const idx = BRUSHES.indexOf(this.brush as (typeof BRUSHES)[number]);
		this.brushIndex = idx >= 0 ? idx : 0;
		this.setStatus(`Brush set to \"${this.brush}\".`);
	}

	private cycleBrush(direction: 1 | -1): void {
		this.brushIndex = (this.brushIndex + direction + BRUSHES.length) % BRUSHES.length;
		this.brush = BRUSHES[this.brushIndex] ?? this.brush;
		this.setStatus(`Brush set to \"${this.brush}\".`);
	}

	private cycleMode(): void {
		const order: DrawMode[] = ["freeform", "line", "text"];
		const currentIndex = order.indexOf(this.mode);
		const next = order[(currentIndex + 1) % order.length] ?? "freeform";
		this.setMode(next);
	}

	private setMode(next: DrawMode): void {
		if (this.mode === next) return;
		this.mode = next;
		this.activeStroke = null;
		this.lineStart = null;
		this.linePreviewEnd = null;

		if (next === "freeform") {
			this.setStatus("Freeform mode: left drag draws, right drag erases.");
		} else if (next === "line") {
			this.setStatus("Line mode: click and drag to preview, release to commit.");
		} else {
			this.setStatus("Text mode: type to place characters, click to move cursor.");
		}
	}

	private insertCharacter(input: string): void {
		const char = normalizeCellCharacter(input);
		this.pushUndo();
		this.paintCell(this.cursorX, this.cursorY, char);

		if (this.cursorX < this.canvasWidth - 1) {
			this.cursorX += 1;
		} else if (this.cursorY < this.canvasHeight - 1) {
			this.cursorX = 0;
			this.cursorY += 1;
		}

		this.setStatus(`Inserted \"${char}\".`);
	}

	private backspace(): void {
		this.pushUndo();

		if (this.cursorX > 0) {
			this.cursorX -= 1;
		} else if (this.cursorY > 0) {
			this.cursorY -= 1;
			this.cursorX = this.canvasWidth - 1;
		}

		this.paintCell(this.cursorX, this.cursorY, " ");
		this.setStatus(`Backspaced at ${this.cursorX + 1},${this.cursorY + 1}.`);
	}

	private deleteAtCursor(): void {
		this.pushUndo();
		this.paintCell(this.cursorX, this.cursorY, " ");
		this.setStatus(`Deleted at ${this.cursorX + 1},${this.cursorY + 1}.`);
	}

	private clearCanvas(): void {
		this.pushUndo();
		for (let y = 0; y < this.canvasHeight; y += 1) {
			for (let x = 0; x < this.canvasWidth; x += 1) {
				this.canvas[y]![x] = " ";
			}
		}
		this.setStatus("Canvas cleared.");
	}

	private pushUndo(): void {
		this.undoStack.push(cloneCanvas(this.canvas));
		if (this.undoStack.length > MAX_HISTORY) {
			this.undoStack.shift();
		}
		this.redoStack = [];
	}

	private undo(): void {
		const snapshot = this.undoStack.pop();
		if (!snapshot) {
			this.setStatus("Nothing to undo.");
			return;
		}

		this.redoStack.push(cloneCanvas(this.canvas));
		if (this.redoStack.length > MAX_HISTORY) {
			this.redoStack.shift();
		}

		this.restoreSnapshot(snapshot);
		this.setStatus("Undid last change.");
	}

	private redo(): void {
		const snapshot = this.redoStack.pop();
		if (!snapshot) {
			this.setStatus("Nothing to redo.");
			return;
		}

		this.undoStack.push(cloneCanvas(this.canvas));
		if (this.undoStack.length > MAX_HISTORY) {
			this.undoStack.shift();
		}

		this.restoreSnapshot(snapshot);
		this.setStatus("Redid change.");
	}

	private restoreSnapshot(snapshot: CanvasGrid): void {
		const restored = createCanvas(this.canvasWidth, this.canvasHeight);
		const restoreHeight = Math.min(this.canvasHeight, snapshot.length);
		const restoreWidth = Math.min(this.canvasWidth, snapshot[0]?.length ?? 0);

		for (let y = 0; y < restoreHeight; y += 1) {
			for (let x = 0; x < restoreWidth; x += 1) {
				restored[y]![x] = snapshot[y]![x] ?? " ";
			}
		}

		this.canvas = restored;
		this.cursorX = Math.max(0, Math.min(this.cursorX, this.canvasWidth - 1));
		this.cursorY = Math.max(0, Math.min(this.cursorY, this.canvasHeight - 1));
		this.lineStart = null;
		this.linePreviewEnd = null;
		this.activeStroke = null;
	}

	private exportArt(): string {
		const lines = this.canvas.map((row) => row.join("").replace(/\s+$/g, ""));

		while (lines.length > 0 && (lines[0] ?? "") === "") {
			lines.shift();
		}
		while (lines.length > 0 && (lines[lines.length - 1] ?? "") === "") {
			lines.pop();
		}

		return lines.join("\n");
	}

	private setStatus(message: string): void {
		this.status = message;
	}
}

async function openDrawModal(ctx: ExtensionCommandContext): Promise<string | null> {
	beginMouseCapture();
	try {
		const value = await ctx.ui.custom(
			(tui, theme, _keybindings, done) => new DrawModal(tui, theme, done),
			{
				overlay: true,
				overlayOptions: {
					row: 0,
					col: 0,
					width: "100%",
					maxHeight: "100%",
					margin: 0,
				},
			},
		);
		return (value ?? null) as string | null;
	} finally {
		endMouseCapture();
	}
}

function formatForEditor(art: string): string {
	const content = art.length > 0 ? art : " ";
	return `\`\`\`text\n${content}\n\`\`\``;
}

async function runDrawCommand(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) return;

	const art = await openDrawModal(ctx);
	if (art === null) {
		ctx.ui.notify("Drawing cancelled.", "info");
		return;
	}

	const existing = ctx.ui.getEditorText();
	const prefix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
	ctx.ui.pasteToEditor(`${prefix}${formatForEditor(art)}\n`);
	ctx.ui.notify("Inserted drawing into editor.", "info");
}

export default function drawExtension(pi: ExtensionAPI) {
	pi.registerCommand("draw", {
		description: "Open a mouse-friendly ASCII drawing modal",
		handler: async (_args, ctx) => {
			await runDrawCommand(ctx);
		},
	});

	pi.on("session_shutdown", async () => {
		forceDisableMouseCapture();
	});
}
