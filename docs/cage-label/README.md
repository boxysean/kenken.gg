# Cage label — bigger and playful (issue #87)

Before/after evidence for issue #87: the cage label (`9+`, `12×`) was too small on a
phone and read as a system font.

## How these were taken

- `before/` — the app built from `master` (`d34362c`): `npm ci && npm run build` in `web/`,
  served with `vite preview`, driven in headless Chrome.
- `after/` — the same app built from this branch, same server, same browser, same viewport.
- Phone viewport 390×844, device pixel ratio 2 (images are the raw capture, not downscaled).
- Cages were drawn by dispatching real `mousedown`/`mousemove`/`mouseup` on the cells, and the
  solved state was reached by clicking **Solve!** — live runs, not mocked states.

## Label size measured in the browser

`getComputedStyle(.PlayCellLabel).fontSize` / `(.CellLabel).fontSize`:

| Board | Cell width | Before | After |
| --- | --- | --- | --- |
| Play 4×4 | 88.7px | 12.8px sans | **20px Baloo 2** |
| Play 9×9 | 39.4px | 8.8px sans | **11.96px Baloo 2** |
| Solver 3×3 | 118.3px | 9.6px sans | **20px Baloo 2** |

## Fit at the smallest cell

The worst-case label is three digits plus an operator (`1680×`, `2970÷`), the longest
seen across 274 labels sampled from ten generated 9×9 puzzles. Rendered width in a
9×9 cell, `slack` = distance from the label's right edge to the cell's right edge:

| Viewport | Cell | Label | `144÷` | `1680×` | `2970÷` |
| --- | --- | --- | --- | --- | --- |
| 320px | 32.3px | 10px | 8.4px slack | 3.2px slack | 2.5px slack |
| 390px | 39.4px | 11.96px | 11.5px slack | 5.3px slack | 4.4px slack |
| 430px | 43.5px | 13.19px | 13px slack | 6.2px slack | 5.3px slack |

Nothing clips or wraps; the document never scrolls horizontally.

## What is in each folder

| File | Shows |
| --- | --- |
| `before/solver-3.png`, `after/solver-3.png` | 3×3 solver board with drawn cages (`9+`, `9/`, `27x`) |
| `before/play-4.png`, `after/play-4.png` | a generated 4×4 practice puzzle — the most common phone board |
| `before/play-9.png`, `after/play-9.png` | a generated 9×9 puzzle, the smallest cells |
| `after/solved-3.png` | solved 3×3 — answers keep their original size, face and centred layout |
| `after/play-4-font-blocked.png` | the same 4×4 puzzle with `/fonts/baloo2-cage-700.woff2` blocked: the label falls back and the board still plays |
| `after/cell-9x9-pencils-zoom.png` | one 9×9 cell at 6× with a label and pencil marks in it |
