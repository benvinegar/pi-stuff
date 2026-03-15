# whimsical-toronto

Pi extension that swaps default "working..." text with Toronto-flavored slang while the agent is thinking.

## What it does

On `turn_start`, it sets a random phrase for the working spinner.

No config, no dependencies.

## Install

### Simple (single-file install)

```bash
pi install -l ./extensions/whimsical-toronto/index.ts
```

Then run `/reload` in Pi.

### Monorepo install (git) + filter to whimsical-toronto only

```bash
pi install -l git:github.com/benvinegar/pi-stuff
```

`.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/benvinegar/pi-stuff",
      "extensions": ["extensions/whimsical-toronto/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Run `/reload` after editing settings.

## Hypothetical output

```text
Mossin' on these tokens rn...
Bare computation happening styll...
Merked that last bug fr...
Wagwan with this stack trace...
Toque on, brain engaged...
```

## Notes

- If you also load another extension that sets the working message on `turn_start`, the last one to run wins.
- Phrase list lives in `index.ts` and is easy to customize.
