# kernel

Kernel cloud browser extension for Pi.

## What it does

Adds a `/kernel` command and four tools for remote browser automation:

- `kernel_browser` — create/list/get/delete/prune sessions
- `kernel_playwright` — run Playwright TypeScript remotely
- `kernel_screenshot` — capture current page
- `kernel_computer` — click/type/drag/scroll/keypress actions

## Requirements

Set your API key before using it:

```bash
export KERNEL_API_KEY=...
```

## Install

### Simple (single-file install)

```bash
pi install -l ./extensions/kernel/index.ts
```

Then run `/reload` in Pi.

### Monorepo install (git) + filter to kernel only

```bash
pi install -l git:github.com/benvinegar/pi-stuff
```

`.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/benvinegar/pi-stuff",
      "extensions": ["extensions/kernel/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Run `/reload` after editing settings.

## Usage

### Command flow

```text
/kernel create
/kernel
```

### Tool flow

```text
kernel_browser(action="create")
kernel_playwright(code="await page.goto('https://example.com'); return await page.title();")
kernel_screenshot()
```

## Hypothetical output

```text
> kernel_browser(action="create")
Browser created and set as active.
id: 7d1f3b9a2c1d... | stealth | live: https://... | timeout: 300s

Status widget:
Kernel: 7d1f3b9a2c1d… · example.com · age 12m · timeout 300s

> kernel_playwright(...)
Example Domain

> kernel_screenshot()
[image/png returned]
Screenshot captured.
```

## Notes

- Sessions are not auto-deleted on Pi shutdown.
- `/kernel prune --older-than=24h --dry-run=true` is useful for cleanup previews.
