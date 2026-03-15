# pi-stuff

Open-source Pi extensions focused on practical coding workflows.

## What this repo includes

- 5 extensions under `extensions/`
- TypeScript source + tests for extension behavior
- Example-ready docs for installing and using each extension

## Quick start

```bash
npm install
npm run lint
npm test
```

## Install with Pi

Because this is a monorepo, you have two practical install paths.

### Option A: install one extension file directly (simplest)

```bash
# project-local install
pi install -l ./extensions/draw/index.ts
```

Use the matching `index.ts` path for any extension, then run `/reload` in Pi.

### Option B: install the full monorepo package, then filter

```bash
pi install -l git:github.com/benvinegar/pi-stuff
```

Then in `.pi/settings.json`, keep only the extension you want:

```json
{
  "packages": [
    {
      "source": "git:github.com/benvinegar/pi-stuff",
      "extensions": ["extensions/draw/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Run `/reload` after updating settings.

## Extension catalog

| Extension | Purpose | Command(s) | Docs |
|---|---|---|---|
| `draw` | Mouse-friendly ASCII drawing overlay | `/draw` | [`extensions/draw/README.md`](./extensions/draw/README.md) |
| `kernel` | Cloud browser sessions + Playwright + low-level computer control | `/kernel`, `kernel_*` tools | [`extensions/kernel/README.md`](./extensions/kernel/README.md) |
| `pr-track` | Track PR status in-session with CI/review/merge widget | `/pr ...` | [`extensions/pr-track/README.md`](./extensions/pr-track/README.md) |
| `recap` | Fast session recap with optional one-line LLM TL;DR | `/recap` | [`extensions/recap/README.md`](./extensions/recap/README.md) |
| `whimsical-toronto` | Toronto-slang working messages while Pi is thinking | automatic | [`extensions/whimsical-toronto/README.md`](./extensions/whimsical-toronto/README.md) |

## Repo layout

```text
extensions/
  draw/
  kernel/
  pr-track/
  recap/
  whimsical-toronto/
skills/
```

## License

MIT — see [LICENSE](./LICENSE).
