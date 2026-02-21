# pi-stuff

Open-source Pi extensions and skills pulled from my personal dotfiles.

## Contents

- `extensions/kernel` — Kernel cloud browser extension
- `extensions/pr-track` — PR tracking extension for GitHub workflows
- `skills/` — space for reusable Pi skills

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
