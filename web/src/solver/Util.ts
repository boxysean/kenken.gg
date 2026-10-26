// Port of api/src/main/scala/gg/kenken/solver/Util.scala.
//
// Scala `Set[Int]` cell possibilities are represented as sorted, deduplicated
// `readonly number[]` (see the note on GameState). Every numeric sort below
// passes an explicit comparator: Array.prototype.sort is lexicographic by default.
import type { Constraint } from './Constraint';
import { KenKenSolverException } from './Constraint';

const ascending = (a: number, b: number): number => a - b;

function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort(ascending);
}

// Scala `List.distinct` on List[List[Int]]: structural equality, first occurrence wins.
function distinctLists(lists: number[][]): number[][] {
  const seen = new Set<string>();
  return lists.filter((list) => {
    const key = list.join(',');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Scala `1 until maxValue + 1`.
function inclusiveRange(from: number, to: number): number[] {
  const values: number[] = [];
  for (let value = from; value <= to; value++) {
    values.push(value);
  }
  return values;
}

// Scala's match is partial: it only knows the factors 2, 3, 5 and 7 and throws
// a MatchError for anything else (e.g. 11). That partiality is reproduced.
export function factorize(x: number): number[] {
  if (x === 1) return [];
  if (x % 2 === 0) return [2, ...factorize(x / 2)];
  if (x % 3 === 0) return [3, ...factorize(x / 3)];
  if (x % 5 === 0) return [5, ...factorize(x / 5)];
  if (x % 7 === 0) return [7, ...factorize(x / 7)];
  throw new KenKenSolverException('Util.factorize: no match for ' + x);
}

export function listCompare(listA: readonly number[], listB: readonly number[]): boolean {
  if (listA.length === 0) return true;
  if (listB.length === 0) return false;
  if (listA[0] !== listB[0]) return listA[0] < listB[0];
  return listCompare(listA.slice(1), listB.slice(1));
}

// All values of a combination are the same
export function notPossible(combination: readonly number[]): boolean {
  return combination.length >= 2 && new Set(combination).size === 1;
}

export function multiplicationCombinations(remainingValues: number, maxValue: number, targetValue: number): number[][];
export function multiplicationCombinations(
  factors: readonly number[],
  remainingValues: number,
  maxValue: number,
  currentMultiplier: number,
): number[][];
export function multiplicationCombinations(
  ...args: [number, number, number] | [readonly number[], number, number, number]
): number[][] {
  if (args.length === 4) {
    return multiplicationCombinationsInner(...args);
  }
  const [remainingValues, maxValue, targetValue] = args;
  // Scala: .sortWith(listCompare), i.e. Ordering.fromLessThan(listCompare).
  const lessThan = (listA: number[], listB: number[]): number =>
    listCompare(listA, listB) ? -1 : listCompare(listB, listA) ? 1 : 0;
  return distinctLists(
    multiplicationCombinationsInner(factorize(targetValue), remainingValues, maxValue, 1)
      .map((combination) => sortedCopy(combination))
      .sort(lessThan),
  ).filter((combination) => !notPossible(combination));
}

function multiplicationCombinationsInner(
  factors: readonly number[],
  remainingValues: number,
  maxValue: number,
  currentMultiplier: number,
): number[][] {
  if (factors.length === 0) {
    if (remainingValues >= 1 && currentMultiplier <= maxValue) {
      return [[currentMultiplier, ...new Array<number>(remainingValues - 1).fill(1)]];
    }
    return [];
  }
  const [factor, ...remainingFactors] = factors;
  if (currentMultiplier === 1) {
    return multiplicationCombinationsInner(remainingFactors, remainingValues, maxValue, factor);
  }
  if (currentMultiplier <= maxValue) {
    return [
      ...multiplicationCombinationsInner(remainingFactors, remainingValues - 1, maxValue, factor).map(
        (combination) => [currentMultiplier, ...combination],
      ),
      ...multiplicationCombinationsInner(remainingFactors, remainingValues, maxValue, currentMultiplier * factor),
    ];
  }
  return [];
}

export function additionCombinations(remainingValues: number, maxValue: number, targetValue: number): number[][];
export function additionCombinations(
  remainingValues: number,
  maxValue: number,
  targetValue: number,
  highestValue: number,
): number[][];
export function additionCombinations(
  remainingValues: number,
  maxValue: number,
  targetValue: number,
  highestValue?: number,
): number[][] {
  if (highestValue !== undefined) {
    return additionCombinationsInner(remainingValues, maxValue, targetValue, highestValue);
  }
  return additionCombinationsInner(remainingValues, maxValue, targetValue, 1).filter(
    (combination) => !notPossible(combination),
  );
}

function additionCombinationsInner(
  remainingValues: number,
  maxValue: number,
  targetValue: number,
  highestValue: number,
): number[][] {
  if (remainingValues === 1 && targetValue <= maxValue && targetValue >= highestValue) {
    return [[targetValue]];
  }
  if (remainingValues > 1 && highestValue <= maxValue && targetValue > 0) {
    return [
      ...additionCombinationsInner(remainingValues - 1, maxValue, targetValue - highestValue, highestValue).map(
        (combination) => [highestValue, ...combination],
      ),
      ...additionCombinationsInner(remainingValues, maxValue, targetValue, highestValue + 1),
    ];
  }
  return [];
}

export function subtractionCombinations(maxValue: number, targetValue: number): number[][] {
  return inclusiveRange(1, maxValue)
    .filter((lowerValue) => targetValue + lowerValue <= maxValue)
    .map((lowerValue) => [lowerValue, targetValue + lowerValue])
    .filter((combination) => !notPossible(combination));
}

export function divisionCombinations(maxValue: number, targetValue: number): number[][] {
  // Scala Int division by zero throws ArithmeticException; JS would silently
  // produce NaN and an empty list, so the throw is reproduced.
  if (targetValue === 0) {
    throw new KenKenSolverException('Util.divisionCombinations: / by zero');
  }
  // Scala Int division truncates.
  return inclusiveRange(1, maxValue)
    .filter((value) => Math.floor(value / targetValue) * targetValue === value)
    .map((value) => sortedCopy([value, Math.floor(value / targetValue)]))
    .filter((combination) => !notPossible(combination));
}

export function generatePossibilities(constraint: Constraint, constraintSize: number, boardSize: number): number[][] {
  switch (constraint.operator) {
    case 'x':
      return multiplicationCombinations(constraintSize, boardSize, constraint.value);
    case '+':
      return additionCombinations(constraintSize, boardSize, constraint.value);
    case '-':
      return subtractionCombinations(boardSize, constraint.value);
    case '/':
      return divisionCombinations(boardSize, constraint.value);
    case '':
      return [[constraint.value]];
  }
}

export function setCompare(setA: readonly number[], setB: readonly number[]): boolean {
  return listCompare(sortedCopy(setA), sortedCopy(setB));
}

/**
 * Take this combination: (2, 1, 3)
 * And take these possibilities (A={1}, B={3}, C={1, 2})
 *
 * The answer is "Yes, this combination is possible"
 * because 2 in {1, 2} && 1 in {1} && 3 in {3}.
 *
 * The Scala version identifies a possibility by referential identity (`eq`)
 * and memoises on (combinationIdx, picked BitSet). Here a possibility is
 * identified by its index, and the cache key is
 * `${combinationIdx}:${sortedPickedIndices.join(',')}`.
 */
export function combinationIsPossible(
  combination: readonly number[],
  cellPossibilities: readonly (readonly number[])[],
): boolean;
export function combinationIsPossible(
  combination: readonly number[],
  cellPossibilities: readonly (readonly number[])[],
  combinationIdx: number,
  cellPossibilitiesPicked: readonly number[],
  cache: Map<string, boolean>,
): boolean;
export function combinationIsPossible(
  combination: readonly number[],
  cellPossibilities: readonly (readonly number[])[],
  combinationIdx?: number,
  cellPossibilitiesPicked?: readonly number[],
  cache?: Map<string, boolean>,
): boolean {
  if (combinationIdx !== undefined && cellPossibilitiesPicked !== undefined && cache !== undefined) {
    return combinationIsPossibleInner(combination, cellPossibilities, combinationIdx, cellPossibilitiesPicked, cache);
  }
  const initialCache = new Map<string, boolean>();
  // Initialize the true condition: when all combinations and cellPossibilities
  // have been selected
  initialCache.set(
    cacheKey(
      combination.length,
      cellPossibilities.map((_, index) => index),
    ),
    true,
  );
  return combinationIsPossibleInner(sortedCopy(combination), cellPossibilities, 0, [], initialCache);
}

function cacheKey(combinationIdx: number, picked: readonly number[]): string {
  return `${combinationIdx}:${sortedCopy(picked).join(',')}`;
}

function combinationIsPossibleInner(
  combination: readonly number[],
  cellPossibilities: readonly (readonly number[])[],
  combinationIdx: number,
  cellPossibilitiesPicked: readonly number[],
  cache: Map<string, boolean>,
): boolean {
  const key = cacheKey(combinationIdx, cellPossibilitiesPicked);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  // Filter out picked possibilities
  const unpicked = cellPossibilities
    .map((_, index) => index)
    .filter((index) => !cellPossibilitiesPicked.includes(index));
  // Scala evaluates `combination(combinationIdx)` once per unpicked
  // possibility, which throws IndexOutOfBoundsException when the combination
  // is shorter than the list of possibilities.
  if (unpicked.length > 0 && combinationIdx >= combination.length) {
    throw new KenKenSolverException('Util.combinationIsPossible: index ' + combinationIdx + ' out of range');
  }
  const result = unpicked
    // Filter out possibilities that don't work
    .filter((index) => cellPossibilities[index].includes(combination[combinationIdx]))
    .some((index) =>
      combinationIsPossibleInner(combination, cellPossibilities, combinationIdx + 1, [...cellPossibilitiesPicked, index], cache),
    );
  cache.set(key, result);
  return result;
}
