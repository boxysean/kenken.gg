# Real-photograph scan run — five public photos, end to end

The ten OCR tickets were proved against synthetic renders and a Playwright sample suite.
None of them proved the pipeline works on **something a person actually photographed**, which
is the only thing the feature is for. This directory records that check: five genuine
photographs of printed KenKen/Kendoku puzzles, sourced from the open web because Sean was not
available to shoot them, each run through the real app flow.

**The images themselves are NOT committed here.** Every one is third-party copyright with no
redistribution licence (newspaper pages, a company press photo, Reddit/Imgur user photos), so
only their source URLs and licences are recorded below. Nothing in this directory is a
fixture the test suite can use.

**These are public photographs, not Sean's own.** A phone photo of a local newspaper taken by
Sean remains the untested case.

## The five photographs

| # | file (kept locally)                      | what it is                                                        | source URL                                                                        | licence |
|---|------------------------------------------|--------------------------------------------------------------------|------------------------------------------------------------------------------------|---------|
| 1 | `01-newspaper-clipping-straighton.jpg`   | NYT newspaper clipping ("Can You KenKen?", 4x4), shot on a flat backdrop, straight on | `https://static01.nyt.com/images/2019/02/10/insider/10rc-crossword/10rc-crossword-superJumbo.jpg` (from *10 Years of the KenKen Puzzle in The Times*, 2019-02-09) | © The New York Times — all rights reserved |
| 2 | `02-newspaper-hands-pen.jpg`             | a reader's hand holding a pen over a KenKen newspaper page (small web thumbnail, 385×256) | `https://rblpartners.com/wp-content/uploads/2015/09/KenKen-newspaper-resized.jpg` (RBL Partners KenKen case study) | © Nextoy/RBL Partners — all rights reserved |
| 3 | `03-dailytimes-pen-answers.jpg`          | a phone photo of the *Daily Times* (UK) KenKen "Difficult No 6472" (6x6), blue pen answers written in | `https://i.redd.it/t63u5uv9r8re1.jpeg` (r/kenken, u/Ieuan_DJ, 2025-03-27)            | user photo, no licence |
| 4 | `04-puzzlebook-indoor.jpg`               | a phone photo of an open *KenKen for Experts* puzzle-book spread (two 8x8 grids) on a desk, warm indoor light | `https://i.redd.it/t7pzz24prx351.jpg` (r/numberpuzzles, u/wellbourbon, 2020-06-09)   | user photo, no licence |
| 5 | `05-puzzlebook-9x9-marked.jpg`           | a phone photo of a KenKen book page (9x9) heavily marked up in pencil, page tilted and curved | `https://i.imgur.com/6BrMs0W.jpeg` (imgur, posted in the r/numberpuzzles thread above) | user photo, no licence |

Variety was deliberate: straight on (1), handheld/shallow (2), newsprint with handwriting (3),
warm indoor light (4), pencil-marked and tilted (5).

## Method

Each image was driven through the **real app flow in Chromium against the production build**
(`vite build` + `vite preview`), with the shipped ONNX clue reader (the run asserts
`data-reader="onnx"`, so a silent fallback to the template reader would fail): *Scan a photo* →
grid detection → clue reading → *Load into editor* → *Solve!*. Harness:
[`web/scripts/scan-real-photos.mjs`](../../../scripts/scan-real-photos.mjs).

The harness was validated first on the committed synthetic samples, which it scans exactly as
the sample suite expects:

```
kenken-4x4-clean.png   4x4  "7 cages found · 7 clues read · 0 cages needing review"  solved
kenken-5x5-glare.png   5x5  "11 cages found · 11 clues read · 0 cages needing review" solved
```

## Results

| # | grid found? | clues read | cages in the puzzle | board solved? | scan+load |
|---|-------------|-----------|---------------------|---------------|-----------|
| 1 | no — 0 cages, empty board | 0 | 8 | n/a | ~17 s (incl. a 15 s wait for an editor board that never appeared) |
| 2 | **no** — `corners: no board frame found (confidence 0.47)` | – | ~8 | n/a | 0.6 s |
| 3 | partition only — read as 6x6, 17 cages | **0 / 17** (17 cages needing review) | 17 | **no** (Failure) | 4.1 s |
| 4 | **no** — `corners: no board frame found (confidence 0.50)` | – | ~32 per puzzle, two puzzles | n/a | 1.5 s |
| 5 | **wrong** — read as 6x6 with 1 cage | **0 / 1** | ~40 | **no** (Failure) | 3.8 s |

(Timings are wall-clock on a shared box and move with load; the scan itself is sub-second for
every image — 1's ~17 s is 15 s of the harness waiting for an editor board that never came.)

**0 of 5 usable.** No photograph produced a board that could be solved. The clue reader — the
model ticket 10 shipped — never got a chance to be right: **0 clues were committed on all
five**. The failures are upstream of it:

- **Frame detection misses printed puzzles.** Two photos (2, 4) are rejected at
  `MIN_CORNER_CONFIDENCE = 0.5`; the indoor book photo scored 0.50 and still failed, i.e. it
  just misses. Photo 1 finds a frame but derives an empty board.
- **The cage partition is wrong or empty** once a frame is found (1 → 0 cages; 5 → a 6x6 grid
  with a single cage, where the page is a 9x9 with ~40).
- **Clue crops are unreadable to the reader** even where the partition is plausible (3 → a
  correct-looking 6x6 partition but 0 of 17 clues read; every cage lands in "needs review").

## Verdict

**Not shippable for a stranger's photo.** The pipeline is proven on clean synthetic renders and
has not been shown to work on a single real photograph; the gap is in corner/frame detection and
cage derivation on photographed paper, before the clue reader runs at all. It needs another pass
— and the first thing that pass should carry is a set of real, self-taken photos with known
labels, because none of the five here can be committed to the repo as fixtures.

## Reproducing

```sh
cd web
npm ci
npm run build
SERVE=1 node scripts/scan-real-photos.mjs /tmp/real-results.json <photo>...
```

Put the five photos back from the URLs above first; they are not in the repository.
