import { parseBoard, parseConstraintLine } from '../../solver';
import { cagesFromPuzzle, countSolutions } from './countSolutions';
import { generate } from './generate';
import { hashString, mulberry32 } from './rng';

const SIZES = [4, 5, 6, 7, 8, 9];
const SEEDS = ['seeds-are-cheap-1', 'seeds-are-cheap-2'];

// A deliberately naive second-solution search, written independently of
// countSolutions: plain recursion over cells in row-major order, pruning only on
// row/column repeats and on a cage's partial sum or product. It exists to catch
// a counter that is wrong in the same way twice, so it shares no code with it.
function bruteForceCount(boardStrings: readonly string[], constraintString: string, cap: number): number {
  const board = boardStrings.map((line) => line.trim().split(/\s+/));
  const size = board.length;
  const cells = size * size;
  const cageCells = new Map<string, number[]>();
  const cageTarget = new Map<string, { target: number; operator: string }>();
  for (const token of constraintString.trim().split(/\s+/)) {
    const match = /^(.)=(\d+)([+\-x/]?)$/.exec(token);
    if (match === null) throw new Error(`bad token ${token}`);
    cageTarget.set(match[1], { target: Number(match[2]), operator: match[3] });
  }
  for (let index = 0; index < cells; index++) {
    const letter = board[Math.floor(index / size)][index % size];
    cageCells.set(letter, [...(cageCells.get(letter) ?? []), index]);
  }

  const values = new Array<number>(cells).fill(0);
  const rowCounts: number[][] = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0));
  const columnCounts: number[][] = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0));
  const cagePartial = new Map<string, number>();
  const cagePlaced = new Map<string, number>();
  let found = 0;

  const cageIsStillPossible = (letter: string, placedValue: number | null): boolean => {
    const { target, operator } = cageTarget.get(letter)!;
    const cellsInCage = cageCells.get(letter)!;
    const placed = cagePlaced.get(letter) ?? 0;
    const partial = cagePartial.get(letter) ?? (operator === 'x' ? 1 : 0);
    if (operator === '-' || operator === '/') return true; // checked when full
    const remaining = cellsInCage.length - placed;
    if (operator === '+') {
      if (partial + remaining > target) return false;
      if (partial + remaining * size < target) return false;
      return true;
    }
    if (operator === 'x') {
      if (target % partial !== 0) return false;
      return target / partial <= Math.pow(size, remaining);
    }
    void placedValue;
    return true;
  };

  const cageIsSatisfiedAtFullSize = (letter: string): boolean => {
    const { target, operator } = cageTarget.get(letter)!;
    const cellsInCage = cageCells.get(letter)!;
    const picked = cellsInCage.map((cell) => values[cell]);
    if (operator === '+') return picked.reduce((a, b) => a + b, 0) === target;
    if (operator === 'x') return picked.reduce((a, b) => a * b, 1) === target;
    if (operator === '-') return Math.abs(picked[0] - picked[1]) === target;
    if (operator === '/') {
      const low = Math.min(picked[0], picked[1]);
      const high = Math.max(picked[0], picked[1]);
      return low !== 0 && high % low === 0 && high / low === target;
    }
    return picked[0] === target;
  };

  const visit = (index: number): void => {
    if (found >= cap) return;
    if (index === cells) {
      for (const letter of cageCells.keys()) {
        if (!cageIsSatisfiedAtFullSize(letter)) return;
      }
      found++;
      return;
    }
    const row = Math.floor(index / size);
    const column = index % size;
    const letter = board[row][column];
    for (let value = 1; value <= size; value++) {
      if (rowCounts[row][value] > 0 || columnCounts[column][value] > 0) continue;
      values[index] = value;
      rowCounts[row][value]++;
      columnCounts[column][value]++;
      const previousPartial = cagePartial.get(letter);
      const previousPlaced = cagePlaced.get(letter);
      const operator = cageTarget.get(letter)!.operator;
      cagePartial.set(letter, operator === 'x' ? (previousPartial ?? 1) * value : (previousPartial ?? 0) + value);
      cagePlaced.set(letter, (previousPlaced ?? 0) + 1);
      if (cageIsStillPossible(letter, value)) visit(index + 1);
      if (previousPartial === undefined) cagePartial.delete(letter);
      else cagePartial.set(letter, previousPartial);
      if (previousPlaced === undefined) cagePlaced.delete(letter);
      else cagePlaced.set(letter, previousPlaced);
      rowCounts[row][value]--;
      columnCounts[column][value]--;
      values[index] = 0;
      if (found >= cap) return;
    }
  };

  visit(0);
  return Math.min(found, cap);
}

