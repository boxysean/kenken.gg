# Themes — four looks behind one flag

The neo-brutalist restyle is still the default. Three alternative directions ship alongside it so
they can be compared on a real phone before anything is chosen or reverted. Nothing was removed.

Pick one with a query parameter:

| Theme | URL |
| --- | --- |
| brutalist (default) | `/?theme=brutalist` — and also `/` with no parameter |
| paper | `/?theme=paper` |
| blueprint | `/?theme=blueprint` |
| editorial | `/?theme=editorial` |

The choice is remembered in `localStorage` under `kenken:theme:v1`, so a refresh keeps it. An
explicit `?theme=` wins over the remembered value, and an unknown value falls back to brutalist
rather than throwing.

## How it works

The styling was already token-driven, so a theme is a re-declaration of token values, not a
rewrite of component CSS:

- `src/theme.ts` resolves the theme (query → storage → default) and `src/App.js` puts it on the
  root element as `data-theme="<name>"`, next to the existing `data-solve-state`.
- `src/App.css` and `public/main.css` each hold the same token region, delimited by
  `/* tokens:begin */` and `/* tokens:end */`: the `:root` block, the `prefers-color-scheme: dark`
  block, then one `[data-theme="…"]` block per alternative theme. **The two regions must stay
  byte-identical** — `src/theme.test.tsx` fails if they drift.
- `blueprint` and `paper` change the clue-numeral face through `--clue-font`; editorial keeps the
  default face and carries its character in button typography instead.
- `--cage-border-width` and `--grid-line-width` keep cage edges visibly heavier than the cell grid
  in every theme; a test asserts the ratio for all four themes in light and dark.
- `--page-ink`, `--page-ink-soft` and `--page-accent` describe text that sits on the page gradient
  rather than on a card surface. They follow the colour scheme and are deliberately **not** set by
  the themes: the gradient stays exactly as it was, so a dark card can sit on a light page
  (`blueprint`) without its headings turning white.

The page gradient (`--bg-top` / `--bg-bottom`) is unchanged in every theme, as are layout, markup
and behaviour.

## Review screenshots

`after/` holds each theme's practice board at 390 px wide, light and dark
(`<theme>-<scheme>-390.png`), captured from a production build served with `vite preview`, in
headless Chrome at device pixel ratio 1.

## Verification run for this change

```
cd web
npm ci               # 229 packages
npm test             # 15 files, 195 tests passed
npm run typecheck    # tsc --noEmit, no output
npm run build        # 141 modules, built ok
```
