# pr-track

Session-aware GitHub PR tracker for Pi.

## What it does

Tracks PRs during your session, refreshes status in the background, and renders a compact widget with:

- CI status/progress
- review state
- merge state

It also auto-detects `gh pr create` output and starts tracking new PR URLs.

## Requirements

`gh` CLI must be installed and authenticated for the repo.

## Install

### Simple (single-file install)

```bash
pi install -l ./extensions/pr-track/index.ts
```

Then run `/reload` in Pi.

### Monorepo install (git) + filter to pr-track only

```bash
pi install -l git:github.com/benvinegar/pi-stuff
```

`.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/benvinegar/pi-stuff",
      "extensions": ["extensions/pr-track/index.ts"],
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
/pr list
/pr track 42
/pr open 42
/pr refresh
/pr untrack 42
/pr *
```

## Example output

```text
PR Tracker (2)
#42 Ship tracker tests   CI:[====~~~] RV:… MG:○
#77 Auto tracked         CI:[=======] RV:✓ MG:○

> /pr list
Tracked PRs:
#42 Ship tracker tests
  CI:pending · review:pending · merge:open
  https://github.com/acme/repo/pull/42
#77 Auto tracked
  CI:green · review:approved · merge:open
  https://github.com/acme/repo/pull/77
```
