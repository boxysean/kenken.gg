# TypeScript KenKen solver

A line-for-line port of the original Scala solver in `api/src/main/scala/gg/kenken/`.
It preserves the algorithm (constraint propagation over cage combinations, then
depth-first search with backtracking) and its ordering/tie-breaking, because the
first solution a KenKen puzzle admits is not unique and the product must keep
returning the same board the Scala solver returned.

The port runs in a Web Worker (`solve.worker.ts`, driven by `workerClient.ts`) so a
hard puzzle cannot freeze the tab. The message protocol is documented in the header
of `solve.worker.ts`.

## Proving parity

Parity is demonstrated, not asserted. Two fixture files hold expectations that do
not come from the port:

- `__fixtures__/scala-parity.json` — the exact intermediate values asserted by
  `api/src/test/scala/gg/kenken/solver/{UtilTest,GameStateTest,GameConstraintStateTest}.scala`,
  each entry carrying its source file and line. These were transcribed from the
  Scala test sources and cross-checked against real output from the Scala solver
  (see "Oracle" below).
- `__fixtures__/puzzles.json` — for every puzzle in `api/input/`, the board the
  original Scala solver actually produced. The unsolvable case is constructed and
  labelled as such.

`solveParity.test.ts` runs the TypeScript solver over those puzzles and compares
the output exactly. It also independently re-validates every solved board against
the rules of KenKen (rows/columns are permutations of 1..N; every cage meets its
target), so a green run means "same answer as Scala" *and* "legal board".

## Oracle: how the Scala expectations were produced

`sbt` is not installed on the dev box, so the Scala solver was compiled directly
with the Scala 2.13 compiler jars and run against the repo's inputs. The harness
lived outside the repo; its output is what the fixtures record.

- Source: `api/src/main/scala/gg/kenken/`
- Compiler: Scala 2.13 (`scala-compiler`, `scala-library`, `scala-reflect`)
- Runtime deps: `scala-logging`, `slf4j-api`, `logback-classic`, `logback-core`
- Harness: a small `Oracle.scala` that calls `KenKenSolver.parseFile(path).solve`
  and prints one JSON object per puzzle (`path`, `ms`, `solved`, `boardOutput`).
- The solver is deterministic: repeat runs return identical boards. Timings vary
  with JVM warm-up — the first puzzle in a run absorbs startup/JIT cost — so the
  `scalaSolveMs` values in `puzzles.json` are warm-run times and carry a note.

If you change the TypeScript solver, re-run the parity suite. If you change the
Scala solver before phase 3 deletes it, regenerate these fixtures from it rather
than editing them by hand.
