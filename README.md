```
_______________________________________________________________________________/\\\\\________/\\\\\_        
 _____________________________________________________________________________/\\\///_______/\\\///__       
  ___/\\\\\\\\\___/\\\____________________________/\\\________________________/\\\__________/\\\______      
   __/\\\/////\\\_\///_____________/\\\\\\\\\\__/\\\\\\\\\\\__/\\\____/\\\__/\\\\\\\\\____/\\\\\\\\\___     
    _\/\\\\\\\\\\___/\\\___________\/\\\//////__\////\\\////__\/\\\___\/\\\_\////\\\//____\////\\\//____    
     _\/\\\//////___\/\\\___________\/\\\\\\\\\\____\/\\\______\/\\\___\/\\\____\/\\\_________\/\\\______   
      _\/\\\_________\/\\\___________\////////\\\____\/\\\_/\\__\/\\\___\/\\\____\/\\\_________\/\\\______  
       _\/\\\_________\/\\\____________/\\\\\\\\\\____\//\\\\\___\//\\\\\\\\\_____\/\\\_________\/\\\______ 
        _\///__________\///____________\//////////______\/////_____\/////////______\///__________\///_______
```


# bentlegen's Pi Stuff

Open-source Pi extensions that I use.

## What's in here?

| Extension | Purpose | Command(s) | Docs |
|---|---|---|---|
| `draw` | Mouse-friendly ASCII drawing overlay | `/draw` | [`draw/README.md`](./extensions/draw/README.md) |
| `kernel` | Cloud browser sessions + Playwright + low-level computer control | `/kernel`, `kernel_*` tools | [`kernel/README.md`](./extensions/kernel/README.md) |
| `pr-track` | Track PR status in-session with CI/review/merge widget | `/pr ...` | [`pr-track/README.md`](./extensions/pr-track/README.md) |
| `recap` | Fast session recap with optional one-line LLM TL;DR | `/recap` | [`recap/README.md`](./extensions/recap/README.md) |
| `whimsical-toronto` | Toronto-slang working messages while Pi is thinking | automatic | [`whimsical-toronto/README.md`](./extensions/whimsical-toronto/README.md) |

## Install with Pi

Because this is a monorepo, you have two practical install paths.

### Option A: Clone repo & install individual files

```bash
git clone git@github.com:benvinegar/pi-stuff.git
pi install -l ./pi-stuff/extensions/draw/index.ts
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

## Development/Contributing

```bash
npm install
npm run lint
npm test
```

## License

MIT — see [LICENSE](./LICENSE).
