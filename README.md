# pi-stuff

Open-source Pi extensions and skills pulled from my personal dotfiles.

## Contents

- `extensions/kernel` — Kernel cloud browser extension
- `extensions/pr-track` — PR tracking extension for GitHub workflows
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

#### Kernel Pi UI examples

```text
Status line (no active browser)
Kernel: none · run /kernel or kernel_browser create

Status line (active + healthy)
Kernel: work-profile (7d1f3b9a2c1d…) · github.com · age 12m · timeout 300s

Status line (active + busy)
Kernel: work-profile (7d1f3b9a2c1d…) · busy (playwright 3s)
```

```text
/kernel

Kernel Browsers (select to set active):
○ 2f2b1c0d-.... (stealth, gui)
● 7d1f3b9a-.... (stealth, gui, profile:work-profile)

[select updates active session]
```

```text
kernel_browser({ action: "prune", older_than: "2h", dry_run: true })

Prune dry-run: 2 session(s) would be deleted.
- id: 2f2b1c0d-... | stealth | live: https://... | created: ...
- id: 13dd9a8f-... | stealth | live: https://... | created: ...
```

### `pr-track` (session-aware PR tracker)

This extension watches PR-related activity, tracks PRs in session state, and renders a compact status widget (CI/review/merge) inside the Pi UI.

```text
gh pr create / /pr-track 42 / /pr-refresh
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
- `~/Projects/dotfiles/pi/extensions/kernel/index.ts`
- `~/Projects/dotfiles/pi/extensions/pr-tracker.ts`

## License

MIT — see [LICENSE](./LICENSE).
