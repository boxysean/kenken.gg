# Scan a photo — manual smoke recipe (OCR ticket 7)

How to check by hand that a photo goes all the way to the solver editor, and that the editor's
board can be exported back as a label. The label schema itself is documented in
[`web/src/ocr/README.md`](../web/src/ocr/README.md).

## Run it

```sh
cd web
npm ci
npm run dev
```

Open the URL Vite prints (`http://localhost:5173/` by default) and pick **Solver** in the mode
toggle. The **Scan a photo** button sits under the board.

## The 4×4 clean fixture

1. Click **Scan a photo** and choose `web/e2e/__fixtures__/raw-samples/kenken-4x4-clean.png`.
2. The preview appears, "Scanning…" shows for a moment, then the summary line reads:

   **7** cages found · **7** clues read · **0** cages needing review

3. Click **Load into editor**. The board slider jumps to 4 and the board shows the fixture's
   seven cages with their clues, in reading order:

   ```
   a b b c        a = 2-   b = 2/   c = 6x   d = 3-
   a d d c        e = 2-   f = 12x  g = 1-
   e e f c
   g g f f
   ```

   (`boardStrings` / `constraintString` exactly as in `kenken-4x4-clean.json`.) The editor is
   back in its drawing state: answers cleared, **Solve!** enabled. Any cage can be redrawn and
   any clue retyped as usual before solving.
