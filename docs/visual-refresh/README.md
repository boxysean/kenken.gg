# kenken.gg visual refresh — review screenshots

Before/after evidence for issue #85 ("Refresh the look and feel of kenken.gg").

## How these were taken

- `before/` — the app built from `master` (`1c64a9b`): `npm ci && npm run build` in `web/`, served
  as static files, driven in headless Chrome.
- `after/` — the same app built from this branch, same server, same browser, same viewport sizes.
- Desktop viewport 1280×900, mobile viewport 375×760, device pixel ratio 2 (images downscaled 50%
  after capture).
- Cages were drawn by dispatching real `mousedown`/`mousemove`/`mouseup` on the cells (the same
  events a mouse drag fires) and the solver was run by clicking **Solve!** — these are live runs,
  not mocked states.

## What is in each folder

| File | Shows |
| --- | --- |
| `desktop-default.png` | empty 5×5 board, Inputting state |
| `desktop-modal.png` | a three-cell cage selected, cage modal open with a value typed |
| `desktop-success.png` | 3×3 board fully caged (three `6x` rows), solved, Success state |
| `desktop-failure.png` | 3×3 board caged with unsolvable `5x` rows, Failure state |
| `mobile-default.png` | as above at 375px |
| `mobile-modal.png` | modal at 375px — all five operator buttons on one row |
| `mobile-success.png` | solved board and answers at 375px |
| `mobile-failure.png` | failure state at 375px |
| `mobile-9x9.png` | the largest board (9×9) at 375px, no horizontal scroll |
| `mobile-9x9-labels.png` | 9×9 with real constraint labels (`17+`, `12x`, `9`) |
| `desktop-dark-default.png`, `desktop-dark-modal.png` | `prefers-color-scheme: dark` |
| `desktop-focus-slider.png`, `desktop-focus-solve.png`, `desktop-focus-modal-close.png` | visible keyboard focus rings |
| `desktop-debug.png` | `?debug=true` overlay |
| `desktop-about.png` | `/about.html` |

`before/` has the four states the issue names (default, modal, solved, failure) at desktop plus the
default and solved board at mobile; the old design had no dark mode.

## Verification run for this change

```
cd web
npm ci          # 224 packages
npm test        # 4 files, 62 tests passed
npm run typecheck   # tsc --noEmit, no output
npm run build   # 115 modules, built ok
grep -c fonts.googleapis dist/assets/*.css   # 0
```

Local Node is 22.23.2; CI pins Node 20 (`netlify.toml` and `.github/workflows/test.yaml` agree).
