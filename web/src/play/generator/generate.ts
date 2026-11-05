// Seeded KenKen puzzle generator. The same (seed, boardSize) always produces
// the same puzzle: all randomness comes from rng.ts, never Math.random or Date,
// and every bound on the search is a node or attempt count, never wall-clock.
import { Constraint, parseBoard, parseConstraintLine } from '../../solver';
import type { Operator } from '../../solver';
import type { Cage, DifficultyMetrics, PlayPuzzle } from '../types';
import { cagesFromPuzzle, countSolutions, forcedCellCount } from './countSolutions';
import type { CageSpec } from './countSolutions';
import { hashString, mulberry32, randomInt, shuffled } from './rng';

// Cagings tried over one Latin square before a fresh square is drawn. Unique
// cagings are rare on 8x8 and 9x9, so this is generous; an ambiguous candidate
// costs only a few milliseconds to reject.
const MAX_CAGE_ATTEMPTS = 200;
// Latin squares tried. Reached only if 200 cagings over one square never come
// out unique.
const MAX_SQUARE_ATTEMPTS = 8;
// DFS nodes one uniqueness count may spend. A count that exhausts this reports
// "at least two solutions", so a candidate is only ever accepted on a complete
// search; the bound just keeps a pathological caging from stalling the page.
const SEARCH_NODES = 20000;
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface DifficultyBand {
  readonly minMeanCageSize: number;
  readonly maxMeanCageSize: number;
  readonly minForcedCells: number;
}

// Acceptance bands, not targets: generation takes the first unique candidate
// that falls inside one, and otherwise the best it saw.
const BANDS: Readonly<Record<number, DifficultyBand>> = {
  4: { minMeanCageSize: 2.0, maxMeanCageSize: 2.6, minForcedCells: 8 },
  5: { minMeanCageSize: 2.2, maxMeanCageSize: 2.8, minForcedCells: 8 },
  6: { minMeanCageSize: 2.4, maxMeanCageSize: 3.0, minForcedCells: 6 },
  7: { minMeanCageSize: 2.6, maxMeanCageSize: 3.2, minForcedCells: 5 },
  8: { minMeanCageSize: 2.8, maxMeanCageSize: 3.4, minForcedCells: 4 },
  9: { minMeanCageSize: 3.0, maxMeanCageSize: 3.8, minForcedCells: 3 },
};

interface Candidate {
  readonly cages: Cage[];
  // Distance of the mean cage size from the band; 0 inside it.
  readonly sizeDistance: number;
}

// A candidate with a proven-unique solution and at least one forced cell. Only
// these ever reach finish().
interface Accepted {
  readonly candidate: Candidate;
  readonly difficulty: DifficultyMetrics;
  // sizeDistance plus the forced-cell shortfall; 0 when fully inside the band.
  readonly bandDistance: number;
}

export function generate(seed: string, boardSize: number): PlayPuzzle {
  const band = BANDS[boardSize];
  if (!Number.isInteger(boardSize) || band === undefined) {
    throw new Error(`generate: boardSize must be an integer from 4 to 9, got ${boardSize}`);
  }

  const accept = (candidate: Candidate): Accepted | null => {
    const constraints = candidate.cages.map((cage) => new Constraint(cage.letter, cage.target, cage.operator));
    const board = letterGrid(candidate.cages, boardSize);
    // 1 means the whole tree was searched within SEARCH_NODES and held exactly
    // one solution: uniqueness is proven, not assumed.
    if (countSolutions(constraints, board, 2, SEARCH_NODES) !== 1) return null;
    const difficulty = difficultyMetrics(candidate.cages, boardSize, constraints, board);
    // No forced cells means no way in but guessing: never ship that.
    if (difficulty.forcedCells === 0) return null;
    const shortfall = Math.max(0, band.minForcedCells - difficulty.forcedCells);
    return { candidate, difficulty, bandDistance: candidate.sizeDistance + shortfall };
  };

  for (let square = 0; square < MAX_SQUARE_ATTEMPTS; square++) {
    const squareSeed = square === 0 ? seed : `${seed}#square${square}`;
    const solution = latinSquare(boardSize, mulberry32(hashString(squareSeed)));

    // The first unique candidate fully inside the band wins. Otherwise the
    // closest one seen over this square is kept, because a slightly off-band
    // unique puzzle is still a good puzzle and generation must not fail.
    let best: Accepted | null = null;
    for (let attempt = 0; attempt < MAX_CAGE_ATTEMPTS; attempt++) {
      const random = mulberry32(hashString(`${squareSeed}#cages${attempt}`));
      const accepted = accept(buildCandidate(solution, boardSize, band, random));
      if (accepted === null) continue;
      if (accepted.bandDistance === 0) return finish(seed, solution, boardSize, accepted);
      if (best === null || accepted.bandDistance < best.bandDistance) best = accepted;
    }
    if (best !== null) return finish(seed, solution, boardSize, best);
  }

  throw new Error(`generate: no unique candidate for seed ${JSON.stringify(seed)} at size ${boardSize}`);
}

