# recap

Fast session recap command for Pi.

## What it does

Adds `/recap` to summarize the current session with:

- deterministic stats (messages, tools, files, recent requests/outcomes)
- optional one-line LLM summary (`TL;DR: ...`)
- `raw` mode to skip the LLM call

## Install

### Simple (single-file install)

```bash
pi install -l ./extensions/recap/index.ts
```

Then run `/reload` in Pi.

### Monorepo install (git) + filter to recap only

```bash
pi install -l git:github.com/benvinegar/pi-stuff
```

`.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/benvinegar/pi-stuff",
      "extensions": ["extensions/recap/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Run `/reload` after editing settings.

## Usage

```text
/recap
/recap raw
/recap full
```

## Example output

```text
TL;DR: Added extension README splits, tightened root docs, and next step is validating install snippets against a clean Pi profile.

Session recap

- Duration: 24m
- Messages: 8 user, 9 assistant
- Tool calls: 17 (read×8, write×5, edit×3, bash×1)
- Files: 6 changed, 4 read

Recent requests:
- Split extension docs into per-extension README files.
- Add simple install instructions for monorepo usage.

Recent outcomes:
- Root README converted to compact OSS catalog.
- Added README.md for draw, kernel, pr-track, and recap.
```
