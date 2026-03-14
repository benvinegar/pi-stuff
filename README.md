# pi-stuff

Open-source Pi extensions and skills pulled from my personal dotfiles.

## Contents

- `extensions/draw` — Mouse-friendly ASCII drawing modal (`/draw`)
- `extensions/kernel` — Kernel cloud browser extension
- `extensions/pr-track` — PR tracking extension for GitHub workflows (`/pr ...` subcommands)
- `extensions/recap` — Session recap extension with deterministic + fast LLM summary
- `extensions/whimsical-toronto` — Toronto slang working messages during agent turns
- `skills/` — space for reusable Pi skills

## Extensions

### `kernel` (cloud browser control + automation)

This extension adds tools and a `/kernel` command to manage Kernel browser sessions, run Playwright code remotely, take screenshots, and send low-level mouse/keyboard actions.

```text
You
 │
 ├─ /kernel create
 ├─ kernel_playwright(code)
 ├─ kernel_screenshot()
 └─ kernel_computer(click/type/...)
      │
      ▼
Pi extension (extensions/kernel)
      │
      ▼
Kernel cloud browser session
      │
      ▼
Live page + returned text/image results
```

#### Kernel Pi UI example

```text
Kernel: work-profile (7d1f3b9a2c1d…) · github.com · age 12m · timeout 300s
```

### `pr-track` (session-aware PR tracker)

This extension watches PR-related activity, tracks PRs in session state, and renders a compact status widget (CI/review/merge) inside the Pi UI.

```text
gh pr create / /pr track 42 / /pr *
                │
                ▼
Pi extension (extensions/pr-track)
  ├─ gh pr view --json ...
  ├─ persist tracked PR state in session
  └─ refresh on events/tool results
                │
                ▼
UI widget + status line

PR Tracker (2)
#42 Ship tracker tests   CI:[====~~~] RV:… MG:○
#77 Auto tracked         CI:[=======] RV:✓ MG:○
```

### `recap` (session snapshot + LLM TL;DR)

Adds `/recap` to summarize the current session quickly:

- deterministic stats (messages, tools, files, recent requests/outcomes)
- optional fast LLM sentence at the top (`TL;DR: ...`)
- `/recap raw` to skip the LLM call

### `draw` (mouse-friendly ASCII drawing modal)

Adds `/draw`, a full-screen overlay canvas for sketching ASCII art and inserting it into the editor as a fenced `text` block.

Controls:

- mouse (`line`): drag from one coordinate to another for a straight line (left draw, right erase)
- mouse (`box`): left drag-select to place an auto-connected box, right drag-select to erase box edges
- keyboard: `Ctrl+T` mode cycle (`box` / `line` / `text`)
- keyboard: `Ctrl+Z` undo, `Ctrl+Y` redo, `Ctrl+X` clear
- keyboard: `[` / `]` brush cycle in line mode, `Enter` save, `Esc` cancel

Box mode notes:

- corners/tees/crossings auto-resolve with box-drawing glyphs
- outer boxes render heavy by default; nested inner boxes render lighter

### `whimsical-toronto` (Toronto slang working messages)

Replaces the default "working..." spinner text with Toronto slang phrases while the agent is thinking.

```text
Mossin' on these tokens rn...
Bare computation happening styll...
Merked that last bug fr...
Wagwan with this stack trace...
```

Drop it in `~/.pi/agent/extensions/` or `.pi/extensions/` to activate. Works standalone — no config needed.

## Development

```bash
npm install
npm run lint
npm test
```

- `npm run lint` runs Biome and TypeScript type checking.

## Notes

- `extensions/kernel` requires `KERNEL_API_KEY` at runtime.
- The Vitest suite uses local stubs/mocks so tests run without external services.

## Source

Initial extension sources were copied from:
- `~/Projects/dotfiles/pi/extensions/draw.ts`
- `~/Projects/dotfiles/pi/extensions/kernel/index.ts`
- `~/Projects/dotfiles/pi/extensions/pr-tracker.ts`
- `~/Projects/dotfiles/pi/extensions/recap.ts`
- `~/Projects/dotfiles/pi/extensions/whimsical-toronto.ts`

## License

MIT — see [LICENSE](./LICENSE).
