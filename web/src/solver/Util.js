import Operator from './Operator';

export function factorize(x) {
  if (x === 1) return [];
  if (x % 2 === 0) return [2].concat(factorize(x / 2));
  if (x % 3 === 0) return [3].concat(factorize(x / 3));
  if (x % 5 === 0) return [5].concat(factorize(x / 5));
  if (x % 7 === 0) return [7].concat(factorize(x / 7));
  return [];
}

export function listCompare(listA, listB) {
  if (listA.length === 0) return true;
  if (listB.length === 0) return false;
  if (listA[0] !== listB[0]) return listA[0] < listB[0];
  return listCompare(listA.slice(1), listB.slice(1));
}

export function notPossible(combination) {
  return combination.length >= 2 && new Set(combination).size === 1;
}

export function multiplicationCombinations(remainingValues, maxValue, targetValue) {
  return multiplicationCombinationsInner(factorize(targetValue), remainingValues, maxValue, 1)
    .map(combination => combination.slice().sort((a, b) => a - b))
    .sort((a, b) => listCompare(a, b) ? -1 : 1)
    .filter((combination, index, self) =>
      index === 0 || JSON.stringify(combination) !== JSON.stringify(self[index - 1])
    )
    .filter(combination => !notPossible(combination));
}

function multiplicationCombinationsInner(factors, remainingValues, maxValue, currentMultiplier) {
  if (factors.length === 0 && remainingValues >= 1 && currentMultiplier <= maxValue) {
    return [[currentMultiplier].concat(new Array(remainingValues - 1).fill(1))];
  }

  if (factors.length === 0) {
    return [];
  }

  const factor = factors[0];
  const remainingFactors = factors.slice(1);

  if (currentMultiplier === 1) {
    return multiplicationCombinationsInner(remainingFactors, remainingValues, maxValue, factor);
  }

  if (currentMultiplier <= maxValue) {
    const branch1 = multiplicationCombinationsInner(remainingFactors, remainingValues - 1, maxValue, factor)
      .map(combination => [currentMultiplier].concat(combination));
    const branch2 = multiplicationCombinationsInner(remainingFactors, remainingValues, maxValue, currentMultiplier * factor);
    return branch1.concat(branch2);
  }

  return [];
}

export function additionCombinations(remainingValues, maxValue, targetValue) {
  return additionCombinationsInner(remainingValues, maxValue, targetValue, 1)
    .filter(combination => !notPossible(combination));
}

function additionCombinationsInner(remainingValues, maxValue, targetValue, highestValue) {
  if (remainingValues === 1 && targetValue <= maxValue && targetValue >= highestValue) {
    return [[targetValue]];
  }

  if (remainingValues > 1 && highestValue <= maxValue && targetValue > 0) {
    const branch1 = additionCombinationsInner(remainingValues - 1, maxValue, targetValue - highestValue, highestValue)
      .map(combination => [highestValue].concat(combination));
    const branch2 = additionCombinationsInner(remainingValues, maxValue, targetValue, highestValue + 1);
    return branch1.concat(branch2);
  }

  return [];
}

export function subtractionCombinations(maxValue, targetValue) {
  const results = [];
  for (let lowerValue = 1; lowerValue <= maxValue; lowerValue++) {
    if (targetValue + lowerValue <= maxValue) {
      const combo = [lowerValue, targetValue + lowerValue];
      if (!notPossible(combo)) {
        results.push(combo);
      }
    }
  }
  return results;
}

export function divisionCombinations(maxValue, targetValue) {
  const results = [];
  for (let value = 1; value <= maxValue; value++) {
    if (Math.floor(value / targetValue) * targetValue === value) {
      const combo = [value, Math.floor(value / targetValue)].sort((a, b) => a - b);
      if (!notPossible(combo)) {
        results.push(combo);
      }
    }
  }
  return results;
}

export function generatePossibilities(constraint, constraintSize, boardSize) {
  switch (constraint.operator) {
    case Operator.Multiplication:
      return multiplicationCombinations(constraintSize, boardSize, constraint.value);
    case Operator.Addition:
      return additionCombinations(constraintSize, boardSize, constraint.value);
    case Operator.Subtraction:
      return subtractionCombinations(boardSize, constraint.value);
    case Operator.Division:
      return divisionCombinations(boardSize, constraint.value);
    case Operator.Constant:
      return [[constraint.value]];
    default:
      return [[constraint.value]];
  }
}

export function setCompare(setA, setB) {
  return listCompare(Array.from(setA).sort((a, b) => a - b), Array.from(setB).sort((a, b) => a - b));
}

export function combinationIsPossible(combination, cellPossibilities) {
  const cache = new Map();
  const sortedCombination = combination.slice().sort((a, b) => a - b);

  // Initialize the true condition
  const allPicked = new Set();
  for (let i = 0; i < cellPossibilities.length; i++) {
    allPicked.add(i);
  }
  const terminalKey = sortedCombination.length + '|' + bitsetToString(allPicked);
  cache.set(terminalKey, true);

  return combinationIsPossibleInner(sortedCombination, cellPossibilities, 0, new Set(), cache);
}

function bitsetToString(set) {
  return Array.from(set).sort((a, b) => a - b).join(',');
}

function combinationIsPossibleInner(combination, cellPossibilities, combinationIdx, cellPossibilitiesPicked, cache) {
  const key = combinationIdx + '|' + bitsetToString(cellPossibilitiesPicked);

  if (cache.has(key)) {
    return cache.get(key);
  }

  const result = cellPossibilities.some((possibility, index) => {
    // Filter out already picked possibilities
    if (cellPossibilitiesPicked.has(index)) return false;
    // Filter out possibilities that don't contain the needed value
    if (!possibility.has(combination[combinationIdx])) return false;

    const newPicked = new Set(cellPossibilitiesPicked);
    newPicked.add(index);

    return combinationIsPossibleInner(
      combination,
      cellPossibilities,
      combinationIdx + 1,
      newPicked,
      cache
    );
  });

  cache.set(key, result);
  return result;
}