test('the same seed always produces the same puzzle', () => {
  for (const size of [4, 6, 9]) {
    for (const seed of ['repeat-1', 'repeat-2']) {
      const first = generate(seed, size);
      const second = generate(seed, size);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(first.seed).toBe(seed);
      expect(first.boardSize).toBe(size);
    }
  }
});

test('generated puzzles are valid KenKens with exactly one solution', () => {
  for (const size of SIZES) {
    for (const seed of SEEDS) {
      const puzzle = generate(seed, size);
      const board = puzzle.boardStrings.map((line) => line.split(' '));
      const constraints = parseConstraintLine(puzzle.constraintString);
      const cages = cagesFromPuzzle(constraints, board);

      // Rows and columns are permutations of 1..size, in both the stored
      // solution and the cage layout's cage-set integrity.
      for (let row = 0; row < size; row++) {
        const rowValues = puzzle.solution.slice(row * size, (row + 1) * size).sort((a, b) => a - b);
        expect(rowValues).toEqual(Array.from({ length: size }, (_, index) => index + 1));
      }
      for (let column = 0; column < size; column++) {
        const columnValues = Array.from({ length: size }, (_, row) => puzzle.solution[row * size + column]).sort((a, b) => a - b);
        expect(columnValues).toEqual(Array.from({ length: size }, (_, index) => index + 1));
      }

      // Every cell belongs to exactly one cage.
      const owner = new Map<number, string>();
      for (const cage of cages) for (const cell of cage.cells) owner.set(cell, cage.operator + cage.target);
      expect(owner.size).toBe(size * size);

      for (const cage of cages) {
        // No one-cell cages: they leak their value outright.
        expect(cage.cells.length).toBeGreaterThanOrEqual(2);
        // Operators follow the KenKen convention for cage size.
        if (cage.cells.length === 2) {
          expect(['+', '-', 'x', '/']).toContain(cage.operator);
        } else {
          expect(['+', 'x']).toContain(cage.operator);
        }
        // Cages are connected polyominoes.
        const remaining = new Set(cage.cells);
        const frontier = [cage.cells[0]];
        remaining.delete(cage.cells[0]);
        while (frontier.length > 0) {
          const cell = frontier.pop()!;
          const row = Math.floor(cell / size);
          const column = cell % size;
          for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
            const neighbourRow = row + dr;
            const neighbourColumn = column + dc;
            if (neighbourRow < 0 || neighbourRow >= size || neighbourColumn < 0 || neighbourColumn >= size) continue;
            const neighbour = neighbourRow * size + neighbourColumn;
            if (remaining.delete(neighbour)) frontier.push(neighbour);
          }
        }
        expect(remaining.size).toBe(0);
        // The target is exactly the operator folded over the solution's values.
        const values = cage.cells.map((cell) => puzzle.solution[cell]);
        const folded =
          cage.operator === '+'
            ? values.reduce((a, b) => a + b, 0)
            : cage.operator === 'x'
              ? values.reduce((a, b) => a * b, 1)
              : cage.operator === '-'
                ? Math.abs(values[0] - values[1])
                : Math.max(...values) / Math.min(...values);
        expect(folded).toBe(cage.target);
      }

      // The puzzle must not be solvable by guessing alone.
      expect(puzzle.difficulty.forcedCells).toBeGreaterThan(0);
      expect(puzzle.difficulty.singleCellCages).toBe(0);

      // Exactly one solution: this is the promise the whole mode rests on.
      expect(countSolutions(constraints, board, 2, 200000)).toBe(1);
    }
  }
}, 300000);

