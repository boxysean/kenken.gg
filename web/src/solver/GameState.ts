// Port of api/src/main/scala/gg/kenken/solver/GameState.scala.
//
// Cell possibilities: Scala holds an immutable `Set[Int]` per cell; here each
// cell holds a `readonly number[]` kept sorted ascending and deduplicated.
// Scala's `.head` on a small immutable set is effectively insertion order,
// whereas `pickSomething` here takes the smallest candidate. The candidate sets
// are identical either way and the search is exhaustive, so a puzzle with a
// unique solution gets the same answer; only the order in which values are
// tried differs. Every other ordering is kept: cellsWithoutCertainty is
// row-major and pickSomething takes its first cell.
//
// The arrays are never mutated in place (only replaced), which is what makes
// the shallow row copies in `clone` safe, just as sharing immutable Sets is in
// Scala.
import type { CellLocation, Constraint } from './Constraint';
import type { GameConstraintState } from './GameConstraintState';

export type CellPossibilities = readonly number[];

export class GameState {
  constructor(
    readonly constraints: ReadonlyMap<string, GameConstraintState>,
    readonly board: string[][],
    readonly cellPossibilities: CellPossibilities[][],
    readonly placed: boolean[][],
  ) {}

  // Scala: GameState.apply(constraints: List[Constraint], board: Array[Array[Char]])
  static fromConstraints(constraints: readonly Constraint[], board: string[][]): GameState {
    const gameConstraintStates = new Map<string, GameConstraintState>();

    for (const constraint of constraints) {
      gameConstraintStates.set(constraint.name, constraint.getGameConstraintState(board));
    }

    const initPossibilities: CellPossibilities[][] = board.map((boardRow) =>
      boardRow.map((cell) => {
        const constraint = gameConstraintStates.get(cell);
        if (constraint === undefined) {
          // Scala's HashMap.apply throws NoSuchElementException here.
          throw new Error('key not found: ' + cell);
        }
        return constraint.possibleValuesOfCell();
      }),
    );

    return new GameState(
      gameConstraintStates,
      board,
      initPossibilities,
      board.map(() => new Array<boolean>(board.length).fill(false)),
    );
  }

  get boardSize(): number {
    return this.board.length;
  }

  constraintAt(row: number, column: number): GameConstraintState {
    const constraint = this.constraints.get(this.board[row][column]);
    if (constraint === undefined) {
      throw new Error('key not found: ' + this.board[row][column]);
    }
    return constraint;
  }

  clone(): GameState {
    return new GameState(
      this.constraints,
      this.board.map((row) => [...row]),
      this.cellPossibilities.map((row) => [...row]),
      this.placed.map((row) => [...row]),
    );
  }

  isSolved(): boolean {
    return this.cellPossibilities.flat().every((possibility) => possibility.length === 1);
  }

  allCellsHaveAChoice(): boolean {
    return this.cellPossibilities.flat().every((possibility) => possibility.length !== 0);
  }

  allPlacementsAreLegal(): boolean {
    return [...this.constraints.values()]
      .filter((constraint) => constraint.isFullyPlaced(this))
      .every((constraint) => constraint.placementIsLegal(this));
  }

  isPossible(): boolean {
    return this.allCellsHaveAChoice() && this.allPlacementsAreLegal();
  }

