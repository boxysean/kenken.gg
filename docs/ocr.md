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
4. Click **Download label JSON**. The browser saves `kenken-label.json`:

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
   listed in red under the summary and nothing is downloaded. The button is disabled while
   the editor board is empty.

## A blank image

Pick any all-white PNG. The panel shows, in red:

> corners: no board frame found (confidence 0.00)

plus "The scan failed, so nothing was loaded into the editor." There is no **Load** or
**Download** button and the editor board is exactly as it was.

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