4. Click **Export JSON**, the solver view's one export control (it sits under the photo panels
   and is there with or without a photo; see [The export control](#the-export-control)). A
   successful scan hands its corners to it, so the browser saves `kenken-label.json`:

   ```json
   {
     "boardSize": 4,
     "cageLetters": ["a b b c", "a d d c", "e e f c", "g g f f"],
     "clues": { "a": { "target": 2, "operator": "-" }, "…": "…" },
     "corners": { "tl": { "x": …, "y": … }, "tr": …, "br": …, "bl": … },
     "source": { "kind": "photo" }
   }
   ```

   (Pretty-printed with two-space indentation; abridged here.) The board is the **editor's
   current board** — so a hand correction made after loading is what gets exported — and the
   corners are the ones the scan detected, unrounded (e.g. `23.999969482421875` for the
   fixture's `24`; within half a pixel of the true frame on all six fixtures). The label is run through `validateLabel` first: if
   the editor board is incomplete (an unset cell, a cage with no clue), the problems are
   listed in red under the button and nothing is downloaded. The button is disabled, with
   the reason shown under it, while the editor board is empty.

## A blank image

Pick any all-white PNG. The panel shows, in red:

> corners: no board frame found (confidence 0.00)

plus "The scan failed, so nothing was loaded into the editor." There is no **Load** button and
the editor board is exactly as it was. A failed scan has no corners, so **Export JSON** would
save the board alone, as `kenken-board.json`.

## The other fixtures

`kenken-5x5-clean`, `kenken-6x6-clean`, `kenken-4x4-noise` and `kenken-5x5-glare` scan with
every clue read. `kenken-6x6-perspective` gets every cage right but leaves one clue unread:
the summary counts it under "cages needing review", and after **Load into editor** that cage
is drawn with an empty clue, to be typed in by hand. A clue the reader is unsure of is always
left blank rather than guessed.

## Not wired yet

- The pipeline runs on the main thread: the page is unresponsive for the moment the scan
  takes. Moving it to a Web Worker is a later ticket.
- The clue reader is template matching against the synthetic renderer's own font, so it is
  only expected to work on the synthetic fixtures. Real newspaper photos will mostly come
  back as "cages needing review" until the learned reader lands (ticket 10).

# Accuracy eval and the sample suite (OCR ticket 8)

Two automated checks guard the pipeline, both on top of the manual recipe above.

## The accuracy eval

```sh
cd web
npm test                                  # the whole vitest suite, eval included
npx vitest run src/ocr/eval/eval.test.ts  # the eval on its own (a few seconds)
```

[`web/src/ocr/eval/manifest.json`](../web/src/ocr/eval/manifest.json) lists 24 synthetic
recipes (`seed`, `boardSize`, `styleTag`), six per style tag. Each is rendered with
`generate` → `renderPuzzle` → `distort` (the same distortion per tag as
`scripts/export-synth.ts`), scanned with `scanPhoto` and the template reader, and scored
against its label:

- **cornerAccuracy** — share of images whose four detected corners are all within
  `tolerance.cornerPx` (2 px) of the true ones. The mean corner error is reported too.
- **edgeAccuracy** — internal edges classified correctly as thick (different cages) or thin
  (same cage), over all internal edges. A failed scan scores 0 for its edges.
- **clueAccuracy** — of the clues the scan *committed* to, the share whose target and
  operator are right. A clue only counts as right when its cage has exactly the cells of a
  real cage. Declined clues are not counted here; they show up as **coverage**
  (committed / total cages). With nothing committed at all the accuracy is `null`, scored as
  1.0 against the floor: no reading was wrong.
- **wholePuzzle** — share of images with no errors, the right partition, every clue read and
  right, and a board the solver solves.

The test prints one row per style tag, for example:

```
styleTag     fixtures  corner  edge    clue    coverage  whole   passes
-----------  --------  ------  ------  ------  --------  ------  ------
clean        6         100.0%  100.0%  100.0%  100.0%    100.0%  6/6
noise        6         100.0%  100.0%  100.0%  75.4%     16.7%   1/6
glare        6         100.0%  100.0%  100.0%  100.0%    100.0%  6/6
perspective  6         100.0%  100.0%  100.0%  100.0%    100.0%  6/6
```

and writes the full per-image report to `web/src/ocr/eval/last-report.json`. That file is
gitignored: it is for reading, not for committing.

The `floors` in the manifest are the **regression baseline**: the test fails if any metric for
any style tag drops below its floor. They were set from the first run, a little below what was
measured (0.90 where 1.00 was measured; 0.15 for noise's whole-puzzle 1/6, where the reader
declines about a quarter of the noisy clues). When the pipeline gets better, raise the floors
in the same change so the gain is locked in. Never lower one to make a change pass.

## The Playwright sample suite

```sh
cd web
npx playwright install chromium   # once per machine
npm run test:e2e
```

This builds the app (`vite build`), serves it with `vite preview` on port 4173 and, for every
PNG under [`web/e2e/__fixtures__/samples/`](../web/e2e/__fixtures__/samples/), drives the real
UI in Chromium: pick the image with **Scan a photo**, wait for the summary, check there are no
errors, **Load into editor**, then compare every editor cell (its clue text and its four cage
borders) with `<name>.expected.json`, a `ScannedBoard` (`boardSize`, `cageLetters`, `clues`).

The five committed samples are written by `npm run samples:export`
([`web/scripts/export-samples.ts`](../web/scripts/export-samples.ts)); rerunning it rewrites
identical files.

## A failing image becomes a sample

Any image that fails — an eval recipe, a manual test, or a user report — becomes a committed
sample plus its expected board, so a fix cannot silently regress it:

1. Add `<name>.png` and `<name>.expected.json` (the correct `ScannedBoard`, checked by hand or
   taken from the synthetic label minus `corners` and `source`) under
   `web/e2e/__fixtures__/samples/`. For a synthetic image, add it to
   `scripts/export-samples.ts` and run `npm run samples:export` rather than writing files by
   hand.
2. If the image is synthetic, also add its recipe to `web/src/ocr/eval/manifest.json`.
3. Fix the pipeline, then run `npm test` (the eval, against the committed floors) and
   `npm run test:e2e` (every sample, through the UI). Both must pass.
4. If the fix raised a metric, raise its floor in the manifest too.

The sample suite only holds images that scan fully. One that is still expected to leave a clue
unread (like `raw-samples/kenken-6x6-perspective`) belongs in the eval, where coverage is
measured, until the fix that makes it pass lands with it.

# Label a photo by hand, and the label check

## Labelling a photo the scanner cannot read

Corner detection fails on most real photos, so a label can be made by hand instead. In the
**Solver** view, under **Scan a photo**:

1. Click **Label a photo** and choose the image. The prompt above it names the next corner.
2. Click the board's four corners in order: top-left, top-right, bottom-right, bottom-left.
   Numbered markers 1–4 appear and the prompt reads "All four corners marked"; further clicks
   are ignored. **Undo** removes the last corner.
3. Pick the **Board size** (4×4 to 9×9) and click **Open in editor**. The editor loads an empty
   board of that size; the corners stay marked on the photo.
4. Draw every cage and type its clue as usual.
5. With four corners marked, the export control shows a **Style tag** field. Optionally type
   one (e.g. `newspaper`), then click **Export JSON**. The browser saves `kenken-label.json`
   with `"source": { "kind": "photo", "styleTag": … }`.

The corners are exported in the **photo's own pixels**, not the scaled pixels it is displayed
at. Undoing a corner, or picking a new photo, takes the corners away from the export again
until all four are marked. `web/e2e/label.spec.ts` drives this whole path in Chromium
(`npm run test:e2e`), and also exports a board drawn with no photo at all.

## The export control

The solver view has one **Export JSON** button, under the photo panels. It is always there,
photo or not, and is disabled — with "Draw at least one cage on the board to export it." under
it — only while the editor board is empty. It exports the **editor's current board**, and saves
one of two files:

- **`kenken-label.json`** — the full label: the board plus the photo's four corners (from a
  successful scan, or the four clicked in **Label a photo**), `"source": { "kind": "photo" }`
  and the optional style tag. Usable for crop extraction.
- **`kenken-board.json`** — the board alone, when there are no corners: `"source": { "kind":
  "manual" }` and no `corners` key at all. It is a complete cage map, so still training data,
  but it cannot yield photo crops.

Either way the file goes through `validateLabel` first: if it is invalid (an unset cell, a cage
with no clue, a cage name outside the printable alphabet) the problems are listed in red and
nothing is downloaded. `validateLabel` accepts a label with no `corners`; corners that are
present must be a full `{tl, tr, br, bl}` quad of finite `{x, y}` points.

## Checking label files

```sh
cd web
npm run check:labels                         # e2e/__fixtures__/raw-samples
npm run check:labels -- path/to/new-labels   # any folder of label .json files
```

It prints one line per `.json` file, for example `kenken-4x4-clean.json: ok`:

- **ok** — a valid label whose puzzle has exactly one solution.
- **invalid: …** — not JSON, the wrong shape, or `validateLabel` problems, listed after the colon.
- **no solution** — the cages and clues contradict each other.
- **not unique (N solutions)** — more than one solution (counting stops at 3).

The exit code is non-zero if any file is not ok. Uniqueness is the check that matters for hand
labels: a misdrawn cage or a misread clue still makes a perfectly valid label, but a real
KenKen has exactly one solution, and a wrong cage almost never keeps it that way.
