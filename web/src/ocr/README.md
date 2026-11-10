# KenKen OCR labels

The label schema for scanned KenKen puzzles (`types.ts`) and the conversion from
a label to the solver's own puzzle strings (`labelToBoard.ts`). A label is the
ground truth the recogniser is trained and tested against; converting it yields
exactly what `solveFromAPI` and `PlayPuzzle` already consume.

## Schema

- `OcrImage` — `{ width, height, data }`, where `data` is a `Uint8ClampedArray` of
  raw RGBA bytes, row-major (`width * height * 4` bytes). Not a canvas: jsdom has none.
- `Point` — `{ x, y }` in image pixels. `Quad` — the board's four corners
  `tl`, `tr`, `br`, `bl` (top-left, top-right, bottom-right, bottom-left, with "top"
  meaning the puzzle's upright orientation, not the image's).
- `Clue` — `{ target, operator }`. `operator` is the solver's `Operator` from
  `web/src/solver/Operator.ts`: `'+'`, `'-'`, `'x'`, `'/'`, or `''` (constant).
- `ScannedBoard` — `boardSize`; `cageLetters`, one row-string per row; `clues`,
  keyed by cage letter.
- `OcrSource` — `kind` (`'synthetic'` or `'photo'`), optional `seed` and `styleTag`.
- `OcrLabel` — a `ScannedBoard` plus the board's `corners` and its `source`.

## Conventions (the existing ones, not new ones)

`cageLetters` uses the `boardStrings` convention from `web/src/play/types.ts`: one
string per row, single-character cage letters separated by single spaces. Cells
sharing a letter form one cage. The solver reads only the first character of
each token and finds a cage by flood-filling from its first cell, so a letter
must be one character and one 4-connected region.

`labelToBoard` produces a `constraintString` the way the generator does
(`finish()` in `web/src/play/generator/generate.ts`): one token per cage,
`` `${letter}=${target}${operator}` `` (the `Constraint.toString()` shape), joined
by single spaces. Cages are ordered by the first time their letter appears when
`cageLetters` is read row by row, so the output is deterministic whatever the
key order of `clues`.

Worked example, `kenken1` from `web/src/solver/__fixtures__/puzzles.json`:

```
a b b c c d
a b e c d d
a f e e g g
f f h i j g
k l h i j j
k k h m m n
```

```
a=60x b=4+ c=16+ d=45x e=40x f=72x g=4x h=11+ i=4- j=12+ k=12x l=5 m=8+ n=2
```

As a label, that is `clues.a = { target: 60, operator: 'x' }` and so on.

### Single-cell cages

A single-cell cage uses the constant operator `''`, so its token has no operator
character: `l=5` and `n=2` above. `parseConstraintLine` matches each token
against `^([^=]*)=([0-9]+)([+\-x/.]?)$`; the operator group is optional, matches
the empty string, and `operatorWithName('')` returns the `Constant` operator.

## `validateLabel`

Returns every problem, empty when the label is valid. Shape errors come first,
then contiguity, then clues; cells and cages in row-major order, clues in `clues`
key order. Rows are split on single spaces, so a double or trailing space is an
empty cell. The messages are:

- `boardSize N is not a positive integer`
- `boardSize N does not match R rows`
- `row R has C cells, expected N`
- `row R, column C is empty`
- `row R, column C is "ab", which is not a single character`
- `cage "b" is not contiguous: its K cells form G separate groups`
- `cage "c" has no clue`
- `clue "z" does not appear on the board`
- `clue "a" has target T, which is not a positive integer`
- `clue "a" has operator "*", which is not one of "+", "-", "x", "/" or ""`

Rows and columns are 0-based. Whether a target is reachable for the cage's size
and operator is not checked.

## `labelToBoard` on invalid labels

The output is only defined for valid labels, so **call `validateLabel` first**.
On an invalid label `labelToBoard` does not throw, but its output is unspecified:
rows are re-joined after splitting on any whitespace (empty tokens dropped),
tokens are emitted only for board letters that have a clue entry, and clues for
letters absent from the board are ignored.

## Fixtures

`__fixtures__/labels.json` is hand-written:

```
{
  "valid":   [{ "name", "label": OcrLabel, "expected": BoardConversion }],
  "invalid": [{ "name", "reason", "label": OcrLabel, "expectedErrors": string[] }]
}
```

The valid labels cover 4x4, 5x5 and 6x6 (the 6x6 is `kenken1`). `expected` is the
oracle for `labelToBoard`, and `labelToBoard.test.ts` also requires `solveFromAPI`
to solve each one. Each `expectedErrors` lists the validator's complete output, in order.