  reduceCellPossibilities(): GameState | null {
    const newGameState: GameState = this.clone();
    let modified = false;

    // For each row, count how many similar sets of possibilities there are.
    // If there are the same number of sets as the number of elements in the set
    // then go ahead and remove those elements from the other cells in the row.

    for (let row = 0; row < newGameState.boardSize; row++) {
      const histogram = new Map<string, { possibilities: CellPossibilities; cells: CellLocation[] }>();

      for (let column = 0; column < newGameState.boardSize; column++) {
        addToHistogram(histogram, newGameState.cellPossibilities[row][column], [row, column]);
      }

      for (const { possibilities, cells } of histogram.values()) {
        if (possibilities.length !== cells.length) continue;
        for (let column = 0; column < newGameState.boardSize; column++) {
          if (!containsCell(cells, row, column)) {
            modified = modified || intersects(newGameState.cellPossibilities[row][column], possibilities);
            newGameState.cellPossibilities[row][column] = without(newGameState.cellPossibilities[row][column], possibilities);
          }
        }
      }
    }

    for (let column = 0; column < newGameState.boardSize; column++) {
      const histogram = new Map<string, { possibilities: CellPossibilities; cells: CellLocation[] }>();

      for (let row = 0; row < newGameState.boardSize; row++) {
        addToHistogram(histogram, newGameState.cellPossibilities[row][column], [row, column]);
      }

      for (const { possibilities, cells } of histogram.values()) {
        if (possibilities.length !== cells.length) continue;
        for (let row = 0; row < newGameState.boardSize; row++) {
          if (!containsCell(cells, row, column)) {
            modified = modified || intersects(newGameState.cellPossibilities[row][column], possibilities);
            newGameState.cellPossibilities[row][column] = without(newGameState.cellPossibilities[row][column], possibilities);
          }
        }
      }
    }

    return modified ? newGameState : null;
  }

  cellsWithoutCertainty(): CellLocation[] {
    const cells: CellLocation[] = [];
    for (let row = 0; row < this.boardSize; row++) {
      for (let column = 0; column < this.boardSize; column++) {
        if (this.cellPossibilities[row][column].length > 1) {
          cells.push([row, column]);
        }
      }
    }
    return cells;
  }

  pickSomething(): [number, number, number] {
    const [row, column] = this.cellsWithoutCertainty()[0];
    return [row, column, this.cellPossibilities[row][column][0]];
  }

  tryIt(row: number, column: number, value: number): GameState {
    const newGameState: GameState = this.clone();
    newGameState.cellPossibilities[row][column] = [value];
    return newGameState;
  }

  definitelyNotThis(row: number, column: number, value: number): GameState {
    const newGameState: GameState = this.clone();
    newGameState.cellPossibilities[row][column] = newGameState.cellPossibilities[row][column].filter(
      (possibility) => possibility !== value,
    );
    return newGameState;
  }

  solve(): GameState | null {
    if (!this.isPossible()) {
      return null;
    }

    if (this.isSolved()) {
      return this;
    }

    // - Try to reduce cell possibilities based on row and column scans

    const reduce = this.reduceCellPossibilities();

    if (reduce !== null) {
      return reduce.solve();
    }

    // - Try a constraint possibility
    // - If a contradiction is found, eliminate the constraint possibility, reduce cell possibilities, and return to 1
    // - If a solution is found, that's it!

    const [row, column, value] = this.pickSomething();

    const tryItBoard = this.tryIt(row, column, value).solve();

    if (tryItBoard !== null) {
      return tryItBoard;
    } else {
      return this.definitelyNotThis(row, column, value).solve();
    }
  }

  // Scala: GameState.toString
  toBoardOutput(): string {
    return this.toJson()
      .map((row) => row.join(' '))
      .join('\n');
  }

  toJson(): string[][] {
    return this.cellPossibilities.map((row) =>
      row.map((possibilities) => (possibilities.length === 1 ? possibilities[0].toString() : '.')),
    );
  }

  toString(): string {
    return this.toBoardOutput();
  }
}

function addToHistogram(
  histogram: Map<string, { possibilities: CellPossibilities; cells: CellLocation[] }>,
  possibilities: CellPossibilities,
  cell: CellLocation,
): void {
  // Possibilities are sorted, so equal sets have equal keys.
  const key = possibilities.join(',');
  let entry = histogram.get(key);
  if (entry === undefined) {
    entry = { possibilities, cells: [] };
    histogram.set(key, entry);
  }
  entry.cells.push(cell);
}

function containsCell(cells: readonly CellLocation[], row: number, column: number): boolean {
  return cells.some(([cellRow, cellColumn]) => cellRow === row && cellColumn === column);
}

function intersects(possibilities: CellPossibilities, other: CellPossibilities): boolean {
  return possibilities.some((value) => other.includes(value));
}

function without(possibilities: CellPossibilities, other: CellPossibilities): CellPossibilities {
  return possibilities.filter((value) => !other.includes(value));
}