test('the constraint string round-trips through the solver parser', () => {
  for (const size of [4, 5, 6]) {
    const puzzle = generate('round-trip', size);
    const board = parseBoard(puzzle.boardStrings);
    const constraints = parseConstraintLine(puzzle.constraintString);
    const cages = cagesFromPuzzle(constraints, board);
    const direct = cagesFromPuzzle(
      constraints,
      puzzle.boardStrings.map((line) => line.split(' ')),
    );
    expect(JSON.stringify(cages)).toBe(JSON.stringify(direct));
    // Every cage name is a single character: the parser only reads name[0].
    for (const constraint of constraints) expect(constraint.name.length).toBe(1);
  }
});

test('countSolutions agrees with an independent brute force', () => {
  // Handcrafted: each cell its own cage, so the solution is unique.
  const singleCellBoard = ['a b c d', 'e f g h', 'i j k l', 'm n o p'];
  const solution = [1, 2, 3, 4, 2, 3, 4, 1, 3, 4, 1, 2, 4, 1, 2, 3];
  const letters = 'abcdefghijklmnop'.split('');
  const singleCellConstraints = letters.map((name, index) => `${name}=${solution[index]}`).join(' ');
  expect(countSolutions(parseConstraintLine(singleCellConstraints), parseBoard(singleCellBoard), 2)).toBe(1);
  expect(bruteForceCount(singleCellBoard, singleCellConstraints, 2)).toBe(1);

  // Handcrafted: four 4-cell '+' cages. Deliberately ambiguous — both counters
  // must saturate at two rather than disagree about which answer is right.
  const looseBoard = ['a a b b', 'a a b b', 'c c d d', 'c c d d'];
  const looseConstraints = 'a=8+ b=12+ c=12+ d=8+';
  const counted = countSolutions(parseConstraintLine(looseConstraints), parseBoard(looseBoard), 2);
  expect(counted).toBe(2);
  expect(bruteForceCount(looseBoard, looseConstraints, 2)).toBe(2);

  // And on real generated puzzles, at every size the brute force can reach.
  for (const size of [4, 5]) {
    for (const seed of ['cross-check-1', 'cross-check-2', 'cross-check-3']) {
      const puzzle = generate(seed, size);
      const board = puzzle.boardStrings.map((line) => line.split(' '));
      expect(countSolutions(parseConstraintLine(puzzle.constraintString), board, 2)).toBe(1);
      expect(bruteForceCount(puzzle.boardStrings, puzzle.constraintString, 2)).toBe(1);
    }
  }
}, 300000);

test('generation is deterministic across a fresh RNG instance', () => {
  const seed = 'determinism';
  const random = mulberry32(hashString(seed));
  expect(random()).toBe(mulberry32(hashString(seed))());
});

// Regression snapshot of the letters generated puzzles have always had, and
// their order. The cage alphabet now lives in cageLetters.ts, shared with the
// editor; reordering it, or changing the order cages are assigned letters in,
// must fail here. Literals on purpose: deriving them from CAGE_LETTERS would
// move with the thing under test.
test('generated cage letters match the pinned snapshot', () => {
  const puzzle = generate('seeds-are-cheap-1', 6);
  expect(puzzle.constraintString).toBe(
    'a=1- b=15x c=648x d=16x e=20x f=6/ g=36x h=2- i=20x j=90x k=40x l=2/',
  );
  const boardLetters = [...new Set(puzzle.boardStrings.flatMap((row) => row.split(' ')))];
  expect(boardLetters).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']);
});
