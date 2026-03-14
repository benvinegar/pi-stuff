# whimsical-toronto

A pi extension that replaces the default "working..." spinner text with Toronto (and broader Canadian) slang phrases while the agent is thinking.

## Examples

```
I'm out here compiling g...
Mossin' on these tokens rn...
Bare computation happening styll...
Merked that last bug fr...
Wagwan with this stack trace...
Szeen, processing...
Toque on, brain engaged...
Give'r on this build...
Beauty, found something...
```

## Install

Drop `index.ts` into your pi extensions directory:

```bash
# Global (all projects)
cp index.ts ~/.pi/agent/extensions/whimsical-toronto.ts

# Project-local
cp index.ts .pi/extensions/whimsical-toronto.ts
```

Then `/reload` in pi.

## Notes

- No config or dependencies — works out of the box.
- If you're also running the default `whimsical.ts` extension, remove it; both set the working message on `turn_start` and they'll race.
- Phrases are hardcoded in `index.ts` — add or remove lines freely.

## Slang sources

- [Queen's Journal Toronto Slang Dictionary](https://www.queensjournal.ca/the-toronto-slang-dictionary/)
- [wikiHow: Toronto Slang Words](https://www.wikihow.com/Toronto-Slang-Words)
- [Narcity: Toronto Slang Words](https://www.narcity.com/toronto/toronto-slang-words)
- [Contiki: Canadian Slang Words](https://www.contiki.com/six-two/article/canadian-slang-words/)