function buildCandidate(
  solution: readonly number[],
  boardSize: number,
  band: DifficultyBand,
  random: () => number,
): Candidate {
  const cages = growCages(boardSize, random).map((cells) => makeCage(cells, solution, boardSize, random));
  assignLetters(cages);
  const mean = (boardSize * boardSize) / cages.length;
  const sizeDistance = Math.max(0, band.minMeanCageSize - mean) + Math.max(0, mean - band.maxMeanCageSize);
  return { cages, sizeDistance };
}

// Row 0 is a random permutation; every other row is row 0 rotated by a
// distinct non-zero shift, so each column also holds every value exactly once.
//
// Variety limitation: this only reaches squares whose rows are all rotations of
// one row, N! * (N-1)! of them, a vanishing fraction of all Latin squares for
// N >= 5. Every row is the same cyclic sequence, so a player who spots the
// pattern could exploit it; the cages are what make each puzzle differ.
function latinSquare(boardSize: number, random: () => number): number[] {
  const row0 = shuffled(range(1, boardSize), random);
  const shifts = [0, ...shuffled(range(1, boardSize - 1), random)];
  const values: number[] = [];
  for (let row = 0; row < boardSize; row++) {
    for (let column = 0; column < boardSize; column++) {
      values.push(row0[(column + shifts[row]) % boardSize]);
    }
  }
  return values;
}

// Grows connected cages from the lowest unassigned cell, then folds any
// isolated single cell into its smallest neighbouring cage. Returns cell lists
// in cage order (ascending by first cell).
function growCages(boardSize: number, random: () => number): number[][] {
  const owner = new Array<number>(boardSize * boardSize).fill(-1);
  const cages: number[][] = [];

  for (let start = 0; start < owner.length; start++) {
    if (owner[start] !== -1) continue;
    const id = cages.length;
    const cells = [start];
    owner[start] = id;
    const targetSize = pickCageSize(random);
    while (cells.length < targetSize) {
      const frontier: number[] = [];
      for (const cell of cells) {
        for (const neighbour of neighbours(cell, boardSize)) {
          if (owner[neighbour] === -1 && !frontier.includes(neighbour)) frontier.push(neighbour);
        }
      }
      if (frontier.length === 0) break;
      const next = frontier[randomInt(random, frontier.length)];
      owner[next] = id;
      cells.push(next);
    }
    cages.push(cells);
  }

  for (let id = 0; id < cages.length; id++) {
    if (cages[id].length !== 1) continue;
    const cell = cages[id][0];
    // Prefer the smallest neighbouring cage so merges do not pile onto one cage.
    let target = -1;
    for (const neighbour of neighbours(cell, boardSize)) {
      const other = owner[neighbour];
      if (other !== id && (target === -1 || cages[other].length < cages[target].length)) target = other;
    }
    if (target === -1) {
      throw new Error(`generate: cell ${cell} has no neighbouring cage to merge into`);
    }
    cages[target].push(cell);
    owner[cell] = target;
    cages[id] = [];
  }

  return cages.filter((cells) => cells.length > 0).map((cells) => [...cells].sort((a, b) => a - b));
}

function pickCageSize(random: () => number): number {
  const roll = random();
  if (roll < 0.55) return 2;
  if (roll < 0.85) return 3;
  return 4;
}

function makeCage(cells: number[], solution: readonly number[], boardSize: number, random: () => number): Cage {
  const values = cells.map((cell) => solution[cell]);
  const operator = chooseOperator(cells, values, boardSize, random);
  // The letter is assigned once the cage set is final; see assignLetters.
  return { cells, operator, target: cageTarget(operator, values), letter: '' };
}

// Most constraining operator first. '-' and '/' pin a 2-cell cage to a couple of
// pairs. On 3+ cells only '+' and 'x' are used (the KenKen convention), so the
// one that admits fewer multisets is taken: 'x' usually wins, because a product
// target is far more selective than a sum target. Weak cages are what make a
// random caging ambiguous, so this is the difference between generating a 9x9
// and never generating one.
function chooseOperator(cells: readonly number[], values: readonly number[], boardSize: number, random: () => number): Operator {
  const allEqual = new Set(values).size === 1;
  if (values.length === 2) {
    // An orthogonal pair shares a line, so its values always differ in a Latin
    // square; the equal case is handled for completeness.
    if (allEqual) return random() < 0.5 ? '+' : 'x';
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (high % low === 0) return random() < 0.5 ? '-' : '/';
    return '-';
  }
  const sum = values.reduce((total, value) => total + value, 0);
  const product = values.reduce((total, value) => total * value, 1);
  return multisetCount(values.length, product, 'x', boardSize) < multisetCount(values.length, sum, '+', boardSize)
    ? 'x'
    : '+';
}

