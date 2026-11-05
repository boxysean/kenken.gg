// Exact solution counting for generated puzzles, plus the propagation-only pass
// used to measure difficulty.
//
// Why this does not reuse GameState's search: the solver's propagation is
// row/column only (cage arithmetic is folded into the initial candidate sets and
// then never revisited), so on a 9x9 board proving that a puzzle has exactly one
// solution takes minutes. It also builds its candidate sets through
// GameConstraintState.possibleCombinations, whose product component groups prime
// factors contiguously and therefore misses legal multisets (e.g. {6,6,1} for
// 36). Both properties are fine for the solve screen, which just wants *a*
// solution to the puzzle the user drew, and both are fatal for generation, which
// wants "no second solution, exactly, fast".
//
// So this module counts with its own propagation: hidden singles on rows and
// columns, plus a per-cage pass that keeps only values appearing in some
// assignment consistent with the operator, the target and the current candidate
// masks. Cage arithmetic is therefore exact at every node. The search picks the
// most constrained cell, so the tree stays small. Nothing here imports
// GameState, and the parity suite is untouched.

import type { Constraint } from '../../solver';
import type { Operator } from '../../solver';

export interface CageSpec {
  readonly cells: number[]; // flat row-major indices
  readonly operator: Operator;
  readonly target: number;
}

// Cage assignment enumeration is the only unbounded cost per node. A cage with
// more consistent assignments than this tells the player almost nothing, so it
// is left un-narrowed rather than paid for. Leaving a cage un-narrowed can only
// make the search slower, never wrong.
const ENUMERATION_LIMIT = 20000;

// Builds the cage list from the solver's own representation: the board's
// letters identify the cells, the constraints supply operator and target.
export function cagesFromPuzzle(
  constraints: readonly Constraint[],
  board: readonly (readonly string[])[],
): CageSpec[] {
  const byLetter = new Map<string, { cells: number[]; operator: Operator; target: number }>();
  for (const constraint of constraints) {
    byLetter.set(constraint.name, { cells: [], operator: constraint.operator, target: constraint.value });
  }
  const size = board.length;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const letter = board[row][column];
      const spec = byLetter.get(letter);
      if (spec === undefined) throw new Error(`countSolutions: no constraint named ${JSON.stringify(letter)}`);
      spec.cells.push(row * size + column);
    }
  }
  return [...byLetter.values()].map(({ cells, operator, target }) => ({ cells, operator, target }));
}

// Counts solutions, saturating at `cap`. `budget` bounds the number of search
// nodes: once it is exhausted the call reports `cap`, meaning "at least cap,
// unproven", so a result below `cap` is always exact.
export function countSolutions(
  constraints: readonly Constraint[],
  board: readonly (readonly string[])[],
  cap = 2,
  budget = Infinity,
): number {
  return new Counter(cagesFromPuzzle(constraints, board), board.length, cap, budget).run();
}

// Cells fixed by propagation alone, i.e. before any guessing: what the spec
// calls the puzzle's forced cells, and the difficulty measure it records.
export function forcedCellCount(
  constraints: readonly Constraint[],
  board: readonly (readonly string[])[],
): number {
  const counter = new Counter(cagesFromPuzzle(constraints, board), board.length, 2, Infinity);
  if (!counter.propagateOnly()) return 0;
  return counter.singletonCount();
}

class Counter {
  private readonly size: number;
  private readonly full: number;
  private readonly mask: Int32Array;
  // Every row followed by every column, as flat cell indices: the units that
  // each hold every value exactly once.
  private readonly units: readonly number[][];
  private budgetLeft: number;
  private exhausted = false;
  private found = 0;

