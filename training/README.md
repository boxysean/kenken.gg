# Clue character model

A small CNN that reads one clue character (a digit or an operator) from a 16x16 crop.
It is meant to replace ticket 6's template reader on real photos: the template reader
matches the renderer's own font, which is perfect on synthetic boards and has no reason
to work on handwriting or other print. This directory trains the model on CPU and exports
it to ONNX for the browser.

The exported artifacts are committed under `web/`:

- `web/src/ocr/models/char.onnx` — the model, opset 13 (supported by onnxruntime-web).
- `web/src/ocr/infer/__fixtures__/clue_crops/` — 50 golden validation crops.
- `web/src/ocr/infer/__fixtures__/clue_golden.json` — the ONNX model's probabilities for
  each golden crop, for ticket 10's in-browser inference to match.

`web/src/ocr/models/modelArtifacts.test.ts` fails if any of them goes missing or
changes shape. The crops, the manifest and the checkpoint are not committed
(`training/data/` and `training/checkpoints/` are gitignored); they are rebuilt by the
commands below.

## Environment

Python 3.12, CPU only. From the repo root:

```
uv venv --seed training/.venv --python 3.12
training/.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0
training/.venv/bin/pip install -r training/requirements.txt
```

The venv is made with uv because the machine this was built on has no `ensurepip`, so
`python3.12 -m venv` there makes a venv with no pip. `--seed` matters too: a plain
`uv venv` also leaves out pip, so `training/.venv/bin/pip` would not exist. Without uv,
`python3.12 -m venv training/.venv` works on a Python that does have `ensurepip`; or keep
a pip-less venv and install into it with
`uv pip install --python training/.venv/bin/python` in place of `training/.venv/bin/pip install`.

The first install pulls the CPU-only torch build, which is much smaller than the default
one. A plain `pip install -r training/requirements.txt` also works; it just pulls the
default torch build. Nothing here needs a GPU.

## Commands

Run from the repo root, in this order:

```
cd web && npx tsx scripts/export-crops.ts && cd ..
training/.venv/bin/python training/train_char.py
training/.venv/bin/python training/export_onnx.py
cd web && npx tsx scripts/ocr-baseline.ts
```

1. `export-crops.ts` (also `npm run ocr:export-crops`) renders 100 synthetic puzzles,
   cuts their clues into characters and writes `training/data/crops/<class>/*.png` plus
   `training/data/manifest.json`, with the train/val split. About 45 seconds.
2. `train_char.py` trains for 30 epochs, prints one line per epoch and the final
   validation accuracy, and saves `training/checkpoints/char.pt`. About 40 seconds.
3. `export_onnx.py` writes `web/src/ocr/models/char.onnx`, checks it against the torch
   model on every validation crop (it exits non-zero if they differ by more than 1e-4),
   and rewrites the golden crops and `clue_golden.json`.
4. `ocr-baseline.ts` (also `npm run ocr:baseline`) prints the template reader's
   per-character accuracy on the ticket-8 eval recipes, the number to beat.

All four are deterministic: the same seed on the same data gives the same output.

## Input contract (for ticket 10)

- One crop is 16x16. The PNG is RGBA, and its R, G and B channels all carry the ink
  value: 0 is paper, 255 is ink. Read any one of them (training reads the PNG as
  grayscale, which is the same value).
- Feed `pixel / 255` as float32, NCHW, shape `(N, 1, 16, 16)`. The input is named
  `input`; the batch axis is dynamic.
- The output, `probabilities`, is `(N, 14)` and already softmaxed, in the order
  `0 1 2 3 4 5 6 7 8 9 + - x /`.

## Results

Measured on this tree, seed 0, 30 epochs.

| | |
|---|---|
| Final validation accuracy | `FINAL val accuracy: 98.60% (983/997)` |
| Validation accuracy by style | clean 249/249, glare 253/253, perspective 253/253, noise 228/242 (94.2%) |
| Crops | 4379: 3382 train, 997 val (20 of the 100 puzzles are val) |
| Golden set argmax accuracy | 50/50: clean 12/12, noise 13/13, glare 13/13, perspective 12/12 (lowest top probability 0.609, on a noise crop) |
| torch vs ONNX, max abs difference | 5.662e-07 over the 997 val crops |
| `char.onnx` | 361780 bytes, 89806 parameters |
| Template reader, per character, distorted eval split | 401/445 = 90.1% (noise 106/150 = 70.7%, glare 149/149, perspective 146/146) |
| Template reader, per character, clean eval split | 147/147 = 100.0% |
| Template reader, clue accuracy (ticket-8 eval) | 100.0% on every tag; coverage on noise 75.4% |

Crops per class (train + val = total):

| class | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | + | - | x | / |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| train | 255 | 388 | 401 | 219 | 273 | 136 | 202 | 63 | 166 | 45 | 11 | 421 | 663 | 139 |
| val | 76 | 114 | 131 | 54 | 96 | 40 | 56 | 21 | 49 | 11 | 3 | 94 | 201 | 51 |
| total | 331 | 502 | 532 | 273 | 369 | 176 | 258 | 84 | 215 | 56 | 14 | 515 | 864 | 190 |

The template reader's per-character baseline counts a declined clue as every one of its
characters wrong, and it already scores 100% at clue level on this synthetic corpus
because it matches the renderer's own font, so the character-level number is the
comparable one. On it, the model gets 94.2% of noise characters right where the template
reader gets 70.7%, and both are perfect on clean, glare and perspective; but the two are
measured on different puzzles (the model on the crop exporter's val recipes, the
template reader on the 24 ticket-8 eval recipes), so this is a rough comparison, not a
head-to-head. All 14 validation errors are on noise crops.

## Retraining on real photos

Drop labelled 16x16 crops of real photos into `training/data/crops/<class>/` (the
operators use the directory names `plus`, `minus`, `times` and `div`), add an entry for
each to `training/data/manifest.json` with its `file`, `class`, `seed`, `styleTag` and
`split`, then rerun `train_char.py` and `export_onnx.py`. Keep whole photos in one split,
as the exporter does with whole puzzles, or validation will overstate accuracy. Note that
`export-crops.ts` deletes and rewrites `training/data/crops/` and the manifest, so keep
photo crops somewhere else and merge them in after running it.

int8 quantisation and models for corners or cage edges are deliberately out of scope.

## Limits

- The dataset is synthetic only. Every crop comes from the renderer, so nothing here
  shows how the model does on real photos.
- The validation split is the same font as training, only from different puzzles, so
  98.60% is an upper bound on what to expect elsewhere.
- Some classes are rare: `+` has 14 crops (3 in val), `9` has 56 and `7` has 84, while
  `x` has 864. `0` is not rare here (331), since it only ever appears inside a number.
- The golden set is picked round-robin over (style tag, class) pairs, so it spans all
  four tags (12 clean, 13 noise, 13 glare, 12 perspective) and 3 or 4 crops of every
  class but `+`, which has only 3 val crops and gets 2. Within a pair it takes crops in
  file order, not by difficulty. All 50 happen to be read correctly, although noise
  validation accuracy is 94.2%, so a retrained model may well miss one. The set pins
  parity with the browser; it does not measure accuracy.
- `CharNet` has 89806 parameters, a little over the ~80k the spec aimed for; that is the
  spec's own layer sizes (the 1024-to-64 linear layer is 65600 of them).
- `web/scripts/` is outside `npm run typecheck`, so the crop exporter and the baseline
  script are not type-checked.