// How many multisets of `size` values from 1..boardSize meet `target` under
// `operator`. Multisets, not ordered tuples, because a cage's target only
// depends on which values are in it. Used to pick the tighter of '+' and 'x',
// so it has to stay cheap: at most C(boardSize + size - 1, size) candidates.
function multisetCount(size: number, target: number, operator: Operator, boardSize: number): number {
  let count = 0;

  const visit = (remaining: number, minimum: number, accumulated: number): void => {
    if (remaining === 0) {
      if (accumulated === target) count++;
      return;
    }
    for (let value = minimum; value <= boardSize; value++) {
      const next = operator === '+' ? accumulated + value : accumulated * value;
      // With values >= 1 from here on, overshooting the target cannot recover.
      if (next > target) break;
      if (operator === '+' && next + (remaining - 1) * boardSize < target) continue;
      if (operator === 'x' && target % next !== 0) continue;
      visit(remaining - 1, value, next);
    }
  };

  visit(size, 1, operator === '+' ? 0 : 1);
  return count;
}

function cageTarget(operator: Operator, values: readonly number[]): number {
  switch (operator) {
    case '+':
      return values.reduce((sum, value) => sum + value, 0);
    case 'x':
      return values.reduce((product, value) => product * value, 1);
    case '-':
      return Math.abs(values[0] - values[1]);
    case '/':
      return Math.max(...values) / Math.min(...values);
    case '':
      return values[0];
  }
}

function assignLetters(cages: Cage[]): void {
  if (cages.length > LETTERS.length) {
    throw new Error(`generate: ${cages.length} cages do not fit in ${LETTERS.length} single-character names`);
  }
  cages.forEach((cage, index) => (cage.letter = LETTERS[index]));
}

function letterGrid(cages: readonly Cage[], boardSize: number): string[][] {
  const grid = Array.from({ length: boardSize }, () => new Array<string>(boardSize).fill(''));
  for (const cage of cages) {
    for (const cell of cage.cells) {
      grid[Math.floor(cell / boardSize)][cell % boardSize] = cage.letter;
    }
  }
  return grid;
}

function difficultyMetrics(
  cages: readonly Cage[],
  boardSize: number,
  constraints: readonly Constraint[],
  board: readonly (readonly string[])[],
): DifficultyMetrics {
  const cageSizeHistogram = new Array<number>(boardSize + 1).fill(0);
  for (const cage of cages) {
    // A folded-in single cell can push a cage past boardSize; widen rather than drop it.
    while (cageSizeHistogram.length <= cage.cells.length) cageSizeHistogram.push(0);
    cageSizeHistogram[cage.cells.length]++;
  }
  return {
    cageSizeHistogram,
    singleCellCages: cageSizeHistogram[1],
    // Cells fixed before any guessing, using cage arithmetic plus row/column
    // elimination. This is the same propagation the uniqueness counter runs, so
    // measuring difficulty costs one propagation pass, not a search.
    forcedCells: forcedCellCount(constraints, board),
  };
}

function finish(seed: string, solution: readonly number[], boardSize: number, accepted: Accepted): PlayPuzzle {
  const { cages } = accepted.candidate;
  if (accepted.difficulty.forcedCells === 0) {
    throw new Error(`generate: refusing a puzzle with no forced cells for seed ${JSON.stringify(seed)}`);
  }
  const boardStrings = letterGrid(cages, boardSize).map((row) => row.join(' '));
  const constraintString = cages.map((cage) => `${cage.letter}=${cage.target}${cage.operator}`).join(' ');

  // The puzzle ships as the solver's own strings, so round-trip them through
  // the solver's parser and check the cages come back identical. This is the
  // check that catches the parser's one-character-name rule: a token like
  // "aa3+" would silently parse as cage "a" and merge two cages.
  const reparsed = parseConstraintLine(constraintString);
  assertSameCages(cages, cagesFromPuzzle(reparsed, parseBoard(boardStrings)), seed);

  return {
    boardStrings,
    constraintString,
    solution: [...solution],
    boardSize,
    difficulty: accepted.difficulty,
    seed,
  };
}

function assertSameCages(original: readonly Cage[], reparsed: readonly CageSpec[], seed: string): void {
  const failure: (detail: string) => never = (detail) => {
    throw new Error(`generate: serialized puzzle does not round-trip for seed ${JSON.stringify(seed)}: ${detail}`);
  };
  if (reparsed.length !== original.length) failure(`${original.length} cages became ${reparsed.length}`);
  const byLetter = new Map(reparsed.map((spec) => [spec.cells[0], spec]));
  for (const cage of original) {
    const spec = byLetter.get(cage.cells[0]);
    if (spec === undefined) failure(`cage ${cage.letter} lost its first cell`);
    if (spec.operator !== cage.operator || spec.target !== cage.target) failure(`cage ${cage.letter} changed target or operator`);
    if (spec.cells.length !== cage.cells.length) failure(`cage ${cage.letter} changed size`);
  }
}

function neighbours(cell: number, boardSize: number): number[] {
  const row = Math.floor(cell / boardSize);
  const column = cell % boardSize;
  const result: number[] = [];
  if (row > 0) result.push(cell - boardSize);
  if (column < boardSize - 1) result.push(cell + 1);
  if (row < boardSize - 1) result.push(cell + boardSize);
  if (column > 0) result.push(cell - 1);
  return result;
}

function range(from: number, to: number): number[] {
  const values: number[] = [];
  for (let value = from; value <= to; value++) values.push(value);
  return values;
}
