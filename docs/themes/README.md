# Themes — paper, plus two alternates behind one flag

Paper — a printed puzzle book: warm, quiet, borders that do no decoration — is the shipped theme
and what `/` shows. Two alternative directions remain available behind a query parameter:

| Theme | URL |
| --- | --- |
| paper (default) | `/` with no parameter, or `/?theme=paper` |
| blueprint | `/?theme=blueprint` |
| editorial | `/?theme=editorial` |

The choice is remembered in `localStorage` under `kenken:theme:v1`, so a refresh keeps it. An
explicit `?theme=` wins over the remembered value, and an unknown value falls back to paper
rather than throwing.

## How it works

The styling is token-driven, so a theme is a re-declaration of token values, not a rewrite of
component CSS:

- `src/theme.ts` resolves the theme (query → storage → default) and `src/App.js` puts it on the
  root element as `data-theme="<name>"`, next to the existing `data-solve-state`.
- `src/App.css` and `public/main.css` each hold the same token region, delimited by
  `/* tokens:begin */` and `/* tokens:end */`: the `:root` block (which *is* paper's light
  palette), the `prefers-color-scheme: dark` block, then one top-level `[data-theme="…"]` block
  per alternative theme. **The two regions must stay byte-identical** — `src/theme.test.tsx`
  fails if they drift.
- Dark mode: paper follows the colour scheme. Its dark variant is a `[data-theme="paper"]` block
  nested inside the `prefers-color-scheme: dark` block, so a dark-mode visitor gets a warm dark
  sheet instead of a cream card on a dark page. Paper deliberately has no top-level block — one
  would come later in the cascade and override the dark values. Blueprint and editorial are fixed
  palettes: their top-level blocks set every surface token and look the same in either scheme.
- Each theme sets its own clue-numeral face through `--clue-font`: a serif for paper, the
  monospace face for blueprint, and the rounded display face for editorial, which carries its
  character in button typography instead.
- `--cage-border-width` and `--grid-line-width` keep cage edges visibly heavier than the cell grid
  in every theme; a test asserts the ratio for all three themes in light and dark.
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
npm ci               # installs from the lockfile
npm test             # 30 files, 332 tests passed
npm run typecheck    # tsc --noEmit, no output
npm run build        # built in 12.73s
```

The acceptance behaviour was also checked against the production build served by `vite preview`,
in headless Chromium at 390 px, light and dark: `/` and `/?theme=brutalist` both render paper
with no page errors, `?theme=blueprint` and `?theme=editorial` still select their themes, a stored
theme survives a reload with no parameter, an explicit parameter overrides it, and paper's
computed dark tokens are `--surface: #1b1815`, `--cage-border: #efe7d8` with a 2 px cage border
against a 1 px grid line.