  constructor(
    private readonly cages: readonly CageSpec[],
    size: number,
    private readonly cap: number,
    budget: number,
  ) {
    this.size = size;
    this.full = (1 << size) - 1;
    this.mask = new Int32Array(size * size).fill(this.full);
    this.budgetLeft = budget;
    this.units = [
      ...Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => row * size + column)),
      ...Array.from({ length: size }, (_, column) => Array.from({ length: size }, (_, row) => row * size + column)),
    ];
  }

  run(): number {
    this.search();
    return this.exhausted ? this.cap : Math.min(this.found, this.cap);
  }

  propagateOnly(): boolean {
    return this.propagate();
  }

  singletonCount(): number {
    let count = 0;
    for (const value of this.mask) if ((value & (value - 1)) === 0) count++;
    return count;
  }

  private search(): void {
    if (this.exhausted || this.found >= this.cap) return;
    if (--this.budgetLeft < 0) {
      this.exhausted = true;
      return;
    }
    if (!this.propagate()) return;

    // Most constrained cell first. Most candidate sets collapse during
    // propagation, so this is a cheap scan rather than a full ordering.
    let best = -1;
    let bestCount = 1;
    for (let cell = 0; cell < this.mask.length; cell++) {
      const count = popcount(this.mask[cell]);
      if (count > 1 && (best === -1 || count < bestCount)) {
        best = cell;
        bestCount = count;
        if (count === 2) break;
      }
    }

    if (best === -1) {
      // Every cell is decided and propagation found no contradiction, so the
      // completion satisfies every row, column and cage.
      this.found++;
      return;
    }

    const candidates = this.mask[best];
    const saved = this.mask.slice();
    for (let bit = 1; bit <= this.full; bit <<= 1) {
      if ((candidates & bit) === 0) continue;
      this.mask.set(saved);
      this.mask[best] = bit;
      this.search();
      if (this.exhausted || this.found >= this.cap) break;
    }
    this.mask.set(saved);
  }

  // Elimination, hidden singles, naked pairs on every row and column, then
  // every cage, until a full pass changes nothing. Returns false on a
  // contradiction.
  private propagate(): boolean {
    const size = this.size;
    let changed = true;
    while (changed) {
      // Every pass below only ever removes candidate values, so a pass that
      // reports a change must strictly shrink the candidate space. If it does
      // not, the pass is buggy and would spin forever; fail loudly instead.
      const before = this.candidateTotal();
      changed = false;

      for (const unit of this.units) {
        const result = this.propagateUnit(unit);
        if (result === false) return false;
        if (result === true) changed = true;
      }

      for (const cage of this.cages) {
        const result = this.propagateCage(cage);
        if (result === false) return false;
        if (result === true) changed = true;
      }

      if (changed && this.candidateTotal() >= before) {
        throw new Error('countSolutions: propagation made no progress');
      }
    }
    return true;
  }

  // One row or column: drop values already placed elsewhere in the unit, then
  // apply hidden singles, then naked pairs. Returns false on a contradiction,
  // true if a mask shrank, null if nothing happened.
  private propagateUnit(cells: readonly number[]): boolean | null {
    const mask = this.mask;
    let changed = false;

    // Values fixed in one cell of the unit cannot appear again in the unit.
    let assigned = 0;
    for (const cell of cells) {
      const value = mask[cell];
      if (value === 0) return false;
      if ((value & (value - 1)) === 0) assigned |= value;
    }
    if (assigned !== 0) {
      for (const cell of cells) {
        const value = mask[cell];
        if ((value & (value - 1)) === 0) continue;
        const next = value & ~assigned;
        if (next === 0) return false;
        if (next !== value) {
          mask[cell] = next;
          changed = true;
        }
      }
    }

    // Hidden singles: a value with exactly one home in the unit goes there.
    let once = 0;
    let twice = 0;
    for (const cell of cells) {
      const value = mask[cell];
      twice |= once & value;
      once |= value;
    }
    if (once !== this.full) return false;
    const lonely = once & ~twice;
    if (lonely !== 0) {
      for (const cell of cells) {
        const value = mask[cell];
        const hit = value & lonely;
        if (hit === 0 || (value & (value - 1)) === 0) continue;
        // Two values that can only go in this one cell is a contradiction: the
        // cell holds one of them and nothing else can hold the other.
        if ((hit & (hit - 1)) !== 0) return false;
        mask[cell] = hit;
        changed = true;
      }
    }

    // Naked pairs: two cells sharing the same two candidates hold both, so no
    // other cell in the unit can.
    for (let first = 0; first < cells.length; first++) {
      const a = mask[cells[first]];
      if (popcount(a) !== 2) continue;
      for (let second = first + 1; second < cells.length; second++) {
        if (mask[cells[second]] !== a) continue;
        for (const cell of cells) {
          if (cell === cells[first] || cell === cells[second]) continue;
          const value = mask[cell];
          const next = value & ~a;
          if (next === 0) return false;
          if (next !== value) {
            mask[cell] = next;
            changed = true;
          }
        }
        break;
      }
    }

    return changed ? true : null;
  }

  private candidateTotal(): number {
    let total = 0;
    for (const value of this.mask) total += popcount(value);
    return total;
  }

  // Keeps only the values each cage cell takes in some assignment consistent
  // with the operator, the target and the current masks. Returns null when
  // nothing changed or the cage was too expensive to enumerate, false on a
  // contradiction (no assignment at all), true when a mask was narrowed.
  private propagateCage(cage: CageSpec): boolean | null {
    const { cells, operator, target } = cage;
    const length = cells.length;
    const union = new Int32Array(length);
    const current = new Int32Array(length);
    let assignments = 0;
    let aborted = false;

    const visit = (index: number, accumulated: number): void => {
      if (aborted) return;
      if (index === length) {
        if (meetsTarget(operator, target, current)) {
          if (++assignments > ENUMERATION_LIMIT) {
            aborted = true;
            return;
          }
          for (let position = 0; position < length; position++) union[position] |= 1 << (current[position] - 1);
        }
        return;
      }
      const cell = cells[index];
      const remaining = length - index - 1;
      let candidates = this.mask[cell];
      while (candidates !== 0) {
        const bit = candidates & -candidates;
        candidates ^= bit;
        const value = bitPosition(bit) + 1;

        let clash = false;
        for (let placed = 0; placed < index; placed++) {
          if (current[placed] === value && sharesLine(cells[placed], cell, this.size)) {
            clash = true;
            break;
          }
        }
        if (clash) continue;
        if (!feasible(operator, target, accumulated, value, remaining, this.size)) continue;

        current[index] = value;
        visit(index + 1, operator === '+' ? accumulated + value : operator === 'x' ? accumulated * value : 0);
        if (aborted) return;
      }
    };

    visit(0, operator === 'x' ? 1 : 0);
    if (aborted) return null;
    if (assignments === 0) return false;

    let narrowed = false;
    for (let position = 0; position < length; position++) {
      const cell = cells[position];
      const next = this.mask[cell] & union[position];
      if (next === 0) return false;
      if (next !== this.mask[cell]) {
        this.mask[cell] = next;
        narrowed = true;
      }
    }
    return narrowed ? true : null;
  }
}

