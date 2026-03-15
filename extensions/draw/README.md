# draw

Mouse-friendly ASCII drawing modal for Pi.

## What it does

`/draw` opens a full-screen overlay canvas so you can sketch diagrams and insert them into the editor as a fenced `text` block.

- Line mode: drag to draw straight lines
- Box mode: drag to create auto-connected box-drawing UI frames
- Text mode: type directly onto the canvas

## Install

### Simple (single-file install)

```bash
pi install -l ./extensions/draw/index.ts
```

Then run `/reload` in Pi.

### Monorepo install (git) + filter to draw only

```bash
pi install -l git:github.com/benvinegar/pi-stuff
```

`.pi/settings.json`:

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

Run `/reload` after editing settings.

## Usage

```text
/draw
```

Key controls:

- `Ctrl+T`: cycle `box` / `line` / `text`
- `Ctrl+Z` / `Ctrl+Y`: undo / redo
- `Ctrl+X`: clear
- `[` / `]`: brush cycle in line mode
- `Enter`: save to editor
- `Esc`: cancel

## Example output

### Modal while drawing

```text
╭──────────────────────────────────────────────────────────────────────────────╮
│ /draw  mode:BOX  brush:"#"                                                  │
│ Enter save • Esc cancel • Ctrl+T mode(box/line/text) • Ctrl+Z undo ...      │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓                                             │
│ ┃            Service           ┃                                             │
│ ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫                                             │
│ ┃  input ───────▶ process      ┃                                             │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛                                             │
╰──────────────────────────────────────────────────────────────────────────────╯
```

### Inserted into the editor after pressing Enter

````text
```text
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃            Service           ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃  input ───────▶ process      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```
````