// Partial-sum / partial-product bound so enumeration prunes early.
function feasible(
  operator: Operator,
  target: number,
  accumulated: number,
  value: number,
  remaining: number,
  size: number,
): boolean {
  switch (operator) {
    case '+': {
      const next = accumulated + value;
      return next + remaining <= target && next + remaining * size >= target;
    }
    case 'x': {
      const next = accumulated * value;
      if (target % next !== 0) return false;
      return target / next <= Math.pow(size, remaining);
    }
    default:
      return true;
  }
}

function meetsTarget(operator: Operator, target: number, values: Int32Array): boolean {
  switch (operator) {
    case '+': {
      let sum = 0;
      for (const value of values) sum += value;
      return sum === target;
    }
    case 'x': {
      let product = 1;
      for (const value of values) product *= value;
      return product === target;
    }
    case '-':
      return Math.abs(values[0] - values[1]) === target;
    case '/': {
      const low = Math.min(values[0], values[1]);
      const high = Math.max(values[0], values[1]);
      return low !== 0 && high % low === 0 && high / low === target;
    }
    case '':
      return values[0] === target;
  }
}

function sharesLine(a: number, b: number, size: number): boolean {
  return Math.floor(a / size) === Math.floor(b / size) || a % size === b % size;
}

function popcount(value: number): number {
  let count = 0;
  let rest = value;
  while (rest !== 0) {
    rest &= rest - 1;
    count++;
  }
  return count;
}

function bitPosition(bit: number): number {
  let position = 0;
  let rest = bit;
  while ((rest >>= 1) !== 0) position++;
  return position;
}
